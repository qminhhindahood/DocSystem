/**
 * Vision provider config service (BYOK).
 *
 * The standalone conversion product supports one stored provider: Gemini.
 * Its decrypted key is attached only to the conversion job the user submits.
 *
 * All provider calls go through the backend; API keys never leave the server
 * except as a per-job attachment to the private conversion-service network.
 * The master stack's callLLM/streamLLM/callLLMVision/system-default logic was
 * deleted with the generation surface and stays deleted.
 */

import axios, { AxiosError } from 'axios';
import { decryptApiKey } from '../utils/encryption';
import { prisma } from '../utils/prisma';
import {
  CLOUD_PROVIDER_BASES,
  type LLMProvider,
} from '../constants/llm-providers';
import { validateProviderTarget, parseAllowlist } from '../utils/urlGuard';

export type { LLMProvider } from '../constants/llm-providers';
export { providerRequiresApiKey } from '../constants/llm-providers';

export interface LLMProviderConfig {
  provider: LLMProvider;
  baseUrl: string;
  model: string;
  apiKey?: string; // decrypted plaintext — never logged or returned to client
}

/** Vision attachment injected into a conversion job payload (gemini only). */
export interface VisionJobConfig {
  provider: 'gemini';
  model: string;
  apiKey: string;
}

export function canonicalizeProviderBaseUrl(provider: LLMProvider, baseUrl: string): string {
  return CLOUD_PROVIDER_BASES[provider] || baseUrl.trim().replace(/\/+$/, '');
}

export function buildChatCompletionsEndpoint(baseUrl: string, _provider: LLMProvider): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  return `${normalized}/chat/completions`;
}

export function providerHeaders(config: LLMProviderConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
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
 * Create a Node `lookup` callback that pins DNS to the pre-resolved addresses.
 * This prevents Axios from performing an independent DNS resolution.
 */
function pinnedLookup(addresses: ReadonlyArray<{ address: string; family: 4 | 6 }>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn: any = (host: any, opts: any, cb: (err: any, addr?: any, fam?: number) => void) => {
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
 * Validate connection to an LLM provider by sending a minimal test request.
 * Used by the settings dialog's "test" button for both stored providers.
 */
export async function testLLMConnection(config: LLMProviderConfig): Promise<{
  ok: boolean;
  model?: string;
  error?: string;
}> {
  try {
    const url = buildChatCompletionsEndpoint(config.baseUrl, config.provider);
    const allowlist = parseAllowlist(undefined);
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

/**
 * Resolve the caller's vision config for a conversion submission (BYOK).
 *
 * Returns the decrypted Gemini config when the user has one; returns null in
 * every other case — no row, a non-Gemini legacy row, or a stored key that
 * fails to decrypt. Null means "no usable vision
 * key", which the conversion service answers with its upfront 422 for
 * scanned uploads. Never throws into the submit path.
 */
export async function getVisionConfig(userId: string): Promise<VisionJobConfig | null> {
  let row: {
    provider: string;
    model: string;
    encryptedApiKey: string;
    apiKeyIv: string;
    apiKeyAuthTag: string;
  } | null;
  try {
    row = await prisma.userLLMConfig.findUnique({
      where: { userId },
      select: {
        provider: true,
        model: true,
        encryptedApiKey: true,
        apiKeyIv: true,
        apiKeyAuthTag: true,
      },
    });
  } catch (err) {
    console.error('[vision] Failed to fetch user LLM config:', err);
    return null;
  }

  if (!row || row.provider !== 'gemini' || !row.encryptedApiKey) return null;

  try {
    const apiKey = decryptApiKey(row.encryptedApiKey, row.apiKeyIv, row.apiKeyAuthTag);
    if (!apiKey) return null;
    return { provider: 'gemini', model: row.model, apiKey };
  } catch (err) {
    console.error('[vision] Failed to decrypt stored API key:', err);
    return null;
  }
}
