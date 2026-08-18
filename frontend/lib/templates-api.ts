export type TemplateStatus = 'UPLOADED' | 'ANALYZING' | 'NEEDS_REVIEW' | 'READY' | 'REJECTED' | 'FAILED';

export interface TemplateSummary {
  id: string;
  name: string;
  docType: string | null;
  status: TemplateStatus;
  analysisConfidence: number | null;
  rejectionCode: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  fileSize: number | null;
}

export interface TemplateDetail extends TemplateSummary {
  header: string;
  signatureBlock: string;
  description: string | null;
  isActive: boolean;
  compatibilityReport: { passed: boolean; compatibleTypes: string[] } | null;
  semanticMap: Record<string, unknown> | null;
  generationSchema: Record<string, unknown> | null;
  previewMetadata: {
    documentFingerprint?: string;
    candidates?: StructuralCandidate[];
    compatibility?: string[];
    baselinePages?: string[];
    labeledPages?: string[];
  } | null;
}

export interface TemplateInput {
  name: string;
  docType?: string;
}

export interface StructuralCandidate {
  locator: string;
  kind: string;
  fingerprint: Record<string, unknown> | null;
  textSnippet: string;
}

export class AuthError extends Error {
  constructor() { super('Unauthorized'); this.name = 'AuthError'; }
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
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

export async function getTemplates(signal?: AbortSignal): Promise<{ success: boolean; templates: TemplateSummary[] }> {
  return apiFetch('/api/proxy/templates', undefined, signal);
}

export function getTemplateRefetchInterval(
  data?: { templates: TemplateSummary[] },
): 2000 | false {
  return data?.templates.some(template =>
    template.status === 'UPLOADED' || template.status === 'ANALYZING')
    ? 2000
    : false;
}

export async function getTemplate(id: string, signal?: AbortSignal): Promise<{ success: boolean; template: TemplateDetail }> {
  return apiFetch(`/api/proxy/templates/${id}`, undefined, signal);
}

export async function uploadTemplate(file: File, name: string, docType?: string, signal?: AbortSignal): Promise<{ success: boolean; template: TemplateSummary }> {
  const body = new FormData();
  body.append('file', file);
  body.append('name', name);
  if (docType) body.append('docType', docType);
  return apiFetch('/api/proxy/templates', { method: 'POST', body }, signal);
}

export async function updateTemplate(id: string, input: Partial<TemplateInput & { header: string; signatureBlock: string; description: string; isActive: boolean }>, signal?: AbortSignal): Promise<{ success: boolean; template: TemplateDetail }> {
  return apiFetch(`/api/proxy/templates/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, signal);
}

export interface SemanticMapInput {
  version: 1;
  documentFingerprint: string;
  mappings: Array<{
    fieldName: string;
    locator: string | null;
    kind: string;
    confidence: number;
  }>;
  ignoredLocators: string[];
}

export async function reviewTemplateMapping(
  id: string,
  semanticMap: SemanticMapInput,
  signal?: AbortSignal,
): Promise<{ success: boolean; template: Pick<TemplateDetail, 'id' | 'status' | 'analysisConfidence' | 'rejectionCode'>; generationSchema: Record<string, unknown> }> {
  return apiFetch(`/api/proxy/templates/${id}/mapping`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(semanticMap),
  }, signal);
}

export async function analyzeTemplate(id: string, signal?: AbortSignal): Promise<{ success: boolean; template: Pick<TemplateDetail, 'id' | 'status' | 'analysisConfidence' | 'rejectionCode'> }> {
  return apiFetch(`/api/proxy/templates/${id}/analyze`, { method: 'POST' }, signal);
}

export function getTemplatePreviewUrl(id: string, page: number, variant: 'labeled' | 'baseline' = 'labeled'): string {
  return `/api/proxy/templates/${encodeURIComponent(id)}/previews/${page}?variant=${variant}`;
}

export async function deleteTemplate(id: string, signal?: AbortSignal): Promise<{ success: boolean }> {
  return apiFetch(`/api/proxy/templates/${id}`, { method: 'DELETE' }, signal);
}

export function getDownloadUrl(id: string): string {
  return `/api/proxy/templates/${id}/download`;
}
