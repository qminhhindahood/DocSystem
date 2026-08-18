import express from 'express';
import { generateToken } from '../middleware/user_auth';
import { withHttpServer } from '../test/http';
import ragRoutes from './rag';
import { prisma } from '../utils/prisma';
import { ragService } from '../services/rag_service';
import fs from 'fs';

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    promises: { ...actual.promises, unlink: jest.fn().mockResolvedValue(undefined) },
  };
});

jest.mock('../utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn() },
    document: {
      create: jest.fn().mockResolvedValue({ id: 'doc-1', title: 'reference', docType: 'cong-van', ingestionStatus: 'uploaded' }),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ingestionJob: { create: jest.fn().mockResolvedValue({ id: 'job-1' }) },
  },
}));

jest.mock('../services/rag_service', () => ({
  ragService: { search: jest.fn().mockResolvedValue([]) },
}));

describe('RAG API tenant contract', () => {
  const token = generateToken({ userId: 'user-a', username: 'alice' });
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'user-a', username: 'alice', isDisabled: false, sessionVersion: 0,
    });
    (prisma.document.create as jest.Mock).mockResolvedValue({
      id: 'doc-1', title: 'reference', docType: 'cong-van', ingestionStatus: 'uploaded',
    });
    (prisma.document.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.document.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.ingestionJob.create as jest.Mock).mockResolvedValue({ id: 'job-1' });
    (prisma.$transaction as jest.Mock).mockImplementation(async (operation) => operation(prisma));
    (ragService.search as jest.Mock).mockResolvedValue([]);
    app = express();
    app.use(express.json());
    app.use('/api/rag', ragRoutes);
  });

  it.each([
    ['POST', '/search'],
    ['GET', '/status/doc-b'],
    ['GET', '/documents'],
    ['POST', '/index'],
    ['POST', '/upload'],
  ])('returns 401 without a user token for %s %s', async (method, path) => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ query: 'owned evidence' }) : undefined,
      });
      expect(response.status).toBe(401);
    });
  });

  it('passes a role-free owner scope into RAG search', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query: 'owned evidence', topK: 3, docType: 'cong-van' }),
      });

      expect(response.status).toBe(200);
      expect(ragService.search).toHaveBeenCalledWith(
        'owned evidence', 3, 'cong-van', { kind: 'user', userId: 'user-a' },
      );
    });
  });

  it('returns 404 for a foreign ingestion-status lookup', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag/status/doc-b`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(404);
      expect(prisma.document.findUnique).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'doc-b', ownerId: 'user-a' },
      }));
    });
  });

  it('scopes indexed-document listing to the authenticated owner', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag/documents`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(200);
      expect(prisma.document.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { ownerId: 'user-a' },
      }));
    });
  });

  it.each(['/index', '/upload'])('creates and queues %s uploads with the authenticated owner', async (path) => {
    await withHttpServer(app, async (baseUrl) => {
      const formData = new FormData();
      formData.append('file', new Blob([new Uint8Array(Buffer.from('%PDF-1.4\n'))], { type: 'application/pdf' }), 'reference.pdf');
      formData.append('documentType', 'cong-van');
      formData.append('issuingAuthority', 'Bộ Giáo dục và Đào tạo');
      formData.append('sourceVersion', '2026-01');
      formData.append('metadata', JSON.stringify({ pageCount: 12 }));

      const response = await fetch(`${baseUrl}/api/rag${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      expect(response.status).toBe(202);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.document.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          title: 'reference',
          docType: 'cong-van',
          owner: { connect: { id: 'user-a' } },
          issuingAuthority: 'Bộ Giáo dục và Đào tạo',
          sourceVersion: '2026-01',
          metadata: { pageCount: 12 },
        }),
      }));
      expect(prisma.ingestionJob.create).toHaveBeenCalledWith({
        data: { documentId: 'doc-1' },
      });
    });
  });

  it('rejects a MIME-spoofed upload before writing or creating database rows', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([new Uint8Array(Buffer.from('%PDFoops'))], { type: 'application/pdf' }),
        'spoofed.pdf',
      );
      formData.append('documentType', 'cong-van');

      const response = await fetch(`${baseUrl}/api/rag/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      expect(response.status).toBe(400);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  it('rejects a non-PDF filename even when MIME and signature look valid', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([new Uint8Array(Buffer.from('%PDF-1.4\n'))], { type: 'application/pdf' }),
        'renamed.txt',
      );
      formData.append('documentType', 'cong-van');

      const response = await fetch(`${baseUrl}/api/rag/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      expect(response.status).toBe(400);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
