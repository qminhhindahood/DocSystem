import fs from 'fs';
import os from 'os';
import path from 'path';

const mockGet = jest.fn();
const mockQueryRaw = jest.fn();
const mockRedisConnected = jest.fn();

jest.mock('axios', () => ({ __esModule: true, default: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock('../utils/prisma', () => ({ prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) } }));
jest.mock('../utils/redis', () => ({
  redisClient: {
    isFallback: false,
    isConnected: (...args: unknown[]) => mockRedisConnected(...args),
  },
}));
jest.mock('../utils/cloud_run_auth', () => ({
  getCloudRunAuthorization: jest.fn().mockResolvedValue({
    'X-Serverless-Authorization': 'Bearer platform-token',
  }),
}));

import { buildModelsUrl, checkReadiness } from './readiness_service';

describe('readiness service', () => {
  const root = path.join(os.tmpdir(), `backend-readiness-${process.pid}`);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DEFAULT_LLM_BASE_URL = 'https://openrouter.ai/api/v1';
    delete process.env.DEFAULT_LLM_API_KEY;
    process.env.DOCLING_URL = 'http://docling:8001/';
    process.env.EMBEDDINGS_URL = 'http://embeddings:8002';
    process.env.DOCUMENT_RENDERER_URL = 'http://renderer:8080/';
    process.env.RENDERER_INTERNAL_TOKEN = 'renderer-token-at-least-32-characters';
    process.env.UPLOAD_DIR = path.join(root, 'uploads');
    process.env.TEMPLATE_STORAGE_DIR = path.join(root, 'templates');
    process.env.RAG_STATE_DIR = path.join(root, 'rag-state');
    mockGet.mockResolvedValue({ status: 200 });
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockRedisConnected.mockResolvedValue(true);
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it.each([
    ['http://llm:1234', 'http://llm:1234/v1/models'],
    ['https://provider.test/api/v1', 'https://provider.test/api/v1/models'],
    ['https://provider.test/v1/chat/completions', 'https://provider.test/v1/models'],
    ['https://provider.test/v1/models', 'https://provider.test/v1/models'],
  ])('normalizes model URL %s', (input, expected) => {
    expect(buildModelsUrl(input)).toBe(expected);
  });

  it('probes every required dependency and authenticates renderer readiness', async () => {
    process.env.DEFAULT_LLM_API_KEY = 'llm-key';
    const report = await checkReadiness({
      workerStates: () => ({ ingestion: 'running', templates: 'running' }),
    });
    expect(report.status).toBe('ok');
    expect(report.services).toEqual({
      database: 'healthy', redis: 'healthy', docling: 'healthy',
      embeddings: 'healthy', renderer: 'healthy', uploadStorage: 'healthy',
      templateStorage: 'healthy', ragStorage: 'healthy', workers: 'healthy', defaultLlm: 'healthy',
    });
    expect(mockGet).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models', expect.objectContaining({
      maxRedirects: 0,
      headers: { Authorization: 'Bearer llm-key' },
    }));
    expect(mockGet).toHaveBeenCalledWith('http://docling:8001/ready', expect.objectContaining({
      headers: { 'X-Serverless-Authorization': 'Bearer platform-token' },
    }));
    expect(mockGet).toHaveBeenCalledWith('http://embeddings:8002/ready', expect.objectContaining({
      headers: { 'X-Serverless-Authorization': 'Bearer platform-token' },
    }));
    expect(mockGet).toHaveBeenCalledWith('http://renderer:8080/ready', expect.objectContaining({
      headers: {
        'x-renderer-token': process.env.RENDERER_INTERNAL_TOKEN,
        'X-Serverless-Authorization': 'Bearer platform-token',
      },
    }));
  });

  it('returns promptly and degraded when probes hang or workers are stopped', async () => {
    mockQueryRaw.mockReturnValue(new Promise(() => undefined));
    const started = Date.now();
    const report = await checkReadiness({
      timeoutMs: 20,
      workerStates: () => ({ ingestion: 'stopped', templates: 'running' }),
    });
    expect(Date.now() - started).toBeLessThan(500);
    expect(report.status).toBe('degraded');
    expect(report.services.database).toBe('unhealthy');
    expect(report.services.workers).toBe('unhealthy');
  });

  it('does not require a global LLM when users provide their own configuration', async () => {
    delete process.env.DEFAULT_LLM_BASE_URL;
    delete process.env.DEFAULT_LLM_API_KEY;
    const report = await checkReadiness({
      workerStates: () => ({ ingestion: 'running', templates: 'running' }),
    });
    expect(report.status).toBe('ok');
    expect(report.services).not.toHaveProperty('defaultLlm');
  });
});
