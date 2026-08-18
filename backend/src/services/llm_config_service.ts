/**
 * Universal LLM Client — routes calls to the user's configured provider.
 * All calls go through the backend; API keys never leave the server.
 *
 * Supported providers: openai, openrouter, gemini, lmstudio, ollama, custom.
 * All providers use OpenAI-compatible chat-completions endpoints.
 */

import axios, { AxiosError } from 'axios';
import { decryptApiKey } from '../utils/encryption';
import { prisma } from '../utils/prisma';
import {
  CLOUD_PROVIDER_BASES,
  LLM_PROVIDER_IDS,
  type LLMProvider,
  providerRequiresApiKey,
} from '../constants/llm-providers';

export type { LLMProvider } from '../constants/llm-providers';
export { providerRequiresApiKey } from '../constants/llm-providers';

export interface LLMProviderConfig {
  provider: LLMProvider;
  baseUrl: string;
  model: string;
  apiKey?: string; // decrypted plaintext — never logged or returned to client
}

export interface LLMConfigRecord {
  id: string;
  userId: string;
  provider: string;
  baseUrl: string;
  model: string;
  encryptedApiKey: string;
  apiKeyIv: string;
  apiKeyAuthTag: string;
}

export function canonicalizeProviderBaseUrl(provider: LLMProvider, baseUrl: string): string {
  return CLOUD_PROVIDER_BASES[provider] || baseUrl.trim().replace(/\/+$/, '');
}

export function buildChatCompletionsEndpoint(baseUrl: string, provider: LLMProvider): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  if (provider === 'gemini') return `${normalized}/chat/completions`;
  if (/\/(?:api\/)?v1$/i.test(normalized)) return `${normalized}/chat/completions`;
  const versionPath = provider === 'openrouter' ? 'api/v1' : 'v1';
  return `${normalized}/${versionPath}/chat/completions`;
}

export function providerHeaders(config: LLMProviderConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  if (config.provider === 'openrouter') headers['X-OpenRouter-Title'] = 'DocAI';
  return headers;
}

function formatLLMError(error: unknown, context = 'LLM'): string {
  if (error instanceof AxiosError) {
    if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message)) {
      return `${context} request timed out. Check the provider and try again.`;
    }
    const status = error.response?.status;
    const upstream = error.response?.data?.error?.message;
    return `${context} error${status ? ` ${status}` : ''}: ${upstream || error.message}`;
  }
  return error instanceof Error ? error.message : `Unknown ${context.toLowerCase()} error`;
}

/**
 * Resolve a user's stored LLM config. Calls without a user ID are reserved for
 * maintenance scripts and use the optional provider-neutral system default.
 */
export async function getLLMConfig(userId?: string): Promise<LLMProviderConfig> {
  if (userId) {
    let userConfig: LLMConfigRecord | null;
    try {
      userConfig = await prisma.userLLMConfig.findUnique({
        where: { userId },
        select: {
          id: true,
          userId: true,
          provider: true,
          baseUrl: true,
          model: true,
          encryptedApiKey: true,
          apiKeyIv: true,
          apiKeyAuthTag: true,
        },
      });
    } catch (err) {
      console.error('[LLM] Failed to fetch user LLM config:', err);
      throw new Error('User LLM configuration is temporarily unavailable');
    }

    if (!userConfig) {
      throw new Error('LLM configuration required. Configure OpenRouter or another provider in Settings.');
    }

    const config = resolveLLMConfig(userConfig);
    // Re-validate stored provider URL before use.
    const { validateProviderTarget, parseAllowlist } = require('../utils/urlGuard');
    const allowlist = parseAllowlist(process.env.LOCAL_LLM_HOST_ALLOWLIST);
    await validateProviderTarget(config.baseUrl, config.provider, allowlist).catch((err: Error) => {
      console.error(`[LLM] Stored provider URL rejected: ${err.message}`);
      throw new Error('Stored LLM provider URL is no longer valid');
    });
    return config;
  }
  return resolveLLMConfig(null);
}

/**
 * Resolve the effective LLM config for a user:
 * 1. User's personal config (from DB)
 * 2. Optional provider-neutral default for maintenance scripts without a user
 */
export function resolveLLMConfig(
  userConfig: LLMConfigRecord | null,
): LLMProviderConfig {
  if (!userConfig) {
    const provider = process.env.DEFAULT_LLM_PROVIDER?.trim() as LLMProvider | undefined;
    const baseUrl = process.env.DEFAULT_LLM_BASE_URL?.trim();
    const model = process.env.DEFAULT_LLM_MODEL?.trim();
    const apiKey = process.env.DEFAULT_LLM_API_KEY?.trim();
    const supported: readonly LLMProvider[] = LLM_PROVIDER_IDS;

    if (!provider || !supported.includes(provider) || !baseUrl || !model) {
      throw new Error('No system LLM default is configured; provide a user ID or set DEFAULT_LLM_PROVIDER, DEFAULT_LLM_BASE_URL, and DEFAULT_LLM_MODEL');
    }
    if (providerRequiresApiKey(provider) && !apiKey) {
      throw new Error(`DEFAULT_LLM_API_KEY is required for the ${provider} system default`);
    }
    return {
      provider,
      baseUrl: canonicalizeProviderBaseUrl(provider, baseUrl),
      model,
      apiKey: apiKey || undefined,
    };
  }

  try {
    const apiKey = userConfig.encryptedApiKey
      ? decryptApiKey(
        userConfig.encryptedApiKey,
        userConfig.apiKeyIv,
        userConfig.apiKeyAuthTag,
      )
      : '';

    return {
      provider: userConfig.provider as LLMProvider,
      baseUrl: userConfig.baseUrl.replace(/\/$/, ''),
      model: userConfig.model,
      apiKey: apiKey || undefined,
    };
  } catch (err) {
    console.error('[LLM] Failed to decrypt API key:', err);
    throw new Error('User LLM configuration is invalid');
  }
}

/**
 * Create a Node `lookup` callback that pins DNS to the pre-resolved addresses.
 * This prevents Axios from performing an independent DNS resolution.
 */
function pinnedLookup(addresses: ReadonlyArray<{ address: string; family: 4 | 6 }>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn: any = (host: string, opts: any, cb: (err: any, addr?: any, fam?: number) => void) => {
    const family = typeof opts === 'number' ? opts : opts?.family;
    const eligible = family === 4 || family === 6
      ? addresses.filter(address => address.family === family)
      : [...addresses];
    if (!eligible.length) {
      const error = Object.assign(new Error(`No pinned address for requested family ${family}`), {
        code: 'ENOTFOUND',
      });
      return cb(error);
    }
    if (opts?.all) return cb(null, eligible as any);
    return cb(null, eligible[0].address, eligible[0].family);
  };
  return fn;
}

/**
 * Call LLM chat completions (non-streaming)
 */
export async function callLLM(
  config: LLMProviderConfig,
  messages: Array<{ role: string; content: string }>,
  options: {
    temperature?: number;
    max_tokens?: number;
    response_format?: any;
    seed?: number;
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  const url = buildChatCompletionsEndpoint(config.baseUrl, config.provider);
  const { validateProviderTarget, parseAllowlist } = require('../utils/urlGuard');
  const allowlist = parseAllowlist(process.env.LOCAL_LLM_HOST_ALLOWLIST);
  const target = await validateProviderTarget(config.baseUrl, config.provider, allowlist);

  const headers = providerHeaders(config);

  const body = {
    model: config.model,
    messages,
    temperature: options.temperature ?? 0.1,
    max_tokens: options.max_tokens ?? 4000,
    response_format: options.response_format,
    seed: options.seed,
    stream: false,
  };

  try {
    const response = await axios.post(url, body, {
      headers, timeout: 120_000, maxRedirects: 0,
      proxy: false,
      signal: options.signal,
      lookup: pinnedLookup(target.addresses),
    });
    const data = response.data;

    if (!data.choices?.[0]?.message?.content) {
      throw new Error('Invalid LLM response: missing choices[0].message.content');
  }
    return data.choices[0].message.content;
  } catch (err) {
    throw new Error(formatLLMError(err));
  }
}

/** OpenAI-compatible multimodal call used only for private template mapping. */
export async function callLLMVision(
  config: LLMProviderConfig,
  request: {
    prompt: string;
    imageDataUrls: string[];
    responseSchema: Record<string, unknown>;
  },
  signal?: AbortSignal,
): Promise<string> {
  const url = buildChatCompletionsEndpoint(config.baseUrl, config.provider);
  const { validateProviderTarget, parseAllowlist } = require('../utils/urlGuard');
  const allowlist = parseAllowlist(process.env.LOCAL_LLM_HOST_ALLOWLIST);
  const target = await validateProviderTarget(config.baseUrl, config.provider, allowlist);
  const headers = providerHeaders(config);
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: request.prompt }];
  for (const imageUrl of request.imageDataUrls.slice(0, 6)) {
    content.push({ type: 'image_url', image_url: { url: imageUrl, detail: 'high' } });
  }
  try {
    const response = await axios.post(url, {
      model: config.model,
      messages: [{ role: 'user', content }],
      temperature: 0,
      max_tokens: 4000,
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'template_semantic_map', strict: true, schema: request.responseSchema },
      },
    }, {
      headers, timeout: 180_000, maxRedirects: 0, proxy: false, signal,
      lookup: pinnedLookup(target.addresses),
    });
    const output = response.data?.choices?.[0]?.message?.content;
    if (typeof output !== 'string' || !output.trim()) throw new Error('Vision model returned no structured content');
    return output;
  } catch (error) {
    throw new Error(formatLLMError(error, 'Vision model'));
  }
}

/**
 * Call LLM with streaming (returns async generator of text chunks)
 */
export async function* streamLLM(
  config: LLMProviderConfig,
  messages: Array<{ role: string; content: string }>,
  options: {
    temperature?: number;
    max_tokens?: number;
    signal?: AbortSignal;
  } = {},
): AsyncGenerator<string> {
  const url = buildChatCompletionsEndpoint(config.baseUrl, config.provider);
  const { validateProviderTarget, parseAllowlist } = require('../utils/urlGuard');
  const allowlist = parseAllowlist(process.env.LOCAL_LLM_HOST_ALLOWLIST);
  const target = await validateProviderTarget(config.baseUrl, config.provider, allowlist);

  const headers = providerHeaders(config);

  const body = {
    model: config.model,
    messages,
    stream: true,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.max_tokens ?? 4096,
  };

  let response;
  try {
    response = await axios.post(url, body, {
      headers,
      responseType: 'stream',
      timeout: 900_000,
      maxRedirects: 0,
      proxy: false,
      signal: options.signal,
      lookup: pinnedLookup(target.addresses),
    });
  } catch (error) {
    throw new Error(formatLLMError(error));
  }

  yield* parseSSEStream(response.data);
}

/**
 * Parse SSE stream from axios response
 */
async function* parseSSEStream(stream: any): AsyncGenerator<string> {
  let buffer = '';
  for await (const chunk of stream) {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        // skip malformed SSE
      }
    }
  }
}

/**
 * Validate connection to an LLM provider by sending a minimal test request
 */
export async function testLLMConnection(config: LLMProviderConfig): Promise<{
  ok: boolean;
  model?: string;
  error?: string;
}> {
  try {
    const url = buildChatCompletionsEndpoint(config.baseUrl, config.provider);
    const { validateProviderTarget, parseAllowlist } = require('../utils/urlGuard');
    const allowlist = parseAllowlist(process.env.LOCAL_LLM_HOST_ALLOWLIST);
    const target = await validateProviderTarget(config.baseUrl, config.provider, allowlist);
    const headers = providerHeaders(config);

    const response = await axios.post(
      url,
      {
        model: config.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      },
      { headers, timeout: 30_000, maxRedirects: 0, proxy: false, lookup: pinnedLookup(target.addresses) },
    );

    return {
      ok: true,
      model: response.data.model || config.model,
    };
  } catch (err) {
    return { ok: false, error: formatLLMError(err) };
  }
}
