jest.mock('axios', () => {
  const post = jest.fn();
  class AxiosError extends Error {
    response?: { status?: number; data?: { error?: { message?: string } } };
    code?: string;
    constructor(message: string, code?: string, response?: any) {
      super(message);
      this.code = code;
      this.response = response;
    }
  }
  return { __esModule: true, default: { post }, AxiosError };
});

jest.mock('../utils/urlGuard', () => ({
  parseAllowlist: jest.fn(() => []),
  validateProviderTarget: jest.fn(async () => ({ addresses: [{ address: '1.2.3.4', family: 4 }] })),
}));

const mockFindUserConfig = jest.fn();
jest.mock('../utils/prisma', () => ({
  prisma: {
    userLLMConfig: {
      findUnique: (...args: unknown[]) => mockFindUserConfig(...args),
    },
  },
}));

import axios, { AxiosError } from 'axios';
import {
  buildChatCompletionsEndpoint,
  callLLM,
  canonicalizeProviderBaseUrl,
  getLLMConfig,
  providerHeaders,
  providerRequiresApiKey,
  resolveLLMConfig,
  testLLMConnection,
} from './llm_config_service';

const post = axios.post as jest.Mock;

describe('LLM provider URL helpers', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    mockFindUserConfig.mockReset();
  });

  test.each([
    ['openrouter root', 'openrouter', 'https://openrouter.ai', 'https://openrouter.ai/api/v1/chat/completions'],
    ['OpenRouter API base', 'openrouter', 'https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1/chat/completions'],
    ['OpenRouter full endpoint', 'openrouter', 'https://openrouter.ai/api/v1/chat/completions', 'https://openrouter.ai/api/v1/chat/completions'],
    ['Gemini API base', 'gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
    ['Gemini full endpoint', 'gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
    ['legacy provider root', 'custom', 'https://llm.example.test', 'https://llm.example.test/v1/chat/completions'],
    ['/v1 base', 'custom', 'https://llm.example.test/v1/', 'https://llm.example.test/v1/chat/completions'],
    ['full endpoint', 'custom', 'https://llm.example.test/v1/chat/completions/', 'https://llm.example.test/v1/chat/completions'],
  ])('%s builds exactly one chat path', (_name, provider, input, expected) => {
    expect(buildChatCompletionsEndpoint(input, provider as any)).toBe(expected);
  });

  it('canonicalizes cloud provider bases for new settings', () => {
    expect(canonicalizeProviderBaseUrl('openrouter', 'https://openrouter.ai/api/v1/chat/completions'))
      .toBe('https://openrouter.ai/api/v1');
    expect(canonicalizeProviderBaseUrl('openai', 'https://example.test')).toBe('https://api.openai.com/v1');
    expect(canonicalizeProviderBaseUrl('gemini' as any, 'https://attacker.example/v1'))
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(canonicalizeProviderBaseUrl('ollama', 'http://localhost:11434/')).toBe('http://localhost:11434');
  });

  it('requires keys for every cloud provider', () => {
    expect(providerRequiresApiKey('openai')).toBe(true);
    expect(providerRequiresApiKey('openrouter')).toBe(true);
    expect(providerRequiresApiKey('gemini' as any)).toBe(true);
    expect(providerRequiresApiKey('lmstudio')).toBe(false);
  });

  it('sends Gemini keys as bearer authentication without OpenRouter attribution', () => {
    expect(providerHeaders({
      provider: 'gemini' as any,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3.6-flash',
      apiKey: 'gemini-secret',
    })).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer gemini-secret',
    });
  });

  it('adds OpenRouter attribution without exposing it to other providers', () => {
    expect(providerHeaders({ provider: 'openrouter', baseUrl: '', model: 'm', apiKey: 'secret' }))
      .toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer secret', 'X-OpenRouter-Title': 'DocAI' });
    expect(providerHeaders({ provider: 'openai', baseUrl: '', model: 'm', apiKey: 'secret' }))
      .not.toHaveProperty('X-OpenRouter-Title');
  });

  it('resolves a saved keyless local provider without decrypting empty columns', () => {
    expect(resolveLLMConfig({
      id: 'cfg-local',
      userId: 'user-1',
      provider: 'lmstudio',
      baseUrl: 'http://localhost:1234',
      model: 'local-model',
      encryptedApiKey: '',
      apiKeyIv: '',
      apiKeyAuthTag: '',
    })).toEqual({
      provider: 'lmstudio',
      baseUrl: 'http://localhost:1234',
      model: 'local-model',
      apiKey: undefined,
    });
  });

  it('uses an optional provider-neutral system default only without user context', () => {
    process.env.DEFAULT_LLM_PROVIDER = 'openrouter';
    process.env.DEFAULT_LLM_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
    process.env.DEFAULT_LLM_MODEL = 'openrouter/free';
    process.env.DEFAULT_LLM_API_KEY = 'system-key';
    expect(resolveLLMConfig(null)).toEqual({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openrouter/free',
      apiKey: 'system-key',
    });
  });

  it('accepts a keyed Gemini maintenance default', () => {
    process.env.DEFAULT_LLM_PROVIDER = 'gemini';
    process.env.DEFAULT_LLM_BASE_URL = 'https://wrong.example';
    process.env.DEFAULT_LLM_MODEL = 'gemini-3.6-flash';
    process.env.DEFAULT_LLM_API_KEY = 'system-gemini-key';

    expect(resolveLLMConfig(null)).toEqual({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3.6-flash',
      apiKey: 'system-gemini-key',
    });
  });

  it('rejects maintenance calls when no system default is configured', () => {
    delete process.env.DEFAULT_LLM_PROVIDER;
    delete process.env.DEFAULT_LLM_BASE_URL;
    delete process.env.DEFAULT_LLM_MODEL;
    delete process.env.DEFAULT_LLM_API_KEY;
    expect(() => resolveLLMConfig(null)).toThrow(/No system LLM default/);
  });

  it('requires an authenticated user to save a provider instead of using a system fallback', async () => {
    process.env.DEFAULT_LLM_PROVIDER = 'openrouter';
    process.env.DEFAULT_LLM_BASE_URL = 'https://openrouter.ai/api/v1';
    process.env.DEFAULT_LLM_MODEL = 'openrouter/free';
    process.env.DEFAULT_LLM_API_KEY = 'system-key';
    mockFindUserConfig.mockResolvedValue(null);
    await expect(getLLMConfig('user-without-settings')).rejects.toThrow(/Configure OpenRouter/);
  });
});

describe('shared LLM request behavior', () => {
  beforeEach(() => post.mockReset());

  it('uses the shared endpoint and OpenRouter headers for normal requests', async () => {
    post.mockResolvedValue({ data: { choices: [{ message: { content: 'ok' } }] } });
    await callLLM({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4.1-mini', apiKey: 'key' }, [{ role: 'user', content: 'hi' }]);
    expect(post).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.any(Object),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer key', 'X-OpenRouter-Title': 'DocAI' }) }),
    );
  });

  it('pins provider DNS, disables redirects, and bypasses ambient proxies', async () => {
    post.mockResolvedValue({ data: { choices: [{ message: { content: 'ok' } }] } });
    await callLLM(
      { provider: 'custom', baseUrl: 'https://provider.test', model: 'm' },
      [{ role: 'user', content: 'hi' }],
    );
    const config = post.mock.calls[0][2];
    expect(config).toEqual(expect.objectContaining({ maxRedirects: 0, proxy: false, lookup: expect.any(Function) }));
    const callback = jest.fn();
    config.lookup('provider.test', { family: 4 }, callback);
    expect(callback).toHaveBeenCalledWith(null, '1.2.3.4', 4);
  });

  it('preserves actionable status and upstream messages', async () => {
    const error = new AxiosError('Request failed');
    (error as any).response = { status: 429, data: { error: { message: 'Rate limit exceeded' } } };
    post.mockRejectedValue(error);
    await expect(callLLM(
      { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'm', apiKey: 'key' },
      [{ role: 'user', content: 'hi' }],
    )).rejects.toThrow('429: Rate limit exceeded');
  });

  it('returns an actionable timeout from connection tests', async () => {
    post.mockRejectedValue(new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED'));
    await expect(testLLMConnection({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'm', apiKey: 'key' }))
      .resolves.toEqual({ ok: false, error: expect.stringMatching(/timed out/i) });
  });
});
