/**
 * Split a large PDF into page-range chunks, parse each with docling,
 * store chunks in DB WITHOUT embeddings (to avoid OOM).
 * Then run backfill_embeddings.ts to embed everything at once.
 *
 * Usage:
 *   npx tsx src/scripts/parse_and_store.ts <pdf-path> <doctype> [pages-per-chunk]
 */

import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { ragService } from '../services/rag_service';
import { prisma } from '../utils/prisma';
import { DOCUMENT_TYPE_IDS } from '../middleware/validation';

const VALID_DOC_TYPES = new Set(DOCUMENT_TYPE_IDS);

// Override the embedding step in ragService to skip it
// We'll use the internal parse logic directly

async function parseOnly(pdfPath: string, docType: string, pagesPerChunk: number) {
  if (!VALID_DOC_TYPES.has(docType as any)) {
    throw new Error(`Invalid doctype "${docType}". Valid: ${[...VALID_DOC_TYPES].join(', ')}`);
  }

  const pdfBytes = fs.readFileSync(pdfPath);
  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const fileName = path.basename(pdfPath);

  console.log(`\n[parse] ${fileName}: ${totalPages} pages, chunking by ${pagesPerChunk}`);

  const tmpDir = path.join(__dirname, '..', '..', '.split-tmp');
  fs.mkdirSync(tmpDir, { recursive: true });

  let chunkIndex = 0;
  let okCount = 0;
  let failCount = 0;

  const numChunks = Math.ceil(totalPages / pagesPerChunk);

  for (let start = 0; start < totalPages; start += pagesPerChunk) {
    const end = Math.min(start + pagesPerChunk, totalPages);
    chunkIndex++;

    console.log(`  [chunk ${chunkIndex}/${numChunks}] pages ${start + 1}–${end}`);

    const newDoc = await PDFDocument.create();
    const pages = await newDoc.copyPages(srcDoc, Array.from({ length: end - start }, (_, i) => start + i));
    pages.forEach(p => newDoc.addPage(p));

    const chunkBytes = await newDoc.save();

    try {
      // Use ragService's internal parse + store logic (skip embeddings)
      const docId = await (ragService as any).parseAndStore(chunkBytes, docType);
      console.log(`  [ok]   chunk ${chunkIndex} → ${docId}`);
      okCount++;
    } catch (err: any) {
      console.error(`  [fail] chunk ${chunkIndex} → ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n[parse] done: ${okCount} ok, ${failCount} failed out of ${numChunks} chunks.`);
}

const [,, pdfPath, docType, pagesStr] = process.argv;
if (!pdfPath || !docType) {
  console.error('Usage: npx tsx src/scripts/parse_and_store.ts <pdf-path> <doctype> [pages-per-chunk]');
  process.exit(1);
}

const pagesPerChunk = parseInt(pagesStr || '15', 10);

parseOnly(pdfPath, docType, pagesPerChunk)
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('[parse] FATAL:', err.message);
    await prisma.$disconnect();
    process.exit(1);
  });
