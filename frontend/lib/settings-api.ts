import type { LLMProvider } from '@/lib/llm-providers';

export interface LLMConfig {
  id: string;
  provider: LLMProvider;
  baseUrl: string;
  model: string;
  createdAt?: string;
  hasApiKey: boolean;
  updatedAt?: string;
}

export interface LLMConfigInput {
  provider: LLMConfig['provider'];
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  provider: string;
  contextLength: number | null;
  promptPricePerMillion: number | null;
  completionPricePerMillion: number | null;
  free: boolean;
  recommended: boolean;
}

export interface DocumentProfile {
  id: string;
  supervisingAgency: string | null;
  agencyName: string | null;
  agencyCode: string | null;
  agencyAddress: string | null;
  agencyEmail: string | null;
  agencyWebsite: string | null;
  agencyPhone: string | null;
  defaultPlace: string | null;
  defaultRecipients: string[];
  signatoryName: string | null;
  signatoryTitle: string | null;
  documentNumberPrefix: string | null;
  nextDocumentNumber: number;
}

export interface DocumentProfileInput {
  supervisingAgency?: string | null;
  agencyName?: string | null;
  agencyCode?: string | null;
  agencyAddress?: string | null;
  agencyEmail?: string | null;
  agencyWebsite?: string | null;
  agencyPhone?: string | null;
  defaultPlace?: string | null;
  defaultRecipients?: string[] | null;
  signatoryName?: string | null;
  signatoryTitle?: string | null;
  documentNumberPrefix?: string | null;
}

async function apiFetch<T>(url: string, options?: RequestInit, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { ...options, signal });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || `Request failed (${res.status})`, res.status);
  }
  return res.json();
}

export class AuthError extends Error {
  constructor() { super('Unauthorized'); this.name = 'AuthError'; }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ─── LLM Settings ──────────────────────────────────────────

export async function getLLMSettings(signal?: AbortSignal): Promise<{ success: boolean; config: LLMConfig | null }> {
  return apiFetch('/api/proxy/settings/llm', undefined, signal);
}

export async function saveLLMSettings(input: LLMConfigInput, signal?: AbortSignal): Promise<{ success: boolean; config: LLMConfig }> {
  return apiFetch('/api/proxy/settings/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, signal);
}

export async function testLLMSettings(input: LLMConfigInput, signal?: AbortSignal): Promise<{ success: boolean; model?: string; error?: string }> {
  return apiFetch('/api/proxy/settings/llm/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, signal);
}

export async function deleteLLMSettings(signal?: AbortSignal): Promise<{ success: boolean }> {
  return apiFetch('/api/proxy/settings/llm', {
    method: 'DELETE',
  }, signal);
}

export async function getOpenRouterModels(query = '', signal?: AbortSignal): Promise<{
  success: boolean;
  models: OpenRouterModel[];
  total: number;
}> {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  const suffix = params.size ? `?${params.toString()}` : '';
  return apiFetch(`/api/proxy/settings/llm/openrouter/models${suffix}`, undefined, signal);
}

// ─── Document Profile ──────────────────────────────────────

export async function getDocumentProfile(signal?: AbortSignal): Promise<{ success: boolean; profile: DocumentProfile | null }> {
  return apiFetch('/api/proxy/settings/document-profile', undefined, signal);
}

export async function saveDocumentProfile(input: DocumentProfileInput, signal?: AbortSignal): Promise<{ success: boolean; profile: DocumentProfile }> {
  return apiFetch('/api/proxy/settings/document-profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, signal);
}
