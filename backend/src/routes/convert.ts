/**
 * Conversion routes (P3) — PDF -> DOCX via the standalone conversion-service.
 *
 *   POST /api/convert            multipart upload -> { jobId }
 *   GET  /api/convert/:jobId     -> { status, progress, resultUrl, confidence, degradedPages }
 *   GET  /api/convert/:jobId/result -> DOCX download
 *
 * Auth: existing JWT (userAuthMiddleware + requireAuth). The authenticated
 * userId is forwarded to the service as X-User-Id for per-user quota.
 */
import express, { Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { MAX_FILE_SIZE } from '../middleware/validation';
import { userAuthMiddleware, requireAuth } from '../middleware/user_auth';
import { uploadLimiter } from '../middleware/ratelimit';
import {
  submitConversion,
  getConversionStatus,
  getConversionResult,
  getConversionReport,
  submitBulkConversion,
} from '../services/conversion_service_client';
import { getVisionConfig } from '../services/llm_config_service';

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
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  },
});

const router = express.Router();

type MulterRequest = Request & { file?: Express.Multer.File };

/** Best-effort removal of any staging files multer recorded on the request. */
function removeStagedFiles(req: Request): void {
  const multerReq = req as MulterRequest & { files?: Express.Multer.File[] };
    const staged: Express.Multer.File[] = [];
    if (multerReq.file) staged.push(multerReq.file);
    if (Array.isArray(multerReq.files)) staged.push(...multerReq.files);
    for (const file of staged) {
      void fs.promises.unlink(file.path).catch(() => undefined);
    }
}

/**
 * Upload error contract (comprehensive review remediation, 2026-08-28):
 * normalize Multer failures at the route boundary. Wrong MIME type -> 400,
 * file over the 50 MB limit -> 413, unexpected errors keep the generic 500
 * via the error handler. Partially staged files never survive a rejection.
 */
function withUploadErrorContract(
  parse: (req: Request, res: Response, next: (err?: unknown) => void) => void,
) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    parse(req, res, (err?: unknown) => {
      if (!err) return next();
      removeStagedFiles(req);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res
            .status(413)
            .json({ error: `File exceeds the ${MAX_FILE_SIZE / (1024 * 1024)} MB limit` });
        }
        return res.status(400).json({ error: 'Upload rejected' });
      }
      if (err instanceof Error && err.message === 'Only PDF files are allowed') {
        return res.status(400).json({ error: err.message });
      }
      return next(err);
    });
  };
}

/**
 * Owner-scope guard (ticket 03): verify the Conversion Job belongs to the
 * authenticated user before anything is returned. Unknown job and
 * not-your-job are indistinguishable (both surface as 404), so job ids are
 * never confirmed to strangers. A job with no recorded owner is denied.
 */
async function assertJobOwner(jobId: string, userId: string): Promise<void> {
  const status = await getConversionStatus(jobId);
  if (status.userId !== userId) {
    const err: any = new Error('Unknown jobId');
    err.response = { status: 404 };
    throw err;
  }
}

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

/** POST /api/convert — upload a PDF, start a conversion job. */
router.post(
  '/',
  userAuthMiddleware,
  requireAuth,
  uploadLimiter,
  withUploadErrorContract(upload.single('file')),
  async (req: Request, res: Response) => {
    const multerReq = req as MulterRequest;
    const file = multerReq.file;
    if (!file) {
      return res.status(400).json({ error: 'A PDF file is required (field: file)' });
    }
    // Staged cleanup happens BEFORE the response is sent: the upload contract
    // is that once the client sees the status, `.incoming` is already clean
    // (cleanup after the response races the client and leaks staging files).
    const removeStaged = () => fs.promises.unlink(file.path).catch(() => undefined);
    try {
      if (!(await isPdfFile(file.path))) {
        await removeStaged();
        return res.status(400).json({ error: 'Invalid PDF file' });
      }
      const userId = req.user!.userId;
      // BYOK: attach the caller's decrypted Gemini config (if any) so scanned
      // pages can be transcribed. Null when the user has no usable key — the
      // conversion service answers scanned uploads with its upfront 422.
      const vision = await getVisionConfig(userId);
      const result = await submitConversion(file.path, file.originalname || 'upload.pdf', userId, vision);
      await removeStaged();
      return res.status(202).json({ success: true, jobId: result.jobId });
    } catch (error: any) {
      await removeStaged();
      const status = error?.response?.status;
      const detail = error?.response?.data?.detail;
      if (status === 422 || status === 429 || status === 400) {
        return res.status(status).json({ error: detail || 'Conversion rejected' });
      }
      console.error('Conversion submit error:', error?.message || error);
      return res.status(502).json({ error: 'Conversion service unavailable' });
    }
  },
);

/** POST /api/convert/bulk — upload several PDFs, one job each (P4). */
router.post(
  '/bulk',
  userAuthMiddleware,
  requireAuth,
  uploadLimiter,
  withUploadErrorContract(upload.array('files', 10)),
  async (req: Request, res: Response) => {
    const multerReq = req as Request & { files?: Express.Multer.File[] };
    const files = multerReq.files ?? [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'At least one PDF file is required (field: files)' });
    }
    const staged: Array<{ path: string; name: string }> = [];
    // Same contract as single upload: staging is clean before the client
    // sees the response (see removeStaged note above).
    const removeStaged = () =>
      Promise.all(files.map((f) => fs.promises.unlink(f.path).catch(() => undefined)));
    try {
      for (const file of files) {
        if (!(await isPdfFile(file.path))) {
          await removeStaged();
          return res.status(400).json({ error: `Invalid PDF file: ${file.originalname}` });
        }
        staged.push({ path: file.path, name: file.originalname || 'upload.pdf' });
      }
      const vision = await getVisionConfig(req.user!.userId);
      const result = await submitBulkConversion(staged, req.user!.userId, vision);
      await removeStaged();
      return res.status(202).json({ success: true, ...result });
    } catch (error: any) {
      await removeStaged();
      const status = error?.response?.status;
      const detail = error?.response?.data?.detail;
      if (status === 422 || status === 429 || status === 400) {
        return res.status(status).json({ error: detail || 'Bulk conversion rejected' });
      }
      console.error('Bulk conversion submit error:', error?.message || error);
      return res.status(502).json({ error: 'Conversion service unavailable' });
    }
  },
);

/** GET /api/convert/:jobId — poll job status. */
router.get('/:jobId', userAuthMiddleware, requireAuth, async (req, res) => {
  try {
    await assertJobOwner(req.params.jobId, req.user!.userId);
    const status = await getConversionStatus(req.params.jobId);
    const { userId: _owner, ...publicStatus } = status;
    return res.json({ success: true, ...publicStatus });
  } catch (error: any) {
    if (error?.response?.status === 404) {
      return res.status(404).json({ error: 'Unknown jobId' });
    }
    console.error('Conversion status error:', error?.message || error);
    return res.status(502).json({ error: 'Conversion service unavailable' });
  }
});

/** GET /api/convert/:jobId/report — confidence-flag review report (P4). */
router.get('/:jobId/report', userAuthMiddleware, requireAuth, async (req, res) => {
  try {
    await assertJobOwner(req.params.jobId, req.user!.userId);
    const report = await getConversionReport(req.params.jobId);
    const { userId: _owner, ...publicReport } = report;
    return res.json({ success: true, ...publicReport });
  } catch (error: any) {
    if (error?.response?.status === 404) {
      return res.status(404).json({ error: 'Unknown jobId' });
    }
    console.error('Conversion report error:', error?.message || error);
    return res.status(502).json({ error: 'Conversion service unavailable' });
  }
});

/** GET /api/convert/:jobId/result — download the converted DOCX. */
router.get('/:jobId/result', userAuthMiddleware, requireAuth, async (req, res) => {
  try {
    await assertJobOwner(req.params.jobId, req.user!.userId);
    const buffer = await getConversionResult(req.params.jobId);
    if (!buffer) {
      return res.status(409).json({ error: 'Result not ready or expired' });
    }
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="converted-${req.params.jobId}.docx"`,
    );
    return res.send(buffer);
  } catch (error: any) {
    if (error?.response?.status === 404) {
      return res.status(404).json({ error: 'Unknown jobId' });
    }
    console.error('Conversion result error:', error?.message || error);
    return res.status(502).json({ error: 'Conversion service unavailable' });
  }
});

export default router;
