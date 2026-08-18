import { hasSufficientEvidence, retryRetrieve, shouldRegenerate, retrieveWithQuality } from './self_correct';

// Default mock for query_rewriter — broadenQuery is the new focus
jest.mock('./query_rewriter', () => ({
  broadenQuery: jest.fn((q: string) => Promise.resolve(q + ' (broadened)')),
  rewriteQuery: jest.fn((q: string) => Promise.resolve(q + ' (rewritten)')),
  buildQueryVariants: jest.fn((q: string) => Promise.resolve([q, q + ' (expanded)'])),
}));
jest.mock('./context_filter', () => ({
  filterRelevantChunks: jest.fn(),
  checkFaithfulness: jest.fn(),
  checkAnswerability: jest.fn(),
}));
jest.mock('./retrieval_observability', () => ({
  emitRetrievalMetric: jest.fn(),
}));

const rw = require('./query_rewriter');
const cf = require('./context_filter');

describe('self_correct', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENABLE_SELF_CORRECT = 'false';
    process.env.RAG_MAX_RETRIES = '1';
  });

  describe('retryRetrieve', () => {
    it('bounds an excessive retry setting to one retry', async () => {
      process.env.ENABLE_SELF_CORRECT = 'true';
      process.env.RAG_MAX_RETRIES = '99';
      const search = jest.fn().mockResolvedValue([{ id: '1', content: 'x', level: 1 }]);
      cf.filterRelevantChunks.mockResolvedValue([{ id: '1', content: 'x', level: 1 }]);
      await retryRetrieve('q', search);
      expect(search).toHaveBeenCalledTimes(2);
    });
    it('passes through to search when disabled', async () => {
      const search = jest.fn().mockResolvedValue([{ id: '1', content: 'x', level: 1 }]);
      const out = await retryRetrieve('q', search);
      expect(search).toHaveBeenCalledTimes(1);
      expect(out).toHaveLength(1);
      expect(cf.filterRelevantChunks).not.toHaveBeenCalled();
    });

    it('rewrites + re-searches once when first pass yields <2 relevant', async () => {
      process.env.ENABLE_SELF_CORRECT = 'true';
      const search = jest
        .fn()
        .mockResolvedValueOnce([{ id: '1', content: 'x', level: 1 }])
        .mockResolvedValueOnce([
          { id: '2', content: 'Điều 5 thể thức', level: 1 },
          { id: '3', content: 'ký ban hành', level: 1 },
        ]);
      cf.filterRelevantChunks
        .mockResolvedValueOnce([{ id: '1', content: 'x', level: 1 }])
        .mockResolvedValueOnce([
          { id: '2', content: 'Điều 5 thể thức', level: 1 },
          { id: '3', content: 'ký ban hành', level: 1 },
        ]);

      const out = await retryRetrieve('thể thức văn bản', search);
      expect(search).toHaveBeenCalledTimes(2);
      expect(rw.broadenQuery).toHaveBeenCalledTimes(1);
      expect(out.length).toBe(2);
    });

    it('does not exceed MAX_RETRIES', async () => {
      process.env.ENABLE_SELF_CORRECT = 'true';
      const search = jest.fn().mockResolvedValue([{ id: '1', content: 'x', level: 1 }]);
      cf.filterRelevantChunks.mockResolvedValue([{ id: '1', content: 'x', level: 1 }]);
      const out = await retryRetrieve('q', search);
      expect(search).toHaveBeenCalledTimes(2);
      expect(out).toHaveLength(1);
    });

    // --- Flag-combination tests (Task 2) ---

    it('retries with a broadened query when SELF_CORRECT enabled and REWRITER disabled', async () => {
      process.env.ENABLE_SELF_CORRECT = 'true';
      process.env.ENABLE_QUERY_REWRITER = 'false';
      // Ensure broadenQuery produces a different query even when rewriter is off
      (rw.broadenQuery as jest.Mock).mockResolvedValue('q quy định hướng dẫn liên quan');

      const search = jest.fn()
        .mockResolvedValueOnce([{ id: '1', content: 'x', level: 1 }])
        .mockResolvedValueOnce([{ id: '2', content: 'y', level: 1 }, { id: '3', content: 'z', level: 1 }]);
      cf.filterRelevantChunks
        .mockResolvedValueOnce([{ id: '1', content: 'x', level: 1 }])
        .mockResolvedValueOnce([{ id: '2', content: 'y', level: 1 }, { id: '3', content: 'z', level: 1 }]);

      const out = await retryRetrieve('q', search);
      expect(rw.broadenQuery).toHaveBeenCalledWith('q', undefined);
      expect(search).toHaveBeenCalledTimes(2);
      expect(out).toHaveLength(2);
    });

    it('uses broadenQuery for retry even when both flags enabled', async () => {
      process.env.ENABLE_SELF_CORRECT = 'true';
      process.env.ENABLE_QUERY_REWRITER = 'true';
      (rw.broadenQuery as jest.Mock).mockResolvedValue('q (rewritten) (broadened)');

      const search = jest.fn()
        .mockResolvedValueOnce([{ id: '1', content: 'x', level: 1 }])
        .mockResolvedValueOnce([{ id: '2', content: 'y', level: 1 }]);
      cf.filterRelevantChunks
        .mockResolvedValueOnce([{ id: '1', content: 'x', level: 1 }])
        .mockResolvedValueOnce([{ id: '2', content: 'y', level: 1 }]);

      await retryRetrieve('q', search);
      expect(rw.broadenQuery).toHaveBeenCalled();
      expect(search).toHaveBeenCalledTimes(2);
    });

    it('does not retry when self-correct is disabled (even with REWRITER enabled)', async () => {
      process.env.ENABLE_SELF_CORRECT = 'false';
      process.env.ENABLE_QUERY_REWRITER = 'true';
      const search = jest.fn().mockResolvedValue([{ id: '1', content: 'x', level: 1 }]);

      await retryRetrieve('q', search);
      expect(search).toHaveBeenCalledTimes(1);
      expect(rw.broadenQuery).not.toHaveBeenCalled();
    });

    it('retries at most once when both flags enabled', async () => {
      process.env.ENABLE_SELF_CORRECT = 'true';
      const search = jest.fn().mockResolvedValue([{ id: '1', content: 'never enough', level: 1 }]);
      cf.filterRelevantChunks.mockResolvedValue([{ id: '1', content: 'never enough', level: 1 }]);

      await retryRetrieve('q', search);
      expect(search).toHaveBeenCalledTimes(2); // initial + 1 retry
      expect(rw.broadenQuery).toHaveBeenCalledTimes(1);
    });
  });

  it('fuses original and expanded queries without losing the original query route', async () => {
    const chunks = [{ id: '1', documentId: 'doc-1', content: 'x', level: 1 }];
    const lexicalOnly = [{ id: '2', documentId: 'doc-2', content: 'y', level: 1 }];
    const search = jest.fn().mockResolvedValueOnce(chunks).mockResolvedValueOnce(lexicalOnly);
    process.env.ENABLE_QUERY_REWRITER = 'true';
    cf.filterRelevantChunks.mockImplementation((_: string, results: any[]) => Promise.resolve(results));
    await expect(retrieveWithQuality('original', search, { finalLimit: 5 })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining(chunks[0]),
      expect.objectContaining(lexicalOnly[0]),
    ]));
    expect(rw.buildQueryVariants).toHaveBeenCalledWith('original', undefined);
    expect(search).toHaveBeenCalledWith('original');
    expect(search).toHaveBeenCalledWith('original (expanded)');
    // The mock returns 'original (expanded)' which is the merged expectation — adjust to respect the mock
    expect(search).toHaveBeenCalledTimes(2);
    expect(cf.filterRelevantChunks).toHaveBeenCalledTimes(1);
  });

  describe('shouldRegenerate', () => {
    it('returns false when disabled', async () => {
      expect(await shouldRegenerate('q', 'a', 'c')).toBe(false);
    });
    it('returns true on low faithfulness', async () => {
      process.env.ENABLE_SELF_CORRECT = 'true';
      cf.checkFaithfulness.mockResolvedValueOnce(0.2);
      expect(await shouldRegenerate('q', 'a', 'c')).toBe(true);
    });
    it('does not regenerate from the same context merely because it is insufficient', async () => {
      process.env.ENABLE_SELF_CORRECT = 'true';
      cf.checkFaithfulness.mockResolvedValueOnce(0.9);
      expect(await shouldRegenerate('q', 'a', 'c')).toBe(false);
    });
    it('marks weak evidence as insufficient before generation', async () => {
      process.env.ENABLE_SELF_CORRECT = 'true';
      cf.checkAnswerability.mockResolvedValueOnce(0.1);
      expect(await hasSufficientEvidence('q', 'c')).toBe(false);
    });
    it('returns false when both pass', async () => {
      process.env.ENABLE_SELF_CORRECT = 'true';
      cf.checkFaithfulness.mockResolvedValueOnce(0.9);
      cf.checkAnswerability.mockResolvedValueOnce(0.8);
      expect(await shouldRegenerate('q', 'a', 'c')).toBe(false);
    });
  });
});
