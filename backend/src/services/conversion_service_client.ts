/**
 * Conversion Service Client (P3)
 *
 * HTTP client for the standalone conversion-service (PDF -> DOCX, Direction 1).
 * Mirrors the docling-service client pattern: axios + FormData + circuit
 * breaker. The backend forwards user uploads and polls job status; all auth
 * stays on this side (the service trusts the X-User-Id header we set).
 */
import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import { conversionBreaker } from '../utils/circuit_breaker';

const CONVERSION_URL = (
  process.env.CONVERSION_SERVICE_URL || 'http://localhost:8004'
).replace(/\/+$/, '');

const MEBIBYTE = 1024 * 1024;

export type UploadLimits = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
};

const PUBLIC_UPLOAD_LIMITS: UploadLimits = {
  maxFiles: 10,
  maxFileBytes: 50 * MEBIBYTE,
  maxTotalBytes: 500 * MEBIBYTE,
};

export function getSubmissionTimeoutMs(
  raw: string | undefined = process.env.CONVERSION_TIMEOUT_MS,
): number {
  if (!raw?.trim()) return 300_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 300_000;
  return Math.min(600_000, Math.max(1_000, Math.trunc(parsed)));
}

export function assertUploadBatch(
  fileSizes: readonly number[],
  limits: UploadLimits = PUBLIC_UPLOAD_LIMITS,
): void {
  if (fileSizes.length > limits.maxFiles) {
    throw new RangeError(`Bulk conversion accepts at most ${limits.maxFiles} files.`);
  }
  for (const size of fileSizes) {
    if (!Number.isFinite(size) || size < 0) {
      throw new RangeError('Upload size metadata is invalid.');
    }
    if (size > limits.maxFileBytes) {
      throw new RangeError(`A PDF exceeds ${Math.floor(limits.maxFileBytes / MEBIBYTE)} MB.`);
    }
  }
  const totalBytes = fileSizes.reduce((sum, size) => sum + size, 0);
  if (totalBytes > limits.maxTotalBytes) {
    throw new RangeError(`Bulk upload exceeds ${Math.floor(limits.maxTotalBytes / MEBIBYTE)} MB in total.`);
  }
}

type DiskUpload = { path: string; name: string };

async function statUploads(files: readonly DiskUpload[]): Promise<number[]> {
  const stats = await Promise.all(files.map((file) => fs.promises.stat(file.path)));
  return stats.map((stat) => stat.size);
}

function appendPdf(
  formData: FormData,
  field: 'file' | 'files',
  file: DiskUpload,
  knownLength: number,
): void {
  formData.append(field, fs.createReadStream(file.path), {
    filename: file.name,
    contentType: 'application/pdf',
    knownLength,
  });
}

export interface ConversionJobStatus {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'completed_with_warnings' | 'failed' | null;
  progress: number;
  resultUrl?: string | null;
  confidence?: number | null;
  degradedPages?: number[];
  error?: string | null;
  /** Owning user id — used to owner-scope reads (ticket 03); never echoed to clients. */
  userId?: string | null;
}

/**
 * BYOK vision attachment for a conversion job. Present only when the caller
 * has a usable Gemini config (see llm_config_service.getVisionConfig). The
 * key transits the private backend→conversion network inside the job payload
 * and is never logged or echoed back.
 */
export interface VisionJobConfig {
  provider: string;
  model: string;
  apiKey: string;
}

/** Submit a PDF (on disk) for conversion. Returns the service jobId. */
export async function submitConversion(
  pdfPath: string,
  filename: string,
  userId: string,
  vision?: VisionJobConfig | null,
): Promise<{ jobId: string; mode: string }> {
  const file = { path: pdfPath, name: filename };
  const [size] = await statUploads([file]);
  assertUploadBatch([size], PUBLIC_UPLOAD_LIMITS);
  const formData = new FormData();
  appendPdf(formData, 'file', file, size);
  if (vision) formData.append('vision', JSON.stringify(vision));

  const response = await conversionBreaker.execute(() =>
    axios.post(`${CONVERSION_URL}/convert`, formData, {
      timeout: getSubmissionTimeoutMs(),
      maxBodyLength: Infinity,
      headers: { ...formData.getHeaders(), 'X-User-Id': userId },
    }),
  );
  return response.data as { jobId: string; mode: string };
}

/** Poll a conversion job's status. */
export async function getConversionStatus(jobId: string): Promise<ConversionJobStatus> {
  const response = await conversionBreaker.execute(() =>
    axios.get(`${CONVERSION_URL}/convert/${encodeURIComponent(jobId)}`, {
      timeout: 10_000,
    }),
  );
  return response.data as ConversionJobStatus;
}

/** Confidence-flag review report (P4). */
export interface ConversionReport {
  jobId: string;
  status: string | null;
  confidence: number | null;
  coverage: number | null;
  degradedPages: number[];
  /** Owning user id — used to owner-scope reads (ticket 03); never echoed to clients. */
  userId?: string | null;
  flaggedBlocks: Array<{
    index: number; type: string; page: number | null;
    confidence: number; preview: string;
  }>;
  lowConfidencePages: Array<{ page: number; avg_confidence: number; blocks: number }>;
  demotions: number;
  pageTypes: Record<string, number>;
  warnings: string[];
  timings: Record<string, number>;
}

export async function getConversionReport(jobId: string): Promise<ConversionReport> {
  const response = await conversionBreaker.execute(() =>
    axios.get(`${CONVERSION_URL}/convert/${encodeURIComponent(jobId)}/report`, {
      timeout: 10_000,
    }),
  );
  return response.data as ConversionReport;
}

/** Bulk conversion (P4): submit several PDFs, one job each. */
export async function submitBulkConversion(
  files: DiskUpload[],
  userId: string,
  vision?: VisionJobConfig | null,
): Promise<{ jobs: Array<{ filename: string; jobId: string | null; error: string | null }>; count: number }> {
  const sizes = await statUploads(files);
  assertUploadBatch(sizes, PUBLIC_UPLOAD_LIMITS);
  const formData = new FormData();
  for (const [index, file] of files.entries()) {
    appendPdf(formData, 'files', file, sizes[index]);
  }
  if (vision) formData.append('vision', JSON.stringify(vision));
  const response = await conversionBreaker.execute(() =>
    axios.post(`${CONVERSION_URL}/convert/bulk`, formData, {
      timeout: getSubmissionTimeoutMs(),
      maxBodyLength: Infinity,
      headers: { ...formData.getHeaders(), 'X-User-Id': userId },
    }),
  );
  return response.data;
}

/** Download the finished DOCX as a Buffer (null when not ready). */
export async function getConversionResult(jobId: string): Promise<Buffer | null> {
  try {
    const response = await conversionBreaker.execute(() =>
      axios.get(`${CONVERSION_URL}/convert/${encodeURIComponent(jobId)}/result`, {
        timeout: getSubmissionTimeoutMs(),
        responseType: 'arraybuffer',
      }),
    );
    return Buffer.from(response.data);
  } catch (error: any) {
    if (error?.response?.status === 409 || error?.response?.status === 410) {
      return null;
    }
    throw error;
  }
}

/** Health probe for readiness checks. */
export async function conversionServiceHealthy(): Promise<boolean> {
  try {
    const response = await axios.get(`${CONVERSION_URL}/health`, { timeout: 3_000 });
    return response.status === 200;
  } catch {
    return false;
  }
}
