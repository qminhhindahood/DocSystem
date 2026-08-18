import express from 'express';
import { generateToken } from '../middleware/user_auth';
import { withHttpServer } from '../test/http';
import templateRoutes from './templates';

const mockUserFindUnique = jest.fn();
const mockFindMany = jest.fn();
const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockCount = jest.fn();
const mockFuseTemplate = jest.fn();
const mockRecompileSchema = jest.fn();

jest.mock('../utils/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: any[]) => mockUserFindUnique(...args) },
    template: {
      findMany: (...args: any[]) => mockFindMany(...args),
      findFirst: (...args: any[]) => mockFindFirst(...args),
      create: (...args: any[]) => mockCreate(...args),
      update: (...args: any[]) => mockUpdate(...args),
      delete: (...args: any[]) => mockDelete(...args),
      count: (...args: any[]) => mockCount(...args),
    },
  },
}));

jest.mock('../services/template_storage_service', () => ({
  uploadTemplateFromPath: jest.fn().mockResolvedValue({ id: 'tmpl-new', sha256: 'a'.repeat(64) }),
  stageTemplateFileDeletion: jest.fn().mockReturnValue({ commit: jest.fn(), rollback: jest.fn() }),
  readTemplateFile: jest.fn().mockReturnValue(Buffer.from('mock-docx-content')),
  readTemplatePreview: jest.fn().mockReturnValue(Buffer.from('png-content')),
}));

jest.mock('../services/template_compiler', () => ({
  fuseTemplate: (...args: unknown[]) => mockFuseTemplate(...args),
  recompileSchema: (...args: unknown[]) => mockRecompileSchema(...args),
}));

describe('templates API tenant contract', () => {
  const token = generateToken({ userId: 'user-a', username: 'alice' });
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({ id: 'user-a', username: 'alice', isDisabled: false, sessionVersion: 0 });
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'tmpl-new' });
    mockFuseTemplate.mockResolvedValue({});
    mockRecompileSchema.mockResolvedValue({ fields: [] });
    app = express();
    app.use(express.json());
    app.use('/api/templates', templateRoutes);
  });

  it.each(['/', '/tmpl-b', '/tmpl-b/download'])('returns 401 without a user token for %s', async (path) => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates${path}`);
      expect(response.status).toBe(401);
    });
  });

  it('scopes listing to the authenticated owner', async () => {
    mockFindMany.mockResolvedValue([]);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { ownerId: 'user-a' },
      }));
    });
  });

  it('selects safe rejection guidance for the owner-scoped template list', async () => {
    mockFindMany.mockResolvedValue([{
      id: 'tmpl-rejected',
      name: 'Arial template',
      docType: 'cong-van',
      status: 'REJECTED',
      analysisConfidence: 0,
      rejectionCode: 'FONT_RULE_VIOLATION',
      rejectionReason: 'document_number: yêu cầu Times New Roman; hiện tại Arial.',
      createdAt: new Date('2026-07-18T00:00:00Z'),
      fileSize: 1024,
    }]);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
    });

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: 'user-a' },
      select: expect.objectContaining({ rejectionReason: true }),
    }));
  });

  it('returns 404 for a foreign template detail', async () => {
    mockFindFirst.mockResolvedValue(null);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates/tmpl-b`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(404);
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { id: 'tmpl-b', ownerId: 'user-a' },
      });
    });
  });

  it('returns 404 for a foreign download', async () => {
    mockFindFirst.mockResolvedValue(null);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates/tmpl-b/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(404);
    });
  });

  it('returns 400 when uploading without a file', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(400);
    });
  });

  it('returns 400 when uploading without a name', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['fake-docx']), 'test.docx');

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      expect(response.status).toBe(400);
    });
  });

  it('uploads a template into the durable compilation queue', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'tmpl-new', ownerId: 'user-a', name: 'Test Template',
    });

    await withHttpServer(app, async (baseUrl) => {
      const formData = new FormData();
      formData.append('file', new Blob(['fake-docx-content']), 'test.docx');
      formData.append('name', 'Test Template');

      const response = await fetch(`${baseUrl}/api/templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      expect(response.status).toBe(201);
      expect(mockFuseTemplate).not.toHaveBeenCalled();
    });
  });

  it('rejects uploads when the per-user pending compilation cap is reached', async () => {
    mockCount.mockResolvedValueOnce(4).mockResolvedValueOnce(5);
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(429);
    });
  });

  it('submits a semantic map through the owner-scoped compiler', async () => {
    const semanticMap = {
      version: 1,
      documentFingerprint: 'fp-123',
      mappings: [{
        fieldName: 'document_number',
        locator: '/word/document.xml::body/p[1]',
        kind: 'BODY_PARAGRAPH',
        confidence: 0.95,
      }],
      ignoredLocators: [],
    };

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates/tmpl-own/mapping`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(semanticMap),
      });

      expect(response.status).toBe(200);
      expect(mockRecompileSchema).toHaveBeenCalledWith('tmpl-own', 'user-a', semanticMap);
    });
  });

  it('retries analysis only with the owned immutable original', async () => {
    mockFindFirst
      .mockResolvedValueOnce({
        id: 'tmpl-own', ownerId: 'user-a',
        originalPath: 'originals/user-a/tmpl-own.docx', originalSha256: 'a'.repeat(64),
      })
      .mockResolvedValueOnce({ id: 'tmpl-own', status: 'READY', analysisConfidence: 0.95, rejectionCode: null });
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates/tmpl-own/analyze`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      expect(mockFuseTemplate).toHaveBeenCalledWith('tmpl-own', 'user-a', {
        templateId: 'tmpl-own', relativePath: 'originals/user-a/tmpl-own.docx', sha256: 'a'.repeat(64),
      });
    });
  });

  it('owner-scopes preview metadata before serving a stored page', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'tmpl-own', previewMetadata: { labeledPages: ['previews/tmpl-own/labeled/page_0001.png'] },
    });
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates/tmpl-own/previews/1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/image\/png/);
    });
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tmpl-own', ownerId: 'user-a' },
    }));
  });

  it('returns 404 for a foreign patch', async () => {
    mockFindFirst.mockResolvedValue(null);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates/tmpl-b`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hacked' }),
      });

      expect(response.status).toBe(404);
    });
  });

  it('returns 404 for a foreign delete', async () => {
    mockFindFirst.mockResolvedValue(null);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates/tmpl-b`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(404);
    });
  });

  it('allows deleting an owned template', async () => {
    mockFindFirst.mockResolvedValue({ id: 'tmpl-own', ownerId: 'user-a' });
    mockDelete.mockResolvedValue({});

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates/tmpl-own`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(200);
    });
  });
});
