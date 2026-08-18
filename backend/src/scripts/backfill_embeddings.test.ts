import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { backfillEmbeddings } from './backfill_embeddings';

// These tests do not touch a real database — they mock Prisma and the
// embeddings client to verify keyset pagination, bounded attempts, and
// failure recording.

const mockQueryRawUnsafe = jest.fn() as jest.MockedFunction<any>;
const mockExecuteRawUnsafe = jest.fn() as jest.MockedFunction<any>;
const mockGenerateEmbedding = jest.fn() as jest.MockedFunction<any>;

jest.mock('../utils/prisma', () => ({
  prisma: {
    $queryRawUnsafe: (...args: any[]) => mockQueryRawUnsafe(...args),
    $executeRawUnsafe: (...args: any[]) => mockExecuteRawUnsafe(...args),
    $disconnect: jest.fn(),
  },
}));

jest.mock('../utils/embeddings_client', () => ({
  embeddingsClient: {
    generateEmbedding: (...args: any[]) => mockGenerateEmbedding(...args),
  },
}));

// Override retry delay to near-instant so retry tests don't wait 5s real time
process.env.BACKFILL_RETRY_DELAY_MS = '1';

describe('backfillEmbeddings', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('handles zero chunks needing embedding', async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ count: 0n }]);
    const report = await backfillEmbeddings();
    expect(report.total).toBe(0);
    expect(report.embedded).toBe(0);
    expect(report.failed).toEqual([]);
  });

  it('embeds chunks and advances the cursor', async () => {
    mockQueryRawUnsafe
      .mockResolvedValueOnce([{ count: 3n }])
      .mockResolvedValueOnce([
        { id: 'c1', content: 'content 1' },
        { id: 'c2', content: 'content 2' },
      ])
      .mockResolvedValueOnce([
        { id: 'c3', content: 'content 3' },
      ])
      .mockResolvedValueOnce([]);

    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);

    const report = await backfillEmbeddings({ batchSize: 10 });
    expect(report.embedded).toBe(3);
    expect(report.failed).toEqual([]);
    expect(mockExecuteRawUnsafe).toHaveBeenCalledTimes(3);
  });

  it('records a failure after max 2 attempts on a poison chunk, continues with others', async () => {
    mockQueryRawUnsafe
      .mockResolvedValueOnce([{ count: 2n }])
      .mockResolvedValueOnce([
        { id: 'c1', content: 'good content' },
        { id: 'c2', content: 'bad content' },
      ])
      .mockResolvedValueOnce([]);

    mockGenerateEmbedding
      .mockResolvedValueOnce([0.1])          // c1 success
      .mockRejectedValueOnce(new Error('connection lost'))  // c2 attempt 1
      .mockRejectedValueOnce(new Error('timeout'));         // c2 attempt 2

    const report = await backfillEmbeddings({ batchSize: 10 });

    expect(report.embedded).toBe(1);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].chunkId).toBe('c2');
    expect(report.failed[0].attempts).toBe(2);
    expect(report.failed[0].errorCode).toBe('EMBEDDING_FAILED');

    const metadataCall = mockExecuteRawUnsafe.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('SET metadata'),
    );
    expect(metadataCall).toBeDefined();
    expect(metadataCall[0]).toContain("COALESCE(metadata, '{}'::jsonb) || $1::jsonb");
    expect(metadataCall[1]).toContain('embeddingBackfill');
  });

  it('terminates loop and does not select same failing chunk repeatedly', async () => {
    mockQueryRawUnsafe
      .mockResolvedValueOnce([{ count: 1n }])
      .mockResolvedValueOnce([{ id: 'c1', content: 'fail content' }])
      .mockResolvedValueOnce([]);

    mockGenerateEmbedding.mockRejectedValue(new Error('server error'));

    const report = await backfillEmbeddings({ batchSize: 10 });
    expect(report.embedded).toBe(0);
    expect(report.failed).toHaveLength(1);
    // count + batch1 + batch2(empty)
    expect(mockQueryRawUnsafe).toHaveBeenCalledTimes(3);
  });

  it('filters by documentId when provided', async () => {
    mockQueryRawUnsafe
      .mockResolvedValueOnce([{ count: 0n }]);

    await backfillEmbeddings({ documentId: 'doc-1' });
    expect(mockQueryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('"documentId" = $1'),
      'doc-1',
    );
  });
});
