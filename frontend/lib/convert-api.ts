/**
 * Conversion API client (P3) — PDF -> DOCX via /api/proxy/convert.
 * Auth rides the HttpOnly session cookie through the server-side proxy.
 */

const API_BASE = '/api/proxy';

export class AuthError extends Error {
  constructor() { super('Unauthorized'); this.name = 'AuthError'; }
}

export interface ConversionStatus {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'completed_with_warnings' | 'failed' | null;
  progress: number;
  resultUrl?: string | null;
  confidence?: number | null;
  degradedPages?: number[];
  error?: string | null;
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new AuthError();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Yêu cầu thất bại (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Upload a PDF and start a conversion job. */
export async function submitConversion(file: File): Promise<{ jobId: string }> {
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await fetch(`${API_BASE}/convert`, { method: 'POST', body: form });
  return handle<{ success: boolean; jobId: string }>(res);
}

/** Poll a conversion job's status. */
export async function getConversionStatus(jobId: string): Promise<ConversionStatus> {
  const res = await fetch(`${API_BASE}/convert/${encodeURIComponent(jobId)}`);
  return handle<ConversionStatus & { success: boolean }>(res);
}

/** URL for downloading the finished DOCX (through the proxy). */
export function conversionResultUrl(jobId: string): string {
  return `${API_BASE}/convert/${encodeURIComponent(jobId)}/result`;
}

export interface FlaggedBlock {
  index: number;
  type: string;
  page: number | null;
  confidence: number;
  preview: string;
}

export interface LowConfidencePage {
  page: number;
  avg_confidence: number;
  blocks: number;
}

export interface ConversionReport {
  jobId: string;
  status: string | null;
  confidence: number | null;
  degradedPages: number[];
  flaggedBlocks: FlaggedBlock[];
  lowConfidencePages: LowConfidencePage[];
  demotions: number;
  pageTypes: Record<string, number>;
  warnings: string[];
  timings: Record<string, number>;
}

/** Fetch the confidence-flag review report (P4). */
export async function getConversionReport(jobId: string): Promise<ConversionReport> {
  const res = await fetch(`${API_BASE}/convert/${encodeURIComponent(jobId)}/report`);
  return handle<ConversionReport & { success: boolean }>(res);
}

export interface BulkResult {
  jobs: Array<{ filename: string; jobId: string | null; error: string | null }>;
  count: number;
}

/** Submit several PDFs for bulk conversion (P4). */
export async function submitBulkConversion(files: File[]): Promise<BulkResult> {
  const form = new FormData();
  for (const file of files) form.append('files', file, file.name);
  const res = await fetch(`${API_BASE}/convert/bulk`, { method: 'POST', body: form });
  return handle<BulkResult & { success: boolean }>(res);
}
