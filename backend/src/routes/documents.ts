import express from 'express';
import { prisma } from '../utils/prisma';
import { getSupportedDocxTypes } from '../services/docx_service';
import { userAuthMiddleware, requireAuth } from '../middleware/user_auth';
import { accessFromRequest, documentWhere } from '../utils/document_access';
import type { Request, Response } from 'express';
import {
  readVerifiedGeneratedDocument,
  stageGeneratedDocumentDeletion,
} from '../services/template_storage_service';
import { z } from 'zod';

const router = express.Router();

const decimalInteger = z.string().regex(/^(0|[1-9]\d*)$/, 'Must be a complete base-10 integer');
const DocumentListQuerySchema = z.object({
  docType: z.string().trim().min(1).max(100).optional(),
  status: z.string().trim().min(1).max(50).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: decimalInteger.default('20').transform(Number).refine(
    (value) => value >= 1 && value <= 100,
    'limit must be between 1 and 100',
  ),
  offset: decimalInteger.default('0').transform(Number).refine(
    (value) => value >= 0 && value <= 10_000,
    'offset must be between 0 and 10000',
  ),
});

// All document routes require authentication
router.use(userAuthMiddleware, requireAuth);

router.get('/', async (req, res) => {
  try {
    const parsedQuery = DocumentListQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Invalid document list query' });
    }
    const { docType, status, limit, offset, q } = parsedQuery.data;
    const where: Record<string, unknown> = { ...documentWhere(accessFromRequest(req)) };

    if (docType) where.docType = docType;
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        select: {
          id: true,
          docType: true,
          title: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          ownerId: true,
          _count: { select: { chunks: true, feedback: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.document.count({ where }),
    ]);

    res.json({
      success: true,
      data: documents,
      meta: {
        total,
        limit,
        offset,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to list documents' });
  }
});

router.get('/types', (_req, res) => {
  res.json({ success: true, types: getSupportedDocxTypes() });
});

router.get('/:id', async (req, res) => {
  try {
    const document = await prisma.document.findUnique({
      where: { id: req.params.id, ...documentWhere(accessFromRequest(req)) },
      include: {
        chunks: { orderBy: { level: 'asc' }, take: 50 },
        feedback: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });

    if (!document) return res.status(404).json({ error: 'Document not found' });
    res.json({ success: true, data: document });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to load document' });
  }
});

router.get('/:id/export-docx', async (req, res) => {
  try {
    const access = accessFromRequest(req);
    const document = await prisma.document.findUnique({
      where: { id: req.params.id, ...documentWhere(access) },
      select: { id: true, ownerId: true, title: true, storageKey: true, metadata: true },
    });

    if (!document) return res.status(404).json({ error: 'Document not found' });

    const generation = (document.metadata as {
      generation?: { state?: string; outputSha256?: string };
    } | null)?.generation;
    if (!document.storageKey || generation?.state !== 'verified' || !generation.outputSha256) {
      return res.status(409).json({ error: 'Document does not have a verified DOCX deliverable' });
    }
    const title = (req.query.title as string) || document.title || 'document';
    const buffer = readVerifiedGeneratedDocument(
      document.ownerId,
      document.id,
      document.storageKey,
      generation.outputSha256,
    );

    const filename = sanitizeFilename(title) + '.docx';
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error: any) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: 'Document export failed' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const access = accessFromRequest(req);
    const document = await prisma.document.findUnique({
      where: { id: req.params.id, ...documentWhere(access) },
      select: { id: true, ownerId: true, storageKey: true },
    });
    if (!document) return res.status(404).json({ error: 'Document not found' });

    const stagedFile = stageGeneratedDocumentDeletion(
      document.ownerId,
      document.id,
      document.storageKey,
    );
    try {
      await prisma.document.delete({
        where: { id: document.id, ...documentWhere(access) },
      });
      stagedFile.commit();
    } catch (error) {
      stagedFile.rollback();
      throw error;
    }

    res.json({ success: true });
  } catch (error: any) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: 'Unable to delete document' });
  }
});

function sanitizeFilename(name: string): string {
  // NFD normalization separates combining diacritics (replaced by underscore)
  // À-ỹ covers Vietnamese letters; Đ-đ added explicitly (outside À-ỹ Unicode range)
  return name
    .normalize('NFD')
    .replace(/[^a-zA-Z0-9_À-ỹĐđ\-]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 60);
}

export { router };
export default router;
