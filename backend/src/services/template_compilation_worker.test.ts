const mockFuseTemplate = jest.fn();
jest.mock('./template_compiler', () => ({ fuseTemplate: (...args: unknown[]) => mockFuseTemplate(...args) }));

import { TemplateCompilationWorker } from './template_compilation_worker';

describe('TemplateCompilationWorker', () => {
  beforeEach(() => jest.clearAllMocks());

  it('recovers stale ANALYZING work before becoming ready', async () => {
    const store = {
      recoverStale: jest.fn().mockResolvedValue(undefined),
      next: jest.fn().mockResolvedValue(null),
      failInvalid: jest.fn(),
    };
    const worker = new TemplateCompilationWorker(store as any, 10_000);
    worker.start();
    expect(worker.state).toBe('starting');
    await new Promise(resolve => setImmediate(resolve));
    expect(store.recoverStale).toHaveBeenCalledWith(expect.any(Date));
    expect(worker.state).toBe('running');
    await worker.stop();
    expect(worker.state).toBe('stopped');
  });

  it('compiles persisted UPLOADED work and rejects missing originals durably', async () => {
    const valid = {
      id: 't1', ownerId: 'u1', originalPath: 'originals/u1/t1.docx', originalSha256: 'a'.repeat(64),
    };
    const store = {
      recoverStale: jest.fn(),
      next: jest.fn().mockResolvedValueOnce(valid).mockResolvedValueOnce({ ...valid, id: 't2', originalPath: null }),
      failInvalid: jest.fn().mockResolvedValue(undefined),
    };
    mockFuseTemplate.mockResolvedValue(undefined);
    const worker = new TemplateCompilationWorker(store as any);
    await expect(worker.runOnce()).resolves.toBe('processed');
    expect(mockFuseTemplate).toHaveBeenCalledWith('t1', 'u1', {
      templateId: 't1', relativePath: valid.originalPath, sha256: valid.originalSha256,
    });
    await expect(worker.runOnce()).resolves.toBe('processed');
    expect(store.failInvalid).toHaveBeenCalledWith(expect.objectContaining({ id: 't2' }));
  });
});
