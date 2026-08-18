import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

export interface ClaimedIngestionJob {
  id: string;
  documentId: string;
  ownerId: string;
  attempts: number;
  maxAttempts: number;
  exhaustedLease: boolean;
}

export type FailedAttemptOutcome = 'retrying' | 'failed' | 'lease_lost';

export interface IngestionJobRepository {
  claimNextJob(workerId: string, leaseMs: number): Promise<ClaimedIngestionJob | null>;
  renewLease(jobId: string, workerId: string, leaseMs: number): Promise<boolean>;
  completeJob(jobId: string, workerId: string): Promise<boolean>;
  retryOrFailJob(
    job: ClaimedIngestionJob,
    workerId: string,
    error: unknown,
  ): Promise<FailedAttemptOutcome>;
}

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000] as const;

export function calculateRetryDelayMs(attempt: number): number {
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, attempt - 1));
  return RETRY_DELAYS_MS[index];
}

export function sanitizeIngestionError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-[REDACTED]')
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 1_000);
}

type RepositoryClient = typeof prisma;

export function createIngestionJobRepository(
  client: RepositoryClient = prisma,
): IngestionJobRepository {
  return {
    async claimNextJob(workerId, leaseMs) {
      const rows = await client.$queryRaw<ClaimedIngestionJob[]>(Prisma.sql`
        WITH candidate AS (
          SELECT job."id",
                 (job."status" = 'running' AND job."attempts" >= job."maxAttempts")
                   AS "exhaustedLease"
          FROM "IngestionJob" AS job
          WHERE (
            (
              job."status" IN ('queued', 'retrying')
              AND job."availableAt" <= NOW()
              AND job."attempts" < job."maxAttempts"
            )
            OR (job."status" = 'running' AND job."leaseExpiresAt" < NOW())
          )
          ORDER BY job."availableAt" ASC, job."createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "IngestionJob" AS job
        SET "status" = 'running',
            "attempts" = CASE WHEN candidate."exhaustedLease"
              THEN job."attempts"
              ELSE job."attempts" + 1
            END,
            "leaseOwner" = ${workerId},
            "leaseExpiresAt" = NOW() + (${leaseMs} * INTERVAL '1 millisecond'),
            "updatedAt" = NOW()
        FROM candidate, "Document" AS document
        WHERE job."id" = candidate."id"
          AND document."id" = job."documentId"
        RETURNING job."id", job."documentId", document."ownerId", job."attempts",
                  job."maxAttempts", candidate."exhaustedLease" AS "exhaustedLease"
      `);
      return rows[0] ?? null;
    },

    async renewLease(jobId, workerId, leaseMs) {
      const count = await client.$executeRaw(Prisma.sql`
        UPDATE "IngestionJob"
        SET "leaseExpiresAt" = NOW() + (${leaseMs} * INTERVAL '1 millisecond'),
            "updatedAt" = NOW()
        WHERE "id" = ${jobId}
          AND "status" = 'running'
          AND "leaseOwner" = ${workerId}
          AND "leaseExpiresAt" > NOW()
      `);
      return count === 1;
    },

    async completeJob(jobId, workerId) {
      const count = await client.$executeRaw(Prisma.sql`
        UPDATE "IngestionJob"
        SET "status" = 'completed',
            "leaseOwner" = NULL,
            "leaseExpiresAt" = NULL,
            "lastError" = NULL,
            "completedAt" = NOW(),
            "updatedAt" = NOW()
        WHERE "id" = ${jobId}
          AND "status" = 'running'
          AND "leaseOwner" = ${workerId}
          AND "leaseExpiresAt" > NOW()
      `);
      return count === 1;
    },

    async retryOrFailJob(job, workerId, error) {
      const terminal = job.attempts >= job.maxAttempts;
      const lastError = sanitizeIngestionError(error);
      return client.$transaction(async (transaction) => {
        const changed = terminal
          ? await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              UPDATE "IngestionJob"
              SET "status" = 'failed',
                  "leaseOwner" = NULL,
                  "leaseExpiresAt" = NULL,
                  "lastError" = ${lastError},
                  "completedAt" = NOW(),
                  "updatedAt" = NOW()
              WHERE "id" = ${job.id}
                AND "status" = 'running'
                AND "leaseOwner" = ${workerId}
                AND "leaseExpiresAt" > NOW()
              RETURNING "id"
            `)
          : await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              UPDATE "IngestionJob"
              SET "status" = 'retrying',
                  "leaseOwner" = NULL,
                  "leaseExpiresAt" = NULL,
                  "lastError" = ${lastError},
                  "availableAt" = NOW() + (
                    ${calculateRetryDelayMs(job.attempts)} * INTERVAL '1 millisecond'
                  ),
                  "updatedAt" = NOW()
              WHERE "id" = ${job.id}
                AND "status" = 'running'
                AND "leaseOwner" = ${workerId}
                AND "leaseExpiresAt" > NOW()
              RETURNING "id"
            `);
        if (changed.length !== 1) return 'lease_lost';

        await transaction.document.update({
          where: { id: job.documentId, ownerId: job.ownerId },
          data: terminal
            ? { ingestionStatus: 'failed', processingError: lastError }
            : { ingestionStatus: 'uploaded', processingError: lastError },
        });
        return terminal ? 'failed' : 'retrying';
      });
    },
  };
}
