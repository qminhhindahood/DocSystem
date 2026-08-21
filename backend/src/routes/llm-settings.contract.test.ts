import express from 'express';
import request from 'supertest';
import { generateToken } from '../middleware/user_auth';
import { prisma } from '../utils/prisma';
import llmSettingsRoutes from './llm-settings';
import { testLLMConnection } from '../services/llm_config_service';
import { decryptApiKey } from '../utils/encryption';

jest.mock('../utils/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    userLLMConfig: { findUnique: jest.fn(), upsert: jest.fn(), delete: jest.fn() },
  },
}));

jest.mock('../utils/encryption', () => ({
  encryptApiKey: jest.fn(() => ({
    encryptedApiKey: 'encrypted-new',
    apiKeyIv: 'iv-new',
    apiKeyAuthTag: 'tag-new',
  })),
  decryptApiKey: jest.fn(() => 'saved-secret'),
}));

jest.mock('../services/llm_config_service', () => {
  const actual = jest.requireActual('../services/llm_config_service');
  return {
    ...actual,
    testLLMConnection: jest.fn(async () => ({ ok: true, model: 'tested-model' })),
  };
});

jest.mock('../utils/urlGuard', () => ({
  parseAllowlist: jest.fn(() => []),
  validateProviderTarget: jest.fn(async () => ({
    addresses: [{ address: '1.2.3.4', family: 4 }],
  })),
}));

const findUnique = prisma.userLLMConfig.findUnique as jest.Mock;
const upsert = prisma.userLLMConfig.upsert as jest.Mock;
const deleteConfig = prisma.userLLMConfig.delete as jest.Mock;
const userFindUnique = prisma.user.findUnique as jest.Mock;
const testConnection = testLLMConnection as jest.Mock;
const decryptKey = decryptApiKey as jest.Mock;

describe('Gemini BYOK settings API contract', () => {
  let app: express.Express;
  let token: string;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/settings/llm', llmSettingsRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    userFindUnique.mockResolvedValue({
      id: 'u1', username: 'alice', isDisabled: false, sessionVersion: 0,
    });
    token = generateToken({ userId: 'u1', username: 'alice' });
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('rejects OpenRouter and does not expose its model catalog', async () => {
    findUnique.mockResolvedValue(null);
    const saveResponse = await request(app).post('/api/settings/llm/').set(auth()).send({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openrouter/free',
      apiKey: 'secret',
    });
    const catalogResponse = await request(app)
      .get('/api/settings/llm/openrouter/models')
      .set(auth());

    expect(saveResponse.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
    expect(catalogResponse.status).toBe(404);
  });

  it('returns a saved Gemini config without secret columns', async () => {
    findUnique.mockResolvedValue({
      id: 'cfg',
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.5-flash',
      encryptedApiKey: 'ciphertext',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app).get('/api/settings/llm/').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.config.provider).toBe('gemini');
    expect(response.body.config.hasApiKey).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(
      /ciphertext|encryptedApiKey|apiKeyIv|apiKeyAuthTag/,
    );
  });

  it('does not expose a legacy non-Gemini row', async () => {
    findUnique.mockResolvedValue({
      id: 'legacy',
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openrouter/free',
      encryptedApiKey: 'ciphertext',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app).get('/api/settings/llm/').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.config).toBeNull();
  });

  it('canonicalizes Gemini and encrypts a submitted key', async () => {
    findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue({
      id: 'cfg',
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.5-flash',
    });

    const response = await request(app).post('/api/settings/llm/').set(auth()).send({
      provider: 'gemini',
      baseUrl: 'https://attacker.example/v1',
      model: 'gemini-2.5-flash',
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
    expect(response.body.config.hasApiKey).toBe(true);
  });

  it('requires a key for a new Gemini configuration', async () => {
    findUnique.mockResolvedValue(null);
    const response = await request(app).post('/api/settings/llm/').set(auth()).send({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.5-flash',
      apiKey: '',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/API key/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('decrypts and reuses a saved Gemini key for a connection test', async () => {
    findUnique.mockResolvedValue({
      provider: 'gemini', encryptedApiKey: 'old', apiKeyIv: 'iv', apiKeyAuthTag: 'tag',
    });
    const response = await request(app).post('/api/settings/llm/test').set(auth()).send({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.5-flash',
      apiKey: '',
    });

    expect(response.status).toBe(200);
    expect(decryptKey).toHaveBeenCalledWith('old', 'iv', 'tag');
    expect(testConnection).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: 'saved-secret',
    }));
  });

  it('deletes the current user configuration idempotently', async () => {
    deleteConfig.mockResolvedValue({});
    const response = await request(app).delete('/api/settings/llm/').set(auth());
    expect(response.status).toBe(200);
    expect(deleteConfig).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });
});
