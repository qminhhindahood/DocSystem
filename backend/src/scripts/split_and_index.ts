/**
 * Split a large PDF into page-range chunks and index each via reindex_corpus.
 *
 * Usage:
 *   npx tsx src/scripts/split_and_index.ts <pdf-path> <doctype> <pages-per-chunk>
 *
 * Example:
 *   npx tsx src/scripts/split_and_index.ts ../path/to/document.pdf quyet-dinh 15
 *
 * Each chunk is saved to a temp dir and indexed sequentially.
 */

import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import crypto from 'crypto';
import { ragService } from '../services/rag_service';
import { prisma } from '../utils/prisma';
import { DOCUMENT_TYPE_IDS } from '../middleware/validation';
import { SYSTEM_ACCESS } from '../utils/document_access';

const VALID_DOC_TYPES = new Set(DOCUMENT_TYPE_IDS);

async function splitAndIndex(pdfPath: string, docType: string, pagesPerChunk: number) {
  if (!VALID_DOC_TYPES.has(docType as any)) {
    throw new Error(`Invalid doctype "${docType}". Valid: ${[...VALID_DOC_TYPES].join(', ')}`);
  }

  const pdfBytes = fs.readFileSync(pdfPath);
  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const fileName = path.basename(pdfPath);

  console.log(`\n[split] ${fileName}: ${totalPages} pages, chunking by ${pagesPerChunk}`);

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
    const chunkPath = path.join(tmpDir, `chunk_${chunkIndex}.pdf`);
    fs.writeFileSync(chunkPath, chunkBytes);

    try {
      const docId = await ragService.parseOnly(Buffer.from(chunkBytes), docType, SYSTEM_ACCESS);
      console.log(`  [ok]   chunk ${chunkIndex} → ${docId}`);
      okCount++;
    } catch (err: any) {
      console.error(`  [fail] chunk ${chunkIndex} → ${err.message}`);
      failCount++;
    }

    // Cleanup temp chunk
    try { fs.unlinkSync(chunkPath); } catch {}
  }

  const finalCount = await prisma.chunk.count({ where: { document: { docType: docType } } });
  console.log(`\n[split] done: ${okCount} ok, ${failCount} failed out of ${numChunks} chunks.`);
  console.log(`[split] ${finalCount} total chunks now in DB for doctype="${docType}".\n`);
}

const [,, pdfPath, docType, pagesStr] = process.argv;
if (!pdfPath || !docType) {
  console.error('Usage: npx tsx src/scripts/split_and_index.ts <pdf-path> <doctype> [pages-per-chunk]');
  process.exit(1);
}

const pagesPerChunk = parseInt(pagesStr || '15', 10);

splitAndIndex(pdfPath, docType, pagesPerChunk)
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('[split] FATAL:', err.message);
    await prisma.$disconnect();
    process.exit(1);
  });
