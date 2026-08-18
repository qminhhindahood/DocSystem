import { randomUUID } from 'crypto';
import { hostname } from 'os';
import type {
  ClaimedIngestionJob,
  FailedAttemptOutcome,
  IngestionJobRepository as JobRepository,
} from './ingestion_job_repository';
import { createIngestionJobRepository } from './ingestion_job_repository';
import {
  cleanupIngestionFile as cleanupStoredIngestionFile,
  processIngestion as processStoredIngestion,
} from './ingestion_service';

export type { ClaimedIngestionJob } from './ingestion_job_repository';
export type IngestionJobRepository = JobRepository;
export type WorkerRunOutcome = 'idle' | 'completed' | FailedAttemptOutcome;

export interface IngestionWorkerOptions {
  repository: IngestionJobRepository;
  processDocument: (job: ClaimedIngestionJob) => Promise<void>;
  cleanupDocumentFile: (job: ClaimedIngestionJob) => Promise<void>;
  workerId: string;
  leaseMs: number;
  heartbeatMs: number;
  pollMs: number;
}

export class IngestionWorker {
  private stopping = true;
  private loopPromise: Promise<void> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private wakePoll: (() => void) | null = null;

  constructor(private readonly options: IngestionWorkerOptions) {}

  get state(): 'running' | 'stopping' | 'stopped' {
    if (!this.loopPromise) return 'stopped';
    return this.stopping ? 'stopping' : 'running';
  }

  async runOnce(): Promise<WorkerRunOutcome> {
    const job = await this.options.repository.claimNextJob(
      this.options.workerId,
      this.options.leaseMs,
    );
    if (!job) return 'idle';

    // A worker may die after claiming the final allowed attempt. Reclaim the
    // expired lease only to record terminal failure and clean up; never run an
    // unbounded extra attempt.
    if (job.exhaustedLease) {
      const outcome = await this.options.repository.retryOrFailJob(
        job,
        this.options.workerId,
        new Error('Final ingestion attempt lease expired before completion'),
      );
      if (outcome === 'failed') await this.cleanupBestEffort(job);
      return outcome;
    }

    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.options.repository
        .renewLease(job.id, this.options.workerId, this.options.leaseMs)
        .then((renewed) => { if (!renewed) leaseLost = true; })
        .catch(() => { leaseLost = true; });
    }, this.options.heartbeatMs);

    try {
      await this.options.processDocument(job);
    } catch (error) {
      clearInterval(heartbeat);
      if (leaseLost) return 'lease_lost';
      const outcome = await this.options.repository.retryOrFailJob(
        job,
        this.options.workerId,
        error,
      );
      if (outcome === 'failed') await this.cleanupBestEffort(job);
      return outcome;
    }

    clearInterval(heartbeat);
    if (leaseLost) return 'lease_lost';
    const completed = await this.options.repository.completeJob(job.id, this.options.workerId);
    if (!completed) return 'lease_lost';
    await this.cleanupBestEffort(job);
    return 'completed';
  }

  start(): void {
    if (!this.stopping) return;
    this.stopping = false;
    this.loopPromise = this.runLoop();
  }

  async stop(graceMs = 30_000): Promise<void> {
    this.stopping = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.wakePoll?.();
    const loop = this.loopPromise;
    if (!loop) return;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        loop,
        new Promise<void>((resolve) => {
          graceTimer = setTimeout(resolve, graceMs);
        }),
      ]);
    } finally {
      if (graceTimer) clearTimeout(graceTimer);
      if (this.loopPromise === loop) this.loopPromise = null;
    }
  }

  private async runLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        const outcome = await this.runOnce();
        if (outcome === 'idle') await this.waitForPoll();
      } catch (error) {
        console.error(`[IngestionWorker:${this.options.workerId}] cycle failed:`, error);
        await this.waitForPoll();
      }
    }
  }

  private waitForPoll(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = null;
        this.wakePoll = null;
        resolve();
      };
      this.wakePoll = finish;
      this.pollTimer = setTimeout(finish, this.options.pollMs);
    });
  }

  private async cleanupBestEffort(job: ClaimedIngestionJob): Promise<void> {
    try {
      await this.options.cleanupDocumentFile(job);
    } catch (error) {
      console.warn(
        `[IngestionWorker:${this.options.workerId}] cleanup failed for ${job.documentId}:`,
        error,
      );
    }
  }
}

interface DefaultIngestionWorkerOverrides {
  repository?: IngestionJobRepository;
  processIngestion?: typeof processStoredIngestion;
  cleanupIngestionFile?: typeof cleanupStoredIngestionFile;
  workerId?: string;
  leaseMs?: number;
  heartbeatMs?: number;
  pollMs?: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createDefaultIngestionWorker(
  overrides: DefaultIngestionWorkerOverrides = {},
): IngestionWorker {
  const processIngestion = overrides.processIngestion ?? processStoredIngestion;
  const cleanupIngestionFile = overrides.cleanupIngestionFile ?? cleanupStoredIngestionFile;
  return new IngestionWorker({
    repository: overrides.repository ?? createIngestionJobRepository(),
    processDocument: (job) => processIngestion(job.documentId, {
      kind: 'user',
      userId: job.ownerId,
    }),
    cleanupDocumentFile: (job) => cleanupIngestionFile(job.documentId, {
      kind: 'user',
      userId: job.ownerId,
    }),
    workerId: overrides.workerId ?? `${hostname()}:${process.pid}:${randomUUID()}`,
    leaseMs: overrides.leaseMs
      ?? positiveInteger(process.env.INGESTION_WORKER_LEASE_MS, 15 * 60_000),
    heartbeatMs: overrides.heartbeatMs
      ?? positiveInteger(process.env.INGESTION_WORKER_HEARTBEAT_MS, 30_000),
    pollMs: overrides.pollMs
      ?? positiveInteger(process.env.INGESTION_WORKER_POLL_MS, 1_000),
  });
}
