import axios from 'axios';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { getCloudRunAuthorization } from '../utils/cloud_run_auth';

export type WorkerState = 'starting' | 'running' | 'stopping' | 'stopped';

export interface ReadinessReport {
  status: 'ok' | 'degraded';
  timestamp: string;
  services: Record<string, 'healthy' | 'unhealthy'>;
}

export interface ReadinessOptions {
  workerStates: () => Record<string, WorkerState>;
  timeoutMs?: number;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function buildModelsUrl(rawBaseUrl: string): string {
  const url = new URL(rawBaseUrl);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.slice(-2).join('/').toLowerCase() === 'chat/completions') segments.splice(-2);
  if (segments.at(-1)?.toLowerCase() === 'models') return url.toString().replace(/\/$/, '');
  if (segments.length === 0) segments.push('v1');
  segments.push('models');
  url.pathname = `/${segments.join('/')}`;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Readiness probe timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probeHttp(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
  authenticateCloudRun = false,
): Promise<void> {
  const platformHeaders = authenticateCloudRun ? await getCloudRunAuthorization(url) : {};
  const response = await axios.get(url, {
    timeout: timeoutMs,
    maxRedirects: 0,
    headers: { ...headers, ...platformHeaders },
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`Unexpected status ${response.status}`);
}

async function probeWritable(directory: string): Promise<void> {
  await fs.promises.mkdir(directory, { recursive: true });
  const probe = path.join(directory, `.readiness-${process.pid}-${randomUUID()}`);
  try {
    await fs.promises.writeFile(probe, 'ready', { flag: 'wx' });
  } finally {
    await fs.promises.unlink(probe).catch(() => undefined);
  }
}

export async function checkReadiness(options: ReadinessOptions): Promise<ReadinessReport> {
  const timeoutMs = options.timeoutMs ?? 3_000;
  const rendererToken = process.env.RENDERER_INTERNAL_TOKEN || '';
  const uploadDir = process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads');
  const templateDir = process.env.TEMPLATE_STORAGE_DIR || path.resolve(__dirname, '../../uploads/templates');
  const ragStateDir = process.env.RAG_STATE_DIR || path.resolve(__dirname, '../../rag-state');
  const probes: Record<string, () => Promise<unknown>> = {
    database: () => prisma.$queryRaw`SELECT 1`,
    redis: async () => {
      if (redisClient.isFallback || !(await redisClient.isConnected())) throw new Error('Redis unavailable');
    },
    docling: () => probeHttp(`${trimTrailingSlashes(process.env.DOCLING_URL!)}/ready`, timeoutMs, undefined, true),
    embeddings: () => probeHttp(`${trimTrailingSlashes(process.env.EMBEDDINGS_URL!)}/ready`, timeoutMs, undefined, true),
    renderer: () => probeHttp(
      `${trimTrailingSlashes(process.env.DOCUMENT_RENDERER_URL!)}/ready`,
      timeoutMs,
      { 'x-renderer-token': rendererToken },
      true,
    ),
    uploadStorage: () => probeWritable(uploadDir),
    templateStorage: () => probeWritable(templateDir),
    ragStorage: () => probeWritable(ragStateDir),
    workers: async () => {
      const states = options.workerStates();
      if (!Object.keys(states).length || Object.values(states).some(state => state !== 'running')) {
        throw new Error('Background worker unavailable');
      }
    },
  };
  const defaultLlmBaseUrl = process.env.DEFAULT_LLM_BASE_URL?.trim();
  if (defaultLlmBaseUrl) {
    probes.defaultLlm = () => probeHttp(
      buildModelsUrl(defaultLlmBaseUrl),
      timeoutMs,
      process.env.DEFAULT_LLM_API_KEY
        ? { Authorization: `Bearer ${process.env.DEFAULT_LLM_API_KEY}` }
        : undefined,
    );
  }

  const entries = await Promise.all(Object.entries(probes).map(async ([name, probe]) => {
    try {
      await withTimeout(Promise.resolve().then(probe), timeoutMs);
      return [name, 'healthy'] as const;
    } catch {
      return [name, 'unhealthy'] as const;
    }
  }));
  const services = Object.fromEntries(entries);
  return {
    status: entries.every(([, status]) => status === 'healthy') ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    services,
  };
}
