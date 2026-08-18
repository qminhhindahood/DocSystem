/**
 * Backfill embeddings for chunks that were parsed but missing embeddings.
 *
 * Uses keyset pagination (ordered by id) to avoid re-scanning failed rows,
 * bounds each chunk to at most 2 attempts, and records failure metadata
 * in Chunk.metadata.embeddingsBackfill.
 *
 * Usage:
 *   npx tsx src/scripts/backfill_embeddings.ts              # all documents
 *   npx tsx src/scripts/backfill_embeddings.ts <documentId> # one document
 *
 * Exit code: 0  = all embedded successfully
 *            2  = one or more chunks failed after max attempts
 */

import { prisma } from '../utils/prisma';
import { embeddingsClient } from '../utils/embeddings_client';

export interface BackfillReport {
  total: number;
  embedded: number;
  failed: Array<{ chunkId: string; attempts: number; errorCode: string }>;
}

/**
 * Backfill embeddings for chunks missing them, using keyset pagination.
 * Each chunk is attempted at most twice before recording a failure.
 */
function getRetryDelayMs(): number {
  return parseInt(process.env.BACKFILL_RETRY_DELAY_MS || '5000', 10);
}

export async function backfillEmbeddings(
  options: { documentId?: string; batchSize?: number } = {},
): Promise<BackfillReport> {
  const { documentId, batchSize = 10 } = options;

  // Build count query
  let countSql: string;
  let countParams: any[];
  if (documentId) {
    countSql = 'SELECT COUNT(*) as count FROM "Chunk" WHERE embedding IS NULL AND "documentId" = $1';
    countParams = [documentId];
  } else {
    countSql = 'SELECT COUNT(*) as count FROM "Chunk" WHERE embedding IS NULL';
    countParams = [];
  }
  const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(countSql, ...countParams);
  const total = Number(countRows[0].count);
  console.log(`[backfill] ${total} chunks need embeddings`);

  const report: BackfillReport = { total, embedded: 0, failed: [] };
  if (total === 0) return report;
  let lastSeenId = '';

  while (true) {
    // Build keyset pagination query
    let sql: string;
    let params: any[];
    if (documentId) {
      sql = 'SELECT id, content FROM "Chunk" WHERE embedding IS NULL AND id > $1 AND "documentId" = $2 ORDER BY id ASC LIMIT $3';
      params = [lastSeenId, documentId, batchSize];
    } else {
      sql = 'SELECT id, content FROM "Chunk" WHERE embedding IS NULL AND id > $1 ORDER BY id ASC LIMIT $2';
      params = [lastSeenId, batchSize];
    }
    const chunks = await prisma.$queryRawUnsafe<{ id: string; content: string }[]>(sql, ...params);

    if (chunks.length === 0) break;

    for (const chunk of chunks) {
      let success = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const vector = await embeddingsClient.generateEmbedding(chunk.content, 'passage');
          await prisma.$executeRawUnsafe(
            'UPDATE "Chunk" SET embedding = $1::vector WHERE id = $2',
            `[${vector.join(',')}]`,
            chunk.id,
          );
          report.embedded++;
          success = true;
          break;
        } catch (err: any) {
          console.warn(`[backfill] chunk ${chunk.id} attempt ${attempt}/2 failed: ${err.message}`);
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, getRetryDelayMs()));
          }
        }
      }
      if (!success) {
        const failureMetadata = {
          embeddingBackfill: {
            attempts: 2,
            errorCode: 'EMBEDDING_FAILED',
            failedAt: new Date().toISOString(),
          },
        };
        await prisma.$executeRawUnsafe(
          `UPDATE "Chunk"
           SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
           WHERE id = $2`,
          JSON.stringify(failureMetadata),
          chunk.id,
        );
        report.failed.push({ chunkId: chunk.id, attempts: 2, errorCode: 'EMBEDDING_FAILED' });
      }
      lastSeenId = chunk.id;
    }

    if (report.embedded % 5 === 0 || report.embedded + report.failed.length >= total) {
      console.log(`[backfill] ${report.embedded}/${total} embedded, ${report.failed.length} failed`);
    }
  }

  console.log(`[backfill] complete: ${report.embedded} embedded, ${report.failed.length} failed`);
  return report;
}

// CLI entry point
if (require.main === module) {
  const docId = process.argv[2];
  backfillEmbeddings({ documentId: docId })
    .then((report) => {
      console.log(JSON.stringify({ total: report.total, embedded: report.embedded, failedCount: report.failed.length }));
      return prisma.$disconnect().then(() => process.exit(report.failed.length > 0 ? 2 : 0));
    })
    .catch(async (err) => {
      console.error('[backfill] FATAL:', err.message);
      await prisma.$disconnect();
      process.exit(1);
    });
}
