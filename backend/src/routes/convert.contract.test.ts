import express from 'express';
import { generateToken } from '../middleware/user_auth';
import { withHttpServer } from '../test/http';
import convertRoutes from './convert';

const mockUserFindUnique = jest.fn();
const mockSubmitConversion = jest.fn();
const mockGetConversionStatus = jest.fn();
const mockGetConversionResult = jest.fn();
const mockGetConversionReport = jest.fn();
const mockSubmitBulkConversion = jest.fn();

jest.mock('../utils/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: any[]) => mockUserFindUnique(...args) },
  },
}));

jest.mock('../services/conversion_service_client', () => ({
  submitConversion: (...args: unknown[]) => mockSubmitConversion(...args),
  getConversionStatus: (...args: unknown[]) => mockGetConversionStatus(...args),
  getConversionResult: (...args: unknown[]) => mockGetConversionResult(...args),
  getConversionReport: (...args: unknown[]) => mockGetConversionReport(...args),
  submitBulkConversion: (...args: unknown[]) => mockSubmitBulkConversion(...args),
}));

describe('convert API contract', () => {
  const token = generateToken({ userId: 'user-a', username: 'alice' });
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({
      id: 'user-a', username: 'alice', isDisabled: false, sessionVersion: 0,
    });
    app = express();
    app.use(express.json());
    app.use('/api/convert', convertRoutes);
  });

  it.each([
    ['POST', '/'],
    ['GET', '/job-1'],
    ['GET', '/job-1/result'],
  ])('returns 401 without a user token for %s %s', async (method, path) => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/convert${path}`, {
        method,
      });
      expect(response.status).toBe(401);
    });
  });

  it('rejects POST without a file', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/convert/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(400);
    });
  });

  it('accepts a PDF upload and returns a jobId', async () => {
    mockSubmitConversion.mockResolvedValue({ jobId: 'job-123', mode: 'queue' });
    await withHttpServer(app, async (baseUrl) => {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], {
          type: 'application/pdf',
        }),
        'doc.pdf',
      );
      const response = await fetch(`${baseUrl}/api/convert/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.jobId).toBe('job-123');
      // userId forwarded for quota
      expect(mockSubmitConversion).toHaveBeenCalledWith(
        expect.any(String), 'doc.pdf', 'user-a',
      );
    });
  });

  it('rejects non-PDF magic bytes', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array([0x4e, 0x4f, 0x54, 0x50, 0x44, 0x46])], {
          type: 'application/pdf',
        }),
        'fake.pdf',
      );
      const response = await fetch(`${baseUrl}/api/convert/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      expect(response.status).toBe(400);
      expect(mockSubmitConversion).not.toHaveBeenCalled();
    });
  });

  it('proxies job status', async () => {
    mockGetConversionStatus.mockResolvedValue({
      jobId: 'job-1', status: 'completed', progress: 1.0,
      resultUrl: '/convert/job-1/result', confidence: 0.9, degradedPages: [],
      userId: 'user-a',
    });
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/convert/job-1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('completed');
      expect(body.confidence).toBe(0.9);
    });
  });

  it('returns 404 for unknown job status', async () => {
    const err: any = new Error('not found');
    err.response = { status: 404 };
    mockGetConversionStatus.mockRejectedValue(err);
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/convert/nope`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(404);
    });
  });

  it('proxies the confidence review report', async () => {
    mockGetConversionStatus.mockResolvedValue({
      jobId: 'job-1', status: 'completed_with_warnings', progress: 1.0, userId: 'user-a',
    });
    mockGetConversionReport.mockResolvedValue({
      jobId: 'job-1', status: 'completed_with_warnings', confidence: 0.72,
      degradedPages: [3],
      flaggedBlocks: [{ index: 4, type: 'paragraph', page: 2, confidence: 0.4, preview: 'mờ' }],
      lowConfidencePages: [{ page: 2, avg_confidence: 0.55, blocks: 6 }],
      demotions: 1, pageTypes: { DIGITAL_TEXT: 3 }, warnings: [], timings: { total_s: 1.2 },
    });
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/convert/job-1/report`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.flaggedBlocks).toHaveLength(1);
      expect(body.lowConfidencePages[0].page).toBe(2);
      expect(body.demotions).toBe(1);
    });
  });

  it('accepts a bulk upload and returns per-file jobs', async () => {
    mockSubmitBulkConversion.mockResolvedValue({
      jobs: [
        { filename: 'a.pdf', jobId: 'job-a', error: null },
        { filename: 'b.pdf', jobId: null, error: 'Password-protected PDFs are not supported.' },
      ],
      count: 2,
    });
    await withHttpServer(app, async (baseUrl) => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      const form = new FormData();
      form.append('files', new Blob([pdfBytes], { type: 'application/pdf' }), 'a.pdf');
      form.append('files', new Blob([pdfBytes], { type: 'application/pdf' }), 'b.pdf');
      const response = await fetch(`${baseUrl}/api/convert/bulk`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.count).toBe(2);
      expect(body.jobs[0].jobId).toBe('job-a');
      expect(body.jobs[1].error).toContain('Password');
    });
  });

  it('rejects bulk without files', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/convert/bulk`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(400);
    });
  });

  it('streams the DOCX result', async () => {
    mockGetConversionStatus.mockResolvedValue({
      jobId: 'job-1', status: 'completed', progress: 1.0, userId: 'user-a',
    });
    mockGetConversionResult.mockResolvedValue(Buffer.from('PK-docx-bytes'));
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/convert/job-1/result`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('wordprocessingml');
      const text = await response.text();
      expect(text).toBe('PK-docx-bytes');
    });
  });

  describe('owner-scoped job reads (ticket 03)', () => {
    it('lets the owner read job status', async () => {
      mockGetConversionStatus.mockResolvedValue({
        jobId: 'job-1', status: 'completed', progress: 1.0,
        resultUrl: '/convert/job-1/result', confidence: 0.9, degradedPages: [],
        userId: 'user-a',
      });
      await withHttpServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/convert/job-1`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.status).toBe('completed');
        // The owner field is internal; it is not echoed to clients.
        expect(body.userId).toBeUndefined();
      });
    });

    it('returns 404 when another user owns the job (status)', async () => {
      mockGetConversionStatus.mockResolvedValue({
        jobId: 'job-1', status: 'completed', progress: 1.0, userId: 'user-b',
      });
      await withHttpServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/convert/job-1`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(response.status).toBe(404);
      });
    });

    it('returns 404 when the job has no owner recorded', async () => {
      mockGetConversionStatus.mockResolvedValue({
        jobId: 'job-1', status: 'completed', progress: 1.0,
      });
      await withHttpServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/convert/job-1`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(response.status).toBe(404);
      });
    });

    it('returns 404 when another user owns the job (report)', async () => {
      mockGetConversionStatus.mockResolvedValue({
        jobId: 'job-1', status: 'completed', progress: 1.0, userId: 'user-b',
      });
      await withHttpServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/convert/job-1/report`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(response.status).toBe(404);
        expect(mockGetConversionReport).not.toHaveBeenCalled();
      });
    });

    it('checks ownership before streaming the result', async () => {
      mockGetConversionStatus.mockResolvedValue({
        jobId: 'job-1', status: 'completed', progress: 1.0, userId: 'user-b',
      });
      await withHttpServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/convert/job-1/result`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(response.status).toBe(404);
        expect(mockGetConversionResult).not.toHaveBeenCalled();
      });
    });
  });
});
