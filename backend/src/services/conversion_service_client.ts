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
import { conversionBreaker } from '../utils/circuit_breaker';

const CONVERSION_URL = (
  process.env.CONVERSION_SERVICE_URL || 'http://localhost:8004'
).replace(/\/+$/, '');

const CONVERT_TIMEOUT_MS = Number(process.env.CONVERSION_TIMEOUT_MS) || 30_000;

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
  const buffer = await fs.promises.readFile(pdfPath);
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }),
    filename,
  );
  if (vision) formData.append('vision', JSON.stringify(vision));

  const response = await conversionBreaker.execute(() =>
    axios.post(`${CONVERSION_URL}/convert`, formData, {
      timeout: CONVERT_TIMEOUT_MS,
      headers: { 'X-User-Id': userId },
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
  files: Array<{ path: string; name: string }>,
  userId: string,
  vision?: VisionJobConfig | null,
): Promise<{ jobs: Array<{ filename: string; jobId: string | null; error: string | null }>; count: number }> {
  const formData = new FormData();
  for (const file of files) {
    const buffer = await fs.promises.readFile(file.path);
    formData.append(
      'files',
      new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }),
      file.name,
    );
  }
  if (vision) formData.append('vision', JSON.stringify(vision));
  const response = await conversionBreaker.execute(() =>
    axios.post(`${CONVERSION_URL}/convert/bulk`, formData, {
      timeout: CONVERT_TIMEOUT_MS,
      headers: { 'X-User-Id': userId },
    }),
  );
  return response.data;
}

/** Download the finished DOCX as a Buffer (null when not ready). */
export async function getConversionResult(jobId: string): Promise<Buffer | null> {
  try {
    const response = await conversionBreaker.execute(() =>
      axios.get(`${CONVERSION_URL}/convert/${encodeURIComponent(jobId)}/result`, {
        timeout: CONVERT_TIMEOUT_MS,
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
