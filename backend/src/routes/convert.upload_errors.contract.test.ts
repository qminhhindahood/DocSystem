/**
 * Upload error contract (comprehensive review remediation, 2026-08-28).
 *
 * Multer failures are normalized at the route boundary:
 *   - wrong MIME type        -> HTTP 400
 *   - file over 50 MB        -> HTTP 413
 *   - unexpected failures    -> generic HTTP 500 (error handler)
 * Partially staged files never survive a rejected upload, and the
 * conversion service is never called for a rejected request.
 */
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateToken } from '../middleware/user_auth';
import { withHttpServer } from '../test/http';
import { MAX_FILE_SIZE } from '../middleware/validation';

const mockUserFindUnique = jest.fn();
const mockSubmitConversion = jest.fn();
const mockSubmitBulkConversion = jest.fn();
const mockGetVisionConfig = jest.fn();

jest.mock('../services/llm_config_service', () => ({
  getVisionConfig: (...args: unknown[]) => mockGetVisionConfig(...args),
}));

jest.mock('../utils/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: any[]) => mockUserFindUnique(...args) },
  },
}));

jest.mock('../services/conversion_service_client', () => ({
  submitConversion: (...args: unknown[]) => mockSubmitConversion(...args),
  getConversionStatus: jest.fn(),
  getConversionResult: jest.fn(),
  getConversionReport: jest.fn(),
  submitBulkConversion: (...args: unknown[]) => mockSubmitBulkConversion(...args),
}));

describe('convert upload error contract', () => {
  const token = generateToken({ userId: 'user-a', username: 'alice' });
  let app: express.Express;
  let uploadDir: string;
  let incomingDir: string;

  beforeAll(() => {
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-error-contract-'));
    incomingDir = path.join(uploadDir, '.incoming');
    process.env.UPLOAD_DIR = uploadDir;
    // convert.ts reads UPLOAD_DIR at module load; require after the env is set.
    const convertRoutes = require('./convert').default;
    app = express();
    app.use('/api/convert', convertRoutes);
  });

  afterAll(() => {
    fs.rmSync(uploadDir, { recursive: true, force: true });
    delete process.env.UPLOAD_DIR;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({
      id: 'user-a', username: 'alice', isDisabled: false, sessionVersion: 0,
    });
    mockGetVisionConfig.mockResolvedValue(null);
  });

  const stagedFiles = (): string[] =>
    fs.existsSync(incomingDir) ? fs.readdirSync(incomingDir) : [];

  const pdfForm = () => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], {
        type: 'application/pdf',
      }),
      'doc.pdf',
    );
    return form;
  };

  it('rejects a wrong-MIME upload with HTTP 400 and leaves no staged file', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array([1, 2, 3])], { type: 'text/plain' }),
        'notes.txt',
      );
      const response = await fetch(`${baseUrl}/api/convert/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/PDF/i);
      expect(mockSubmitConversion).not.toHaveBeenCalled();
    });
    expect(stagedFiles()).toEqual([]);
  });

  it('rejects an oversized upload with HTTP 413 and removes the partial staged file', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const oversized = new Uint8Array(MAX_FILE_SIZE + 1); // 50 MB + 1 byte
      oversized[0] = 0x25; // %PDF magic is irrelevant — size trips first
      const form = new FormData();
      form.append(
        'file',
        new Blob([oversized], { type: 'application/pdf' }),
        'huge.pdf',
      );
      const response = await fetch(`${baseUrl}/api/convert/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      expect(response.status).toBe(413);
      expect(mockSubmitConversion).not.toHaveBeenCalled();
    });
    expect(stagedFiles()).toEqual([]);
  });

  it('rejects a bulk batch with a wrong-MIME file using HTTP 400 and cleans every staged file', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      const form = new FormData();
      form.append('files', new Blob([pdfBytes], { type: 'application/pdf' }), 'a.pdf');
      form.append('files', new Blob([new Uint8Array([1, 2, 3])], { type: 'text/plain' }), 'notes.txt');
      const response = await fetch(`${baseUrl}/api/convert/bulk`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      expect(response.status).toBe(400);
      expect(mockSubmitBulkConversion).not.toHaveBeenCalled();
    });
    expect(stagedFiles()).toEqual([]);
  });

  it('rejects an oversized bulk file with HTTP 413 and cleans every staged file', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      const oversized = new Uint8Array(MAX_FILE_SIZE + 1);
      const form = new FormData();
      form.append('files', new Blob([pdfBytes], { type: 'application/pdf' }), 'a.pdf');
      form.append('files', new Blob([oversized], { type: 'application/pdf' }), 'huge.pdf');
      const response = await fetch(`${baseUrl}/api/convert/bulk`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      expect(response.status).toBe(413);
      expect(mockSubmitBulkConversion).not.toHaveBeenCalled();
    });
    expect(stagedFiles()).toEqual([]);
  });

  it('still accepts a valid PDF upload (no regression)', async () => {
    mockSubmitConversion.mockResolvedValue({ jobId: 'job-ok', mode: 'queue' });
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/convert/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: pdfForm(),
      });
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.jobId).toBe('job-ok');
    });
    expect(stagedFiles()).toEqual([]);
  });
});
