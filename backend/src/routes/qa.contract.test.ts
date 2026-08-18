import express from 'express';
import { generateToken } from '../middleware/user_auth';
import { withHttpServer } from '../test/http';
import { prisma } from '../utils/prisma';
import { ragService } from '../services/rag_service';
import { hasSufficientEvidence } from '../services/self_correct';
import { streamLLM } from '../services/llm_config_service';


jest.mock('../utils/prisma', () => ({
  prisma: { user: { findUnique: jest.fn() } },
}));

jest.mock('../services/rag_service', () => ({
  ragService: { search: jest.fn().mockResolvedValue([]) },
}));

jest.mock('../services/self_correct', () => ({
  ENABLE_SELF_CORRECT: jest.fn().mockReturnValue(false),
  hasSufficientEvidence: jest.fn().mockResolvedValue(false),
  shouldRegenerate: jest.fn().mockResolvedValue(false),
  retrieveWithQuality: jest.fn(async (query: string, search: (query: string) => Promise<unknown>) => search(query)),
}));

jest.mock('../services/llm_config_service', () => ({
  getLLMConfig: jest.fn(),
  streamLLM: jest.fn(),
}));

const qaRoutes = require('./qa').default;

describe('QA API tenant contract', () => {
  const token = generateToken({ userId: 'user-a', username: 'alice' });
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'user-a', username: 'alice', isDisabled: false, sessionVersion: 0,
    });
    (ragService.search as jest.Mock).mockResolvedValue([]);
    app = express();
    app.use(express.json());
    app.use('/api/qa', qaRoutes);
  });

  it('returns 401 without a user token before question validation', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/qa/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(401);
      expect(ragService.search).not.toHaveBeenCalled();
    });
  });

  it('returns 400 for an empty authenticated question', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/qa/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question: '' }),
      });
      expect(response.status).toBe(400);
    });
  });

  it('passes the authenticated owner scope into QA retrieval', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/qa/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question: 'Điều 1 quy định gì?', topK: 4 }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      await response.text();
      expect(ragService.search).toHaveBeenCalledWith(
        'Điều 1 quy định gì?', 16, undefined, { kind: 'user', userId: 'user-a' },
      );
    });
  });

  it('keeps the raw question exclusively in the user-role message', async () => {
    const question = 'UNIQUE_USER_QUESTION_9d31';
    (hasSufficientEvidence as jest.Mock).mockResolvedValueOnce(true);
    (ragService.search as jest.Mock).mockResolvedValueOnce([{
      id: 'chunk-1',
      documentId: 'doc-1',
      content: 'Trusted evidence text',
      similarity: 0.9,
      level: 1,
      docTitle: 'Reference',
    }]);
    (streamLLM as jest.Mock).mockImplementation(async function* () {
      yield 'Grounded answer';
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/qa/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question }),
      });

      expect(response.status).toBe(200);
      await response.text();
      const messages = (streamLLM as jest.Mock).mock.calls[0][1];
      expect(messages.find((message: { role: string }) => message.role === 'system').content)
        .not.toContain(question);
      expect(messages.find((message: { role: string }) => message.role === 'user')).toEqual({
        role: 'user',
        content: question,
      });
    });
  });
});
