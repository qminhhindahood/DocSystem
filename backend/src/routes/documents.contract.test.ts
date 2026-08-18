import express from 'express';
import { generateToken } from '../middleware/user_auth';
import { withHttpServer } from '../test/http';
import documentRoutes from './documents';

const mockUserFindUnique = jest.fn();
const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockFindUnique = jest.fn();
const mockDelete = jest.fn();
const mockReadVerified = jest.fn();
const mockStageGeneratedDeletion = jest.fn();
const mockStagedDeletion = { commit: jest.fn(), rollback: jest.fn() };

jest.mock('../services/template_storage_service', () => ({
  readVerifiedGeneratedDocument: (...args: unknown[]) => mockReadVerified(...args),
  stageGeneratedDocumentDeletion: (...args: unknown[]) => mockStageGeneratedDeletion(...args),
}));

jest.mock('../utils/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: any[]) => mockUserFindUnique(...args) },
    document: {
      findMany: (...args: any[]) => mockFindMany(...args),
      count: (...args: any[]) => mockCount(...args),
      findUnique: (...args: any[]) => mockFindUnique(...args),
      delete: (...args: any[]) => mockDelete(...args),
    },
  },
}));

describe('documents API tenant contract', () => {
  const token = generateToken({ userId: 'user-a', username: 'alice' });
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({ id: 'user-a', username: 'alice', isDisabled: false, sessionVersion: 0 });
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    mockFindUnique.mockResolvedValue(null);
    mockDelete.mockResolvedValue({ id: 'doc-a' });
    mockReadVerified.mockReturnValue(Buffer.from('stored-docx'));
    mockStageGeneratedDeletion.mockReturnValue(mockStagedDeletion);
    app = express();
    app.use(express.json());
    app.use('/api/documents', documentRoutes);
  });

  it.each([
    '/',
    '/types',
    '/doc-b',
    '/doc-b/export-docx',
  ])('returns 401 without a user token for GET %s', async (path) => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/documents${path}`);
      expect(response.status).toBe(401);
    });
  });

  it('exports only the owned fidelity-verified stored docx', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'doc-a', title: 'Owned', ownerId: 'user-a',
      storageKey: 'generated/user-a/doc-a.docx',
      metadata: { generation: {
        state: 'verified', outputSha256: 'a'.repeat(64), validationStatus: 'warnings',
        fidelityReport: { validationStatus: 'warnings', warnings: [{ code: 'FONT_SUBSTITUTED' }] },
      } },
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/documents/doc-a/export-docx`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(200);
      expect(mockReadVerified).toHaveBeenCalledWith(
        'user-a', 'doc-a', 'generated/user-a/doc-a.docx', 'a'.repeat(64),
      );
    });
  });

  it('exposes stored fidelity metadata in owned document detail', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'doc-a', ownerId: 'user-a', title: 'Owned',
      metadata: { generation: {
        state: 'verified', validationStatus: 'warnings',
        fidelityReport: {
          passed: false, validationStatus: 'warnings', violations: [], repairs: [], pageCount: 1,
          warnings: [{ code: 'FONT_SUBSTITUTED', severity: 'warning', message: 'Font substituted' }],
        },
      } },
      chunks: [], feedback: [],
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/documents/doc-a`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: { metadata: { generation: { fidelityReport: {
          validationStatus: 'warnings', warnings: [{ code: 'FONT_SUBSTITUTED' }],
        } } } },
      });
    });
  });

  it('refuses export when the stored generation is not verified', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'doc-a', title: 'Owned', ownerId: 'user-a', storageKey: null,
      metadata: { generation: { state: 'rendering' } },
    });
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/documents/doc-a/export-docx`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(409);
      expect(mockReadVerified).not.toHaveBeenCalled();
    });
  });

  it('scopes document listing and count to the authenticated owner', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/documents`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { ownerId: 'user-a' },
      }));
      expect(mockCount).toHaveBeenCalledWith({ where: { ownerId: 'user-a' } });
    });
  });

  it('accepts and reports the maximum page size and offset', async () => {
    mockCount.mockResolvedValue(250);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(baseUrl + '/api/documents?limit=100&offset=10000&q=%20owned%20', {
        headers: { Authorization: 'Bearer ' + token },
      });

      expect(response.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
        take: 100,
        skip: 10000,
        where: expect.objectContaining({
          OR: [
            { title: { contains: 'owned', mode: 'insensitive' } },
            { content: { contains: 'owned', mode: 'insensitive' } },
          ],
        }),
      }));
      await expect(response.json()).resolves.toMatchObject({
        meta: { total: 250, limit: 100, offset: 10000, pages: 3 },
      });
    });
  });

  it.each([
    'limit=20junk',
    'limit=0',
    'limit=101',
    'offset=-1',
    'offset=10001',
    `q=${'x'.repeat(201)}`,
    `docType=${'x'.repeat(101)}`,
    `status=${'x'.repeat(51)}`,
  ])('rejects malformed or excessive listing query %s', async (query) => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/documents?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(400);
      expect(mockFindMany).not.toHaveBeenCalled();
      expect(mockCount).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['/doc-b', 'detail'],
    ['/doc-b/export-docx', 'export'],
  ])('returns 404 for a foreign document %s request', async (path) => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/documents${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(404);
      expect(mockFindUnique).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'doc-b', ownerId: 'user-a' },
      }));
    });
  });

  it('deletes only an owned document for production-smoke cleanup', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'doc-a', ownerId: 'user-a', storageKey: 'generated/user-a/doc-a.docx',
    });
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/documents/doc-a`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'doc-a', ownerId: 'user-a' } });
      expect(mockStageGeneratedDeletion).toHaveBeenCalledWith(
        'user-a', 'doc-a', 'generated/user-a/doc-a.docx',
      );
      expect(mockStagedDeletion.commit).toHaveBeenCalled();
    });
  });

  it('does not delete a foreign document', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/documents/doc-b`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(404);
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });
});
