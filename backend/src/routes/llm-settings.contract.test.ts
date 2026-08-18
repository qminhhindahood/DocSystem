import express from 'express';
import request from 'supertest';
import { generateToken } from '../middleware/user_auth';
import { prisma } from '../utils/prisma';
import llmSettingsRoutes from './llm-settings';
import { testLLMConnection } from '../services/llm_config_service';
import { decryptApiKey } from '../utils/encryption';
import { listOpenRouterModels } from '../services/openrouter_models';

jest.mock('../utils/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    userLLMConfig: { findUnique: jest.fn(), upsert: jest.fn(), delete: jest.fn() },
  },
}));

jest.mock('../utils/encryption', () => ({
  encryptApiKey: jest.fn(() => ({ encryptedApiKey: 'encrypted-new', apiKeyIv: 'iv-new', apiKeyAuthTag: 'tag-new' })),
  decryptApiKey: jest.fn(() => 'saved-secret'),
}));

jest.mock('../services/llm_config_service', () => {
  const actual = jest.requireActual('../services/llm_config_service');
  return { ...actual, testLLMConnection: jest.fn(async () => ({ ok: true, model: 'tested-model' })) };
});

jest.mock('../utils/urlGuard', () => ({
  parseAllowlist: jest.fn(() => []),
  validateProviderTarget: jest.fn(async () => ({ addresses: [{ address: '1.2.3.4', family: 4 }] })),
}));

jest.mock('../services/openrouter_models', () => ({
  listOpenRouterModels: jest.fn(),
}));

const findUnique = prisma.userLLMConfig.findUnique as jest.Mock;
const upsert = prisma.userLLMConfig.upsert as jest.Mock;
const userFindUnique = prisma.user.findUnique as jest.Mock;
const testConnection = testLLMConnection as jest.Mock;
const decryptKey = decryptApiKey as jest.Mock;
const listModels = listOpenRouterModels as jest.Mock;

describe('LLM settings API contract', () => {
  let app: express.Express;
  let token: string;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/settings/llm', llmSettingsRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    userFindUnique.mockResolvedValue({ id: 'u1', username: 'alice', isDisabled: false, sessionVersion: 0 });
    token = generateToken({ userId: 'u1', username: 'alice' });
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('returns hasApiKey without returning any secret columns', async () => {
    findUnique.mockResolvedValue({
      id: 'cfg', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'm',
      encryptedApiKey: 'ciphertext', createdAt: new Date(), updatedAt: new Date(),
    });
    const response = await request(app).get('/api/settings/llm/').set(auth());
    expect(response.status).toBe(200);
    expect(response.body.config.hasApiKey).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(/ciphertext|encryptedApiKey|apiKeyIv|apiKeyAuthTag/);
  });

  it('returns the authenticated OpenRouter model catalog', async () => {
    listModels.mockResolvedValue({
      models: [{ id: 'openrouter/free', free: true, recommended: true }],
      total: 1,
    });

    const response = await request(app)
      .get('/api/settings/llm/openrouter/models?q=free')
      .set(auth());

    expect(response.status).toBe(200);
    expect(listModels).toHaveBeenCalledWith('free');
    expect(response.body).toEqual({
      success: true,
      models: [{ id: 'openrouter/free', free: true, recommended: true }],
      total: 1,
    });
  });

  it('protects the model catalog and validates query length', async () => {
    const unauthenticated = await request(app).get('/api/settings/llm/openrouter/models');
    expect(unauthenticated.status).toBe(401);

    const invalidQuery = await request(app)
      .get(`/api/settings/llm/openrouter/models?q=${'x'.repeat(121)}`)
      .set(auth());
    expect(invalidQuery.status).toBe(400);
    expect(listModels).not.toHaveBeenCalled();
  });

  it('returns a controlled catalog failure', async () => {
    listModels.mockRejectedValue(new Error('upstream detail'));
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await request(app)
      .get('/api/settings/llm/openrouter/models')
      .set(auth());

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'Unable to load OpenRouter models' });
    expect(errorLog).toHaveBeenCalledWith('Get OpenRouter models error:', 'upstream detail');
    errorLog.mockRestore();
  });

  it('canonicalizes OpenRouter before validation and storage', async () => {
    findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue({ id: 'cfg', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'm' });
    const response = await request(app).post('/api/settings/llm/').set(auth()).send({
      provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1/chat/completions', model: 'm', apiKey: 'new-key',
    });
    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ baseUrl: 'https://openrouter.ai/api/v1' }),
      update: expect.objectContaining({ baseUrl: 'https://openrouter.ai/api/v1' }),
    }));
    expect(response.body.config.hasApiKey).toBe(true);
  });

  it('requires a key for a new OpenRouter configuration', async () => {
    findUnique.mockResolvedValue(null);
    const response = await request(app).post('/api/settings/llm/').set(auth()).send({
      provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'm', apiKey: '',
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/API key/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not reuse a key when switching providers', async () => {
    findUnique.mockResolvedValue({
      provider: 'openai', encryptedApiKey: 'old', apiKeyIv: 'iv', apiKeyAuthTag: 'tag',
    });
    const response = await request(app).post('/api/settings/llm/').set(auth()).send({
      provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'm', apiKey: '',
    });
    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('decrypts and reuses the saved key only when testing the unchanged provider', async () => {
    findUnique.mockResolvedValue({
      provider: 'openrouter', encryptedApiKey: 'old', apiKeyIv: 'iv', apiKeyAuthTag: 'tag',
    });
    const response = await request(app).post('/api/settings/llm/test').set(auth()).send({
      provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'm', apiKey: '',
    });
    expect(response.status).toBe(200);
    expect(decryptKey).toHaveBeenCalledWith('old', 'iv', 'tag');
    expect(testConnection).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'saved-secret',
    }));
  });

  it('requires a fresh key when testing after switching to a cloud provider', async () => {
    findUnique.mockResolvedValue({
      provider: 'openai', encryptedApiKey: 'old', apiKeyIv: 'iv', apiKeyAuthTag: 'tag',
    });
    const response = await request(app).post('/api/settings/llm/test').set(auth()).send({
      provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'm', apiKey: '',
    });
    expect(response.status).toBe(400);
    expect(testConnection).not.toHaveBeenCalled();
  });

  it('accepts Gemini, canonicalizes its URL, and encrypts its submitted key', async () => {
    findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue({
      id: 'cfg',
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3.6-flash',
    });

    const response = await request(app).post('/api/settings/llm/').set(auth()).send({
      provider: 'gemini',
      baseUrl: 'https://attacker.example/v1',
      model: 'gemini-3.6-flash',
      apiKey: 'new-gemini-key',
    });

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        provider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        encryptedApiKey: 'encrypted-new',
      }),
    }));
  });

  it('requires a new key when switching to Gemini', async () => {
    findUnique.mockResolvedValue({
      provider: 'openai', encryptedApiKey: 'old', apiKeyIv: 'iv', apiKeyAuthTag: 'tag',
    });

    const response = await request(app).post('/api/settings/llm/test').set(auth()).send({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3.6-flash',
      apiKey: '',
    });

    expect(response.status).toBe(400);
    expect(testConnection).not.toHaveBeenCalled();
  });

  it('reuses a saved Gemini key only for Gemini', async () => {
    findUnique.mockResolvedValue({
      provider: 'gemini', encryptedApiKey: 'old', apiKeyIv: 'iv', apiKeyAuthTag: 'tag',
    });

    const response = await request(app).post('/api/settings/llm/test').set(auth()).send({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3.6-flash',
      apiKey: '',
    });

    expect(response.status).toBe(200);
    expect(testConnection).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: 'saved-secret',
    }));
  });
});
