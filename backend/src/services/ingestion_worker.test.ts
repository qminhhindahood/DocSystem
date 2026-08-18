import {
  createDefaultIngestionWorker,
  IngestionWorker,
  type ClaimedIngestionJob,
  type IngestionJobRepository,
  type WorkerRunOutcome,
} from './ingestion_worker';

const job = (): ClaimedIngestionJob => ({
  id: 'job-1',
  documentId: 'doc-1',
  ownerId: 'user-1',
  attempts: 1,
  maxAttempts: 5,
  exhaustedLease: false,
});

class FakeRepository implements IngestionJobRepository {
  available: ClaimedIngestionJob | null = job();
  state = 'queued';
  renewals = 0;
  failureOutcome: 'retrying' | 'failed' | 'lease_lost' = 'retrying';

  async claimNextJob(): Promise<ClaimedIngestionJob | null> {
    const claimed = this.available;
    this.available = null;
    if (claimed) this.state = 'running';
    return claimed;
  }

  async renewLease(): Promise<boolean> {
    if (this.state !== 'running') return false;
    this.renewals += 1;
    return true;
  }

  async completeJob(): Promise<boolean> {
    if (this.state !== 'running') return false;
    this.state = 'completed';
    return true;
  }

  async retryOrFailJob(): Promise<'retrying' | 'failed' | 'lease_lost'> {
    this.state = this.failureOutcome;
    return this.failureOutcome;
  }
}

function createWorker(
  repository: FakeRepository,
  processDocument: () => Promise<void>,
  cleanupDocumentFile: () => Promise<void>,
) {
  return new IngestionWorker({
    repository,
    processDocument,
    cleanupDocumentFile,
    workerId: 'worker-1',
    leaseMs: 60_000,
    heartbeatMs: 10_000,
    pollMs: 50,
  });
}

describe('IngestionWorker.runOnce', () => {
  it('completes and cleans up a successfully processed upload', async () => {
    const repository = new FakeRepository();
    let processed = 0;
    let cleaned = 0;
    const worker = createWorker(
      repository,
      async () => { processed += 1; },
      async () => { cleaned += 1; },
    );

    const outcome: WorkerRunOutcome = await worker.runOnce();

    expect(outcome).toBe('completed');
    expect(repository.state).toBe('completed');
    expect(processed).toBe(1);
    expect(cleaned).toBe(1);
  });

  it('retains the upload when a failed attempt is scheduled for retry', async () => {
    const repository = new FakeRepository();
    let cleaned = 0;
    const worker = createWorker(
      repository,
      async () => { throw new Error('temporary parser outage'); },
      async () => { cleaned += 1; },
    );

    await expect(worker.runOnce()).resolves.toBe('retrying');
    expect(repository.state).toBe('retrying');
    expect(cleaned).toBe(0);
  });

  it('cleans up the upload after terminal failure', async () => {
    const repository = new FakeRepository();
    repository.failureOutcome = 'failed';
    let cleaned = 0;
    const worker = createWorker(
      repository,
      async () => { throw new Error('invalid document'); },
      async () => { cleaned += 1; },
    );

    await expect(worker.runOnce()).resolves.toBe('failed');
    expect(repository.state).toBe('failed');
    expect(cleaned).toBe(1);
  });

  it('fails and cleans up an expired final attempt without processing it again', async () => {
    const repository = new FakeRepository();
    repository.available = {
      ...job(),
      attempts: 5,
      maxAttempts: 5,
      exhaustedLease: true,
    };
    repository.failureOutcome = 'failed';
    const processDocument = jest.fn().mockResolvedValue(undefined);
    const cleanupDocumentFile = jest.fn().mockResolvedValue(undefined);
    const worker = createWorker(repository, processDocument, cleanupDocumentFile);

    await expect(worker.runOnce()).resolves.toBe('failed');

    expect(processDocument).not.toHaveBeenCalled();
    expect(repository.state).toBe('failed');
    expect(cleanupDocumentFile).toHaveBeenCalledTimes(1);
  });

  it('renews the active lease while processing is still running', async () => {
    jest.useFakeTimers();
    const repository = new FakeRepository();
    let finish!: () => void;
    const processing = new Promise<void>((resolve) => { finish = resolve; });
    const worker = createWorker(repository, () => processing, async () => undefined);

    const run = worker.runOnce();
    await Promise.resolve();
    jest.advanceTimersByTime(10_000);
    await Promise.resolve();

    expect(repository.renewals).toBe(1);
    finish();
    await expect(run).resolves.toBe('completed');
    jest.useRealTimers();
  });
});

describe('IngestionWorker lifecycle', () => {
  afterEach(() => jest.useRealTimers());

  it('polls after an idle cycle and stops claiming new jobs', async () => {
    jest.useFakeTimers();
    const repository = new FakeRepository();
    repository.available = null;
    let processed = 0;
    const worker = createWorker(
      repository,
      async () => { processed += 1; },
      async () => undefined,
    );

    worker.start();
    await Promise.resolve();
    await Promise.resolve();
    repository.available = job();
    try {
      await jest.advanceTimersByTimeAsync(50);
      expect(processed).toBe(1);
    } finally {
      await worker.stop();
    }
    expect(jest.getTimerCount()).toBe(0);

    repository.available = job();
    await jest.advanceTimersByTimeAsync(100);
    expect(processed).toBe(1);
  });

  it('waits for active processing to settle during graceful stop', async () => {
    const repository = new FakeRepository();
    let finish!: () => void;
    const processing = new Promise<void>((resolve) => { finish = resolve; });
    const worker = createWorker(repository, () => processing, async () => undefined);
    let stopped = false;

    worker.start();
    await Promise.resolve();
    const stopping = worker.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);

    finish();
    await stopping;
    expect(stopped).toBe(true);
  });
});

describe('createDefaultIngestionWorker', () => {
  it('processes and cleans files with the owning user scope', async () => {
    const repository = new FakeRepository();
    const processIngestion = jest.fn().mockResolvedValue(undefined);
    const cleanupIngestionFile = jest.fn().mockResolvedValue(undefined);
    const worker = createDefaultIngestionWorker({
      repository,
      processIngestion,
      cleanupIngestionFile,
      workerId: 'worker-1',
    });

    await expect(worker.runOnce()).resolves.toBe('completed');
    expect(processIngestion).toHaveBeenCalledWith('doc-1', {
      kind: 'user',
      userId: 'user-1',
    });
    expect(cleanupIngestionFile).toHaveBeenCalledWith('doc-1', {
      kind: 'user',
      userId: 'user-1',
    });
  });
});
