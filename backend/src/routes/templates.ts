import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { prisma } from '../utils/prisma';
import { userAuthMiddleware, requireAuth } from '../middleware/user_auth';
import { validate } from '../middleware/validation';
import { uploadTemplateFromPath, readTemplateFile, readTemplatePreview, stageTemplateFileDeletion } from '../services/template_storage_service';
import { fuseTemplate, recompileSchema } from '../services/template_compiler';
import { templateUploadLimiter } from '../middleware/ratelimit';

const router = express.Router();
const templateUploadTempDir = process.env.UPLOAD_TMP_DIR || path.join(os.tmpdir(), 'docai-template-uploads');

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.promises.mkdir(templateUploadTempDir, { recursive: true })
        .then(() => cb(null, templateUploadTempDir))
        .catch(error => cb(error, templateUploadTempDir));
    },
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.upload`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Allow .docx MIME types — accept both common variants
    const allowed = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/octet-stream', // fallback when upload tool strips MIME
    ];
    if (!file.originalname.toLowerCase().endsWith('.docx') || !allowed.includes(file.mimetype)) {
      return cb(new Error('Only DOCX files are allowed'));
    }
    cb(null, true);
  },
});

function positiveEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

// All template routes require user auth.
router.use(userAuthMiddleware, requireAuth);

// Schemas
const CreateTemplateSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(200),
    docType: z.string().trim().min(1).max(50).optional(),
  }),
});

const UpdateTemplateSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(200).optional(),
    docType: z.string().trim().min(1).max(50).optional(),
    header: z.string().max(5000).optional(),
    signatureBlock: z.string().max(5000).optional(),
    description: z.string().max(2000).optional(),
    isActive: z.boolean().optional(),
  }),
});

const SemanticMapSchema = z.object({
  version: z.literal(1),
  documentFingerprint: z.string().min(1).max(256),
  mappings: z.array(z.object({
    fieldName: z.string().min(1).max(100),
    locator: z.string().min(1).max(1000).nullable(),
    kind: z.string().min(1).max(100),
    confidence: z.number().min(0).max(1),
  })).max(200),
  ignoredLocators: z.array(z.string().min(1).max(1000)).max(500),
});

interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

// POST /api/templates — upload a new template
router.post('/', templateUploadLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const ownerId = req.user!.userId;
  const [total, pending] = await Promise.all([
    prisma.template.count({ where: { ownerId } }),
    prisma.template.count({ where: { ownerId, status: { in: ['UPLOADED', 'ANALYZING'] } } }),
  ]).catch(error => {
    next(error);
    return [-1, -1] as const;
  });
  if (total < 0) return;
  if (total >= positiveEnv('MAX_TEMPLATES_PER_USER', 100)) {
    return res.status(409).json({ error: 'Template quota exceeded' });
  }
  if (pending >= positiveEnv('MAX_PENDING_TEMPLATES_PER_USER', 5)) {
    return res.status(429).json({ error: 'Too many templates are waiting for analysis' });
  }
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File size exceeds 20 MB limit' });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });

    const multerReq = req as MulterRequest;
    if (!multerReq.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const parsed = CreateTemplateSchema.safeParse({ body: req.body });
    if (!parsed.success) {
      await fs.promises.unlink(multerReq.file.path).catch(() => undefined);
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
      });
    }

    const { name, docType } = parsed.data.body;
    try {
      const result = await uploadTemplateFromPath(ownerId, name, multerReq.file.path, docType);
      const template = await prisma.template.update({
        where: { id: result.id },
        data: { docType: docType ?? null },
        select: { id: true, name: true, docType: true, status: true, fileSize: true, createdAt: true },
      });

      res.status(201).json({ success: true, template });
    } catch (error: any) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      console.error('Error uploading template:', error);
      res.status(500).json({ error: 'Failed to upload template' });
    } finally {
      await fs.promises.unlink(multerReq.file.path).catch(() => undefined);
    }
  });
});

// PUT /api/templates/:id/mapping — validate and compile a reviewed semantic map
router.put('/:id/mapping', async (req, res) => {
  const parsed = SemanticMapSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.errors.map(error => ({
        field: error.path.join('.'),
        message: error.message,
      })),
    });
  }

  try {
    const generationSchema = await recompileSchema(
      req.params.id,
      req.user!.userId,
      parsed.data,
    );
    const template = await prisma.template.findFirst({
      where: { id: req.params.id, ownerId: req.user!.userId },
      select: { id: true, status: true, analysisConfidence: true, rejectionCode: true },
    });
    res.json({ success: true, template, generationSchema });
  } catch (error: any) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message, code: error.code });
    console.error('Error reviewing template mapping:', error);
    res.status(500).json({ error: 'Failed to review template mapping' });
  }
});

// GET /api/templates — list owner-scoped templates
router.get('/', async (req, res) => {
  try {
    const templates = await prisma.template.findMany({
      where: { ownerId: req.user!.userId },
      select: {
        id: true,
        name: true,
        docType: true,
        status: true,
        analysisConfidence: true,
        rejectionCode: true,
        rejectionReason: true,
        createdAt: true,
        fileSize: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, templates });
  } catch (error: any) {
    console.error('Error listing templates:', error);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

// POST /api/templates/:id/analyze — retry a failed/reviewable owner-scoped analysis
router.post('/:id/analyze', async (req, res) => {
  try {
    const template = await prisma.template.findFirst({
      where: { id: req.params.id, ownerId: req.user!.userId },
      select: { id: true, ownerId: true, originalPath: true, originalSha256: true },
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    if (!template.originalPath || !template.originalSha256) {
      return res.status(409).json({ error: 'Template original is unavailable' });
    }
    await fuseTemplate(template.id, template.ownerId, {
      templateId: template.id,
      relativePath: template.originalPath,
      sha256: template.originalSha256,
    });
    const updated = await prisma.template.findFirst({
      where: { id: template.id, ownerId: template.ownerId },
      select: { id: true, status: true, analysisConfidence: true, rejectionCode: true },
    });
    res.json({ success: true, template: updated });
  } catch (error: any) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message, code: error.code });
    res.status(500).json({ error: 'Template analysis failed' });
  }
});

// GET /api/templates/:id/previews/:page?variant=labeled|baseline
router.get('/:id/previews/:page', async (req, res) => {
  const page = Number.parseInt(req.params.page, 10);
  const variant = req.query.variant === 'baseline' ? 'baselinePages' : 'labeledPages';
  if (!Number.isInteger(page) || page < 1 || page > 1_000) {
    return res.status(400).json({ error: 'Invalid preview page' });
  }
  try {
    const template = await prisma.template.findFirst({
      where: { id: req.params.id, ownerId: req.user!.userId },
      select: { id: true, previewMetadata: true },
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const metadata = template.previewMetadata as { baselinePages?: string[]; labeledPages?: string[] } | null;
    const storedPath = metadata?.[variant]?.[page - 1];
    if (!storedPath) return res.status(404).json({ error: 'Template preview not found' });
    res.type('png').send(readTemplatePreview(template.id, storedPath));
  } catch (error: any) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: 'Failed to read template preview' });
  }
});

// GET /api/templates/:id — get one owner-scoped template
router.get('/:id', async (req, res) => {
  try {
    const template = await prisma.template.findFirst({
      where: { id: req.params.id, ownerId: req.user!.userId },
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true, template });
  } catch (error: any) {
    console.error('Error getting template:', error);
    res.status(500).json({ error: 'Failed to get template' });
  }
});

// PATCH /api/templates/:id — update template metadata
router.patch('/:id', validate(UpdateTemplateSchema), async (req, res) => {
  try {
    const existing = await prisma.template.findFirst({
      where: { id: req.params.id, ownerId: req.user!.userId },
    });
    if (!existing) return res.status(404).json({ error: 'Template not found' });

    const template = await prisma.template.update({
      where: { id: req.params.id },
      data: req.body,
      select: {
        id: true, name: true, docType: true, status: true,
        header: true, signatureBlock: true, description: true,
        isActive: true, createdAt: true, updatedAt: true,
      },
    });
    res.json({ success: true, template });
  } catch (error: any) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// DELETE /api/templates/:id — delete owner-scoped template
router.delete('/:id', async (req, res) => {
  try {
    const template = await prisma.template.findFirst({
      where: { id: req.params.id, ownerId: req.user!.userId },
      select: { id: true, ownerId: true },
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const staged = stageTemplateFileDeletion(template.ownerId, template.id);
    try {
      await prisma.template.delete({ where: { id: template.id } });
      staged.commit();
    } catch (error) {
      staged.rollback();
      throw error;
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// GET /api/templates/:id/download — download original file
router.get('/:id/download', async (req, res) => {
  try {
    const template = await prisma.template.findFirst({
      where: { id: req.params.id, ownerId: req.user!.userId },
      select: { id: true, ownerId: true, name: true },
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const buffer = readTemplateFile(template.ownerId, template.id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(template.name)}.docx"`);
    res.send(buffer);
  } catch (error: any) {
    if (error.statusCode === 404) return res.status(404).json({ error: 'Template file not found' });
    console.error('Error downloading template:', error);
    res.status(500).json({ error: 'Failed to download template' });
  }
});

export default router;
