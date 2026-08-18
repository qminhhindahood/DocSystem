import express from 'express';
import jwt from 'jsonwebtoken';
import workflowRoutes from './workflow';
import { callLLM } from '../services/llm_config_service';
import { commandParser, formatter, planner, researcher, writer } from '../services/orchestrator';
import { prisma } from '../utils/prisma';
import { generateToken } from '../middleware/user_auth';
import { withHttpServer } from '../test/http';

const mockGenerateTemplateDocument = jest.fn();

jest.mock('../utils/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
  },
}));

jest.mock('../services/orchestrator', () => ({
  commandParser: {
    parse: jest.fn().mockResolvedValue({ intent: 'create', entities: {}, rawPrompt: '' }),
  },
  planner: {
    createOutline: jest.fn(async function* createOutline() {
      yield { stage: 'planning', outline: 'outline' };
    }),
  },
  researcher: {
    research: jest.fn(async function* research() {
      yield { stage: 'researching', results: [{ results: [] }] };
    }),
  },
  writer: {
    write: jest.fn().mockResolvedValue('document'),
    streamWrite: jest.fn(async function* streamWrite() {
      yield 'document';
    }),
  },
  formatter: {
    format: jest.fn().mockResolvedValue(Buffer.from('docx')),
  },
}));

jest.mock('../services/template_generation_service', () => ({
  generateTemplateDocument: (...args: unknown[]) => mockGenerateTemplateDocument(...args),
}));

jest.mock('../services/llm_config_service', () => ({
  getLLMConfig: jest.fn().mockResolvedValue({
    provider: 'lmstudio',
    baseUrl: 'http://localhost:1234',
    model: 'test-model',
  }),
  callLLM: jest.fn(),
}));

describe('workflow API contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u1',
      username: 'alice',
      isDisabled: false,
      sessionVersion: 0,
    });
    mockGenerateTemplateDocument.mockResolvedValue({
      documentId: 'd1', storageKey: 'generated/u1/d1.docx',
      outputSha256: 'a'.repeat(64), content: '{}',
      fidelityReport: {
        passed: false, violations: [], repairs: [], pageCount: 1,
        validationStatus: 'warnings',
        warnings: [{ code: 'FONT_SUBSTITUTED', severity: 'warning', message: 'Font substituted' }],
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts frontend documentType and passes it through as docType', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/workflow', workflowRoutes);
    const token = generateToken({ userId: 'u1', username: 'alice' });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/workflow/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prompt: 'Draft an official letter',
          documentType: 'cong-van',
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        success: true,
        outline: 'outline',
        document: 'document',
      });
      expect(planner.createOutline).toHaveBeenCalledWith('Draft an official letter', 'cong-van', 'u1', expect.objectContaining({ entities: expect.any(Object) }), expect.any(AbortSignal));
      expect(researcher.research).toHaveBeenCalledWith(
        'outline', 'cong-van', 'u1', { kind: 'user', userId: 'u1' },
      );
      expect(writer.write).toHaveBeenCalledWith(
        'outline',
        [{ results: [] }],
        'Draft an official letter',
        'cong-van',
        'u1',
        expect.objectContaining({ entities: expect.any(Object) }),
        expect.any(AbortSignal),
      );
    });
  });

  it.each([
    ['GET', '/types'],
    ['GET', '/template/cong-van'],
    ['GET', '/fields/cong-van'],
    ['POST', '/extract-fields'],
    ['POST', '/validate'],
    ['POST', '/generate'],
    ['POST', '/stream'],
    ['POST', '/structured-output'],
    ['POST', '/parse'],
    ['POST', '/format'],
  ])('returns 401 without a user token for %s %s', async (method, route) => {
    const app = express();
    app.use(express.json());
    app.use('/api/workflow', workflowRoutes);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/workflow${route}`, {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'POST' ? JSON.stringify({}) : undefined,
      });

      expect(response.status).toBe(401);
    });
  });

  it('rejects a supplied role-bearing token before workflow logic', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/workflow', workflowRoutes);
    const token = jwt.sign(
      { userId: 'u1', username: 'alice', role: 'admin' },
      process.env.JWT_SECRET!,
      { issuer: 'ai-document-system', audience: 'ai-document-api' },
    );

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/workflow/parse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt: 'Draft an official letter' }),
      });

      expect(response.status).toBe(401);
      expect(commandParser.parse).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['disabled account', { id: 'u1', username: 'alice', isDisabled: true }],
    ['deleted account', null],
  ])('rejects a supplied token for a %s before workflow logic', async (_accountState, account) => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(account);
    const app = express();
    app.use(express.json());
    app.use('/api/workflow', workflowRoutes);
    const token = generateToken({ userId: 'u1', username: 'alice' });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/workflow/parse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt: 'Draft an official letter' }),
      });

      expect(response.status).toBe(401);
      expect(commandParser.parse).not.toHaveBeenCalled();
    });
  });

  it.each(['/generate', '/stream'])(
    'accepts a valid revalidated user on %s with a role-free access scope',
    async (route) => {
      const app = express();
      app.use(express.json());
      app.use('/api/workflow', workflowRoutes);
      const token = generateToken({ userId: 'u1', username: 'alice' });

      await withHttpServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/workflow${route}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ prompt: 'Draft an official letter', docType: 'cong-van' }),
        });

        expect(response.status).toBe(200);
        await response.text();
        expect(researcher.research).toHaveBeenCalledWith(
          'outline',
          'cong-van',
          'u1',
          { kind: 'user', userId: 'u1' },
        );
      });
    },
  );

  it.each([
    '/extract-fields',
    '/generate',
    '/stream',
    '/structured-output',
    '/parse',
    '/format',
  ])('rejects an invalid token on %s before body validation', async (route) => {
    const app = express();
    app.use(express.json());
    app.use('/api/workflow', workflowRoutes);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/workflow${route}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid-token',
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(401);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(commandParser.parse).not.toHaveBeenCalled();
      expect(planner.createOutline).not.toHaveBeenCalled();
    });
  });

  it('routes template streaming through persisted owner-scoped generation', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/workflow', workflowRoutes);
    const token = generateToken({ userId: 'u1', username: 'alice' });
    const templateId = '11111111-1111-4111-8111-111111111111';

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/workflow/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt: 'Draft', templateId, referenceDocumentIds: ['r1'] }),
      });
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('"documentId":"d1"');
      expect(body).toContain('"fidelity":{"validationStatus":"warnings"');
      expect(body).toContain('"code":"FONT_SUBSTITUTED"');
      expect(mockGenerateTemplateDocument).toHaveBeenCalledWith(expect.objectContaining({
        ownerId: 'u1', templateId, prompt: 'Draft', referenceDocumentIds: ['r1'],
        signal: expect.any(AbortSignal),
      }));
      expect(commandParser.parse).not.toHaveBeenCalled();
    });
  });

  it('does not log raw private LLM output when field extraction JSON is invalid', async () => {
    const privateOutput = 'PRIVATE-DOCUMENT-CONTENT-not-json';
    (callLLM as jest.Mock).mockResolvedValueOnce(privateOutput);
    const app = express();
    app.use(express.json());
    app.use('/api/workflow', workflowRoutes);
    const token = generateToken({ userId: 'u1', username: 'alice' });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(baseUrl + '/api/workflow/extract-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ prompt: 'Private request', docType: 'cong-van' }),
      });
      expect(response.status).toBe(200);
    });

    const logged = (console.warn as jest.Mock).mock.calls.flat().join(' ');
    expect(logged).not.toContain(privateOutput);
  });

  it('passes the format title through the formatter options contract', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/workflow', workflowRoutes);
    const token = generateToken({ userId: 'u1', username: 'alice' });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(baseUrl + '/api/workflow/format', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ content: 'body', docType: 'cong-van', title: 'Tiêu đề' }),
      });
      expect(response.status).toBe(200);
    });

    expect(formatter.format).toHaveBeenCalledWith('body', 'cong-van', { title: 'Tiêu đề' });
  });
});
