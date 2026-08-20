import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { conversionServiceHealthy } from '../services/conversion_service_client';

export interface ReadinessReport {
  status: 'ok' | 'degraded';
  timestamp: string;
  services: Record<string, 'healthy' | 'unhealthy'>;
}

export interface ReadinessOptions {
  timeoutMs?: number;
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

/**
 * Readiness for the standalone conversion product: database, Redis, and the
 * conversion service. Nothing else is part of this stack — health is never
 * degraded by services that don't exist here.
 */
export async function checkReadiness(options: ReadinessOptions): Promise<ReadinessReport> {
  const timeoutMs = options.timeoutMs ?? 3_000;
  const conversionUrl = process.env.CONVERSION_SERVICE_URL;
  const probes: Record<string, () => Promise<unknown>> = {
    database: () => prisma.$queryRaw`SELECT 1`,
    redis: async () => {
      if (redisClient.isFallback || !(await redisClient.isConnected())) throw new Error('Redis unavailable');
    },
    conversion: async () => {
      if (!conversionUrl) throw new Error('CONVERSION_SERVICE_URL not configured');
      if (!(await conversionServiceHealthy())) throw new Error('Conversion service unavailable');
    },
  };

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
