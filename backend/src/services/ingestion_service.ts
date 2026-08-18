/**
 * Async Document Ingestion Service
 *
 * Upload → parse → clean text → chunk → embed → store → retrieve
 * Status tracking: uploaded → parsing → chunking → embedding → indexed | failed
 * Postgres = source of truth, Redis used for lightweight queue coordination.
 */

import { prisma } from '../utils/prisma';
import { ragService, ENABLE_SUMMARY_CHUNKS } from './rag_service';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { documentWhere, type AccessScope } from '../utils/document_access';
import { getCloudRunAuthorization } from '../utils/cloud_run_auth';

const DOCLING_URL = process.env.DOCLING_URL || 'http://localhost:8001';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');

export function getDoclingIngestionTimeoutMs(
  env: { DOCLING_ASYNC_TIMEOUT_MS?: string } = process.env,
): number {
  const configured = Number(env.DOCLING_ASYNC_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 120_000 && configured <= 840_000
    ? configured
    : 840_000;
}

/** Resolve storageKey (relative path) to an absolute filesystem path */
function resolveStoragePath(storageKey: string): string {
  // Already absolute? legacy — strip prefix to get relative
  if (path.isAbsolute(storageKey)) {
    const filename = path.basename(storageKey);
    return path.join(UPLOAD_DIR, filename);
  }
  // Relative: uploads/<uuid>.pdf
  return path.join(UPLOAD_DIR, path.basename(storageKey));
}

export type IngestionStatus =
  | 'uploaded'
  | 'parsing'
  | 'chunking'
  | 'embedding'
  | 'indexed'
  | 'partial'
  | 'failed';

/**
 * Process a document through the full ingestion pipeline.
 * Called by the durable ingestion worker. Failures propagate so the worker can
 * retain the upload, release its lease, and schedule a bounded retry.
 */
export async function processIngestion(documentId: string, access: AccessScope): Promise<void> {
  // 1. Parsing
  await updateStatus(documentId, access, 'parsing');
  const cleanedText = await parseDocument(documentId, access);

  // 2. Chunking
  await updateStatus(documentId, access, 'chunking');
  const chunks = chunkText(cleanedText);

  // 3. Embedding + store (done together in ragService)
  await updateStatus(documentId, access, 'embedding');

  // Get docType from document record
  const doc = await prisma.document.findUnique({
    where: { id: documentId, ...documentWhere(access) },
    select: { docType: true },
  });

  if (!doc) throw new Error('Document not found');

  // Replays follow crashes and expired leases. Remove any partial prior attempt
  // before rebuilding so a durable retry cannot duplicate chunks.
  await prisma.$transaction([
    prisma.chunk.deleteMany({ where: { documentId } }),
    prisma.document.update({
      where: { id: documentId, ...documentWhere(access) },
      data: { chunkCount: 0, embeddedChunkCount: 0, failedChunkCount: 0, processedAt: null },
    }),
  ]);

  // Use the existing RAG indexing pipeline
  let embeddedChunkCount = 0;
  let failedChunkCount = 0;
  for (const chunk of chunks) {
    try {
      const result = await ragService.indexChunk(
        chunk.text,
        documentId,
        access,
        doc?.docType || undefined,
        chunk.metadata,
      );
      if (result.embedded) embeddedChunkCount++;
      else failedChunkCount++;
    } catch (err) {
      console.error(`[Ingestion] Chunk embedding failed (continuing):`, err);
      failedChunkCount++;
    }
  }

  // Summary generation is optional and best-effort, but must run for the
  // async ingestion path just as it does for synchronous indexing.
  if (ENABLE_SUMMARY_CHUNKS()) {
    await ragService.storeDocumentSummary(
      documentId,
      cleanedText,
      doc?.docType || 'unknown',
      access,
    );
  }

  // 4. Mark the actual integrity state. A document with unavailable vectors
  // must not masquerade as fully indexed.
  const finalStatus: IngestionStatus = chunks.length === 0
    ? 'failed'
    : failedChunkCount === 0 ? 'indexed' : 'partial';
  await updateStatus(documentId, access, finalStatus, {
    chunkCount: chunks.length,
    embeddedChunkCount,
    failedChunkCount,
  });
}

/**
 * Parse document via Docling microservice, return cleaned text.
 * 1st priority: send saved PDF file to Docling for full PDF parsing.
 * 2nd priority: fall back to stored raw content (pre-indexed text).
 */
async function parseDocument(documentId: string, access: AccessScope): Promise<string> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId, ...documentWhere(access) },
    select: { content: true, storageKey: true },
  });

  if (!doc) {
    throw new Error('Document not found');
  }

  // Priority 1: send saved PDF file to Docling
  if (doc.storageKey) {
    const pdfPath = resolveStoragePath(doc.storageKey);
    if (fs.existsSync(pdfPath)) {
      try {
        const parsePdf = async (doOcr: boolean): Promise<string> => {
          const FormData = (await import('form-data')).default;
          const formData = new FormData();
          formData.append('file', fs.createReadStream(pdfPath), {
            filename: 'document.pdf',
            contentType: 'application/pdf',
          });
          const url = `${DOCLING_URL}/parse?do_ocr=${doOcr}`;
          const response = await axios.post(url, formData, {
            headers: {
              ...formData.getHeaders(),
              ...await getCloudRunAuthorization(url),
            },
            timeout: getDoclingIngestionTimeoutMs(),
          });
          return response.data?.text || '';
        };

        let parsedText = await parsePdf(false);
        if (parsedText.trim().length < 500) {
          console.log(`[Ingestion] Text-only extraction returned ${parsedText.trim().length} chars for ${documentId}; retrying with OCR`);
          parsedText = await parsePdf(true);
        }
        if (parsedText.trim()) {
          // Persist parsed text back to document for future reads
          await prisma.document.update({
            where: { id: documentId, ...documentWhere(access) },
            data: { content: parsedText },
          });
          return parsedText;
        }
      } catch (err) {
        console.warn(`[Ingestion] Docling parse failed for ${documentId}, trying stored content:`, err);
      }
    }
  }

  // Priority 2: fall back to stored text content
  if (doc.content?.trim()) {
    return doc.content;
  }

  throw new Error('No parsable content found — PDF file missing and no stored text');
}

/**
 * Hierarchical text chunking using the shared ragService chunker.
 * Ensures the async ingestion pipeline produces identical chunk structure
 * to the sync pipeline (Article → Clause → Point).
 */
function chunkText(text: string): Array<{ text: string; metadata: Record<string, any> }> {
  const hierarchical = ragService.chunkDocument(text);

  return hierarchical.map(c => ({
    text: c.content,
    metadata: {
      level: c.level,
      article: c.article,
      clause: c.clause,
      point: c.point,
    },
  }));
}

/**
 * Update document ingestion status in database
 */
async function updateStatus(
  documentId: string,
  access: AccessScope,
  status: IngestionStatus,
  counts?: { chunkCount: number; embeddedChunkCount: number; failedChunkCount: number },
): Promise<void> {
  const update: any = { ingestionStatus: status };
  if (status === 'indexed' || status === 'partial') {
    update.processedAt = new Date();
    if (counts) Object.assign(update, counts);
    if (status === 'partial') {
      update.processingError = `${counts?.failedChunkCount ?? 0} chunk(s) were stored without embeddings`;
    }
  }
  await prisma.document.update({
    where: { id: documentId, ...documentWhere(access) },
    data: update,
  });
}

/**
 * Delete the uploaded PDF only after success or terminal failure. Cleanup
 * errors propagate to the worker, which logs them without replaying ingestion.
 */
export async function cleanupIngestionFile(
  documentId: string,
  access: AccessScope,
): Promise<void> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId, ...documentWhere(access) },
    select: { storageKey: true },
  });
  if (!doc?.storageKey) return;
  const pdfPath = resolveStoragePath(doc.storageKey);
  if (fs.existsSync(pdfPath)) {
    await fs.promises.unlink(pdfPath);
    console.log(`[Ingestion] Cleaned up uploaded file: ${pdfPath}`);
  }
}

export const ingestionService = { processIngestion, cleanupIngestionFile };
