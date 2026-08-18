import {
  calculateRetryDelayMs,
  createIngestionJobRepository,
  sanitizeIngestionError,
} from './ingestion_job_repository';

function sqlText(query: { strings?: readonly string[] }): string {
  return query.strings?.join(' ') ?? '';
}

describe('ingestion job repository helpers', () => {
  it.each([
    [1, 5_000],
    [2, 30_000],
    [3, 120_000],
    [4, 600_000],
    [9, 600_000],
  ])('uses bounded retry delay for attempt %i', (attempt, expected) => {
    expect(calculateRetryDelayMs(attempt)).toBe(expected);
  });

  it('redacts common credentials and bounds stored errors', () => {
    const error = new Error(
      `Bearer secret-token sk-live-abcdefghijklmnopqrstuvwxyz postgresql://user:password@db/app ${'x'.repeat(2_000)}`,
    );

    const sanitized = sanitizeIngestionError(error);

    expect(sanitized).not.toContain('secret-token');
    expect(sanitized).not.toContain('sk-live-');
    expect(sanitized).not.toContain('user:password');
    expect(sanitized.length).toBeLessThanOrEqual(1_000);
  });
});

describe('claimNextJob', () => {
  it('returns the complete claimed job row from the atomic query', async () => {
    const claimed = {
      id: 'job-1',
      documentId: 'doc-1',
      ownerId: 'user-1',
      attempts: 1,
      maxAttempts: 5,
      exhaustedLease: false,
    };
    const client = {
      $queryRaw: jest.fn().mockResolvedValue([claimed]),
    };
    const repository = createIngestionJobRepository(client as never);

    await expect(repository.claimNextJob('worker-1', 60_000)).resolves.toEqual(claimed);
    expect(client.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns null when no due or expired job can be claimed', async () => {
    const client = { $queryRaw: jest.fn().mockResolvedValue([]) };
    const repository = createIngestionJobRepository(client as never);

    await expect(repository.claimNextJob('worker-1', 60_000)).resolves.toBeNull();
  });

  it('claims an expired exhausted lease without incrementing into an extra attempt', async () => {
    const client = { $queryRaw: jest.fn().mockResolvedValue([]) };
    const repository = createIngestionJobRepository(client as never);

    await repository.claimNextJob('worker-1', 60_000);

    const query = client.$queryRaw.mock.calls[0][0] as { strings?: readonly string[] };
    const sql = sqlText(query);
    expect(sql).toContain(`job."status" = 'running' AND job."leaseExpiresAt" < NOW()`);
    expect(sql).toContain('CASE WHEN candidate."exhaustedLease"');
  });
});

describe('lease transitions', () => {
  it.each([
    ['renewLease', ['job-1', 'worker-1', 60_000]],
    ['completeJob', ['job-1', 'worker-1']],
  ] as const)('%s requires a still-valid lease and uses the database clock', async (method, args) => {
    const client = { $executeRaw: jest.fn().mockResolvedValue(1) };
    const repository = createIngestionJobRepository(client as never);

    await (repository[method] as (...values: any[]) => Promise<boolean>)(...args);

    const sql = sqlText(client.$executeRaw.mock.calls[0][0]);
    expect(sql).toContain('"leaseExpiresAt" > NOW()');
    expect(sql).toContain('NOW()');
  });
});

describe('retryOrFailJob', () => {
  it('updates the leased job and document in one transaction', async () => {
    const transactionClient = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'job-1' }]),
      document: { update: jest.fn().mockResolvedValue({}) },
    };
    const client = {
      $transaction: jest.fn(async (operation: (tx: typeof transactionClient) => Promise<unknown>) => (
        operation(transactionClient)
      )),
    };
    const repository = createIngestionJobRepository(client as never);

    await expect(repository.retryOrFailJob({
      id: 'job-1',
      documentId: 'doc-1',
      ownerId: 'user-1',
      attempts: 1,
      maxAttempts: 5,
      exhaustedLease: false,
    }, 'worker-1', new Error('temporary failure'))).resolves.toBe('retrying');

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionClient.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = sqlText(transactionClient.$queryRaw.mock.calls[0][0]);
    expect(sql).toContain('"leaseExpiresAt" > NOW()');
    expect(sql).toContain('"availableAt" = NOW()');
    expect(transactionClient.document.update).toHaveBeenCalledTimes(1);
  });

  it('does not update the document after the lease has been lost', async () => {
    const transactionClient = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      document: { update: jest.fn() },
    };
    const client = {
      $transaction: jest.fn(async (operation: (tx: typeof transactionClient) => Promise<unknown>) => (
        operation(transactionClient)
      )),
    };
    const repository = createIngestionJobRepository(client as never);

    await expect(repository.retryOrFailJob({
      id: 'job-1',
      documentId: 'doc-1',
      ownerId: 'user-1',
      attempts: 1,
      maxAttempts: 5,
      exhaustedLease: false,
    }, 'worker-1', new Error('temporary failure'))).resolves.toBe('lease_lost');

    expect(transactionClient.document.update).not.toHaveBeenCalled();
  });
});
