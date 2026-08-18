import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ragService } from '../services/rag_service';
import {
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
  DOCUMENT_TYPE_IDS,
  SearchSchema,
  validate,
} from '../middleware/validation';
import { prisma } from '../utils/prisma';
import { userAuthMiddleware, requireAuth } from '../middleware/user_auth';
import { uploadLimiter } from '../middleware/ratelimit';
import { accessFromRequest, documentWhere } from '../utils/document_access';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const INCOMING_UPLOAD_DIR = path.join(UPLOAD_DIR, '.incoming');

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.promises.mkdir(INCOMING_UPLOAD_DIR, { recursive: true })
        .then(() => cb(null, INCOMING_UPLOAD_DIR))
        .catch(error => cb(error, INCOMING_UPLOAD_DIR));
    },
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.upload`),
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  },
});

const router = express.Router();
const validTypes = [...DOCUMENT_TYPE_IDS];

async function isPdfFile(filePath: string): Promise<boolean> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const signature = Buffer.alloc(5);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    return bytesRead === signature.length && signature.toString('ascii') === '%PDF-';
  } finally {
    await handle.close();
  }
}

/**
 * Search for relevant document chunks
 * POST /api/rag/search
 * Body: { query: string, topK?: number, docType?: string }
 */
router.post('/search', userAuthMiddleware, requireAuth, validate(SearchSchema), async (req, res) => {
  try {
    const { query, topK = 5, docType } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const results = await ragService.search(query, topK, docType, accessFromRequest(req));

    res.json({
      success: true,
      query,
      results,
      count: results.length,
    });
  } catch (error: any) {
    console.error('RAG search error:', error);
    res.status(500).json({ error: 'RAG search failed' });
  }
});

/**
 * Get ingestion status for a document
 * GET /api/rag/status/:documentId
 */
router.get('/status/:documentId', userAuthMiddleware, requireAuth, async (req, res) => {
  try {
    const { documentId } = req.params;
    const doc = await prisma.document.findUnique({
      where: { id: documentId, ...documentWhere(accessFromRequest(req)) },
      select: {
        id: true,
        ingestionStatus: true,
        processingError: true,
        processedAt: true,
        chunkCount: true,
        embeddedChunkCount: true,
        failedChunkCount: true,
        issuingAuthority: true,
        effectiveFrom: true,
        effectiveTo: true,
        repealedAt: true,
        sourceVersion: true,
        title: true,
        docType: true,
      },
    });

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({ success: true, document: doc });
  } catch (error: any) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Unable to read document status' });
  }
});

/**
 * List all indexed documents with ingestion status
 * GET /api/rag/documents
 */
router.get('/documents', userAuthMiddleware, requireAuth, async (req, res) => {
  try {
    const docs = await prisma.document.findMany({
      where: documentWhere(accessFromRequest(req)),
      select: {
        id: true,
        title: true,
        docType: true,
        ingestionStatus: true,
        processingError: true,
        processedAt: true,
        chunkCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({ success: true, documents: docs });
  } catch (error: any) {
    console.error('List documents error:', error);
    res.status(500).json({ error: 'Unable to list documents' });
  }
});

/**
 * Index a new document from PDF (async — returns immediately with status)
 * POST /api/rag/index
 * POST /api/rag/upload
 * Body: FormData with 'file' (PDF) and 'docType'
 */
async function uploadAndIndex(req: Request, res: Response) {
  const uploadedPath = req.file?.path;
  let retainedPath: string | undefined;
  const cleanup = async () => {
    const paths = [uploadedPath, retainedPath].filter((value): value is string => Boolean(value));
    await Promise.all([...new Set(paths)].map(candidate => fs.promises.unlink(candidate).catch(() => undefined)));
  };
  try {
    const access = accessFromRequest(req);
    const docType = req.body.docType ?? req.body.documentType;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'PDF file is required' });
    }

    if (!docType) {
      await cleanup();
      return res.status(400).json({ error: 'docType is required' });
    }

    if (!validTypes.includes(docType)) {
      await cleanup();
      return res.status(400).json({ error: `Invalid docType. Valid types: ${validTypes.join(', ')}` });
    }

    if (!file.originalname.toLowerCase().endsWith('.pdf')) {
      await cleanup();
      return res.status(400).json({ error: 'PDF filename must end with .pdf' });
    }

    if (!await isPdfFile(file.path)) {
      await cleanup();
      return res.status(400).json({ error: 'Invalid PDF file' });
    }

    const legalMetadata = readLegalMetadata(req.body);

    // Save file to disk for background processing
    const fileId = crypto.randomUUID();
    const safeName = `${fileId}.pdf`;
    const storageKey = `uploads/${safeName}`;
    const fullPath = path.join(UPLOAD_DIR, safeName);
    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.promises.rename(file.path, fullPath);
    retainedPath = fullPath;

    // H11: if the DB write fails, remove the orphaned file from disk so
    // unauthenticated/crashing uploads don't accumulate.
    const deleteOrphan = async () => {
      try {
        await fs.promises.unlink(fullPath);
      } catch {
        /* already gone or never written — not an error */
      }
    };

    let document;
    try {
      document = await prisma.$transaction(async (transaction) => {
        const created = await transaction.document.create({
          data: {
            title: file.originalname.replace(/\.pdf$/i, ''),
            docType,
            content: '',
            ingestionStatus: 'uploaded',
            storageKey,
            originalFilename: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            owner: { connect: { id: access.userId } },
            ...legalMetadata,
          },
        });
        await transaction.ingestionJob.create({
          data: { documentId: created.id },
        });
        return created;
      });
    } catch (createErr) {
      await deleteOrphan();
      throw createErr;
    }
    retainedPath = undefined;

    res.status(202).json({
      success: true,
      documentId: document.id,
      status: 'uploaded',
      message: 'Document queued for processing. Poll GET /api/rag/status/:documentId for updates.',
    });
  } catch (error: any) {
    await cleanup();
    console.error('Document upload error:', error);
    const clientError = /^Invalid |metadata/.test(error?.message || '');
    res.status(clientError ? 400 : 500).json({ error: clientError ? error.message : 'Document upload failed' });
  }
}

function readLegalMetadata(body: Record<string, unknown>): Record<string, unknown> {
  const parseDate = (value: unknown, field: string): Date | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${field} date`);
    return date;
  };
  let metadata: Record<string, unknown> | undefined;
  if (body.metadata) {
    const raw = String(body.metadata);
    if (raw.length > 10_000) throw new Error('metadata is too large');
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('metadata must be a JSON object');
    metadata = parsed;
  }
  return {
    issuingAuthority: body.issuingAuthority ? String(body.issuingAuthority).slice(0, 300) : undefined,
    sourceVersion: body.sourceVersion ? String(body.sourceVersion).slice(0, 100) : undefined,
    effectiveFrom: parseDate(body.effectiveFrom, 'effectiveFrom'),
    effectiveTo: parseDate(body.effectiveTo, 'effectiveTo'),
    repealedAt: parseDate(body.repealedAt, 'repealedAt'),
    metadata,
  };
}

router.post('/index', userAuthMiddleware, requireAuth, uploadLimiter, upload.single('file'), uploadAndIndex);
router.post('/upload', userAuthMiddleware, requireAuth, uploadLimiter, upload.single('file'), uploadAndIndex);

export default router;
