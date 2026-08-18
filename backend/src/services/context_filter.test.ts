import {
  filterRelevantChunks,
  checkFaithfulness,
  checkAnswerability,
  checkAnswerRelevancy,
} from './context_filter';

jest.mock('./llm_config_service', () => ({
  getLLMConfig: jest.fn().mockResolvedValue({ baseUrl: 'http://x', model: 'm' }),
  callLLM: jest.fn(),
}));

const cfg = require('./llm_config_service');

describe('context_filter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENABLE_RERANK_FILTER = 'false';
  });

  describe('filterRelevantChunks', () => {
    const chunks = [
      { id: '1', content: 'Điều 5 về thể thức văn bản', level: 1 },
      { id: '2', content: 'công thức nấu phở', level: 1 },
      { id: '3', content: 'quốc hiệu tiêu ngữ', level: 1 },
      { id: '4', content: 'cách đánh số hiệu', level: 1 },
    ];

    it('passes through when disabled', async () => {
      const out = await filterRelevantChunks('thể thức văn bản hành chính', chunks);
      expect(out).toHaveLength(4);
      expect(cfg.callLLM).not.toHaveBeenCalled();
    });

    it('reranks a small candidate set when enabled instead of bypassing quality control', async () => {
      process.env.ENABLE_RERANK_FILTER = 'true';
      cfg.callLLM.mockResolvedValueOnce(JSON.stringify({ keep: ['2', '1'] }));
      const few = chunks.slice(0, 2);
      const out = await filterRelevantChunks('thể thức', few);
      expect(out.map((chunk: any) => chunk.id)).toEqual(['2', '1']);
    });

    it('drops low-relevance chunks when enabled', async () => {
      process.env.ENABLE_RERANK_FILTER = 'true';
      cfg.callLLM.mockResolvedValueOnce(JSON.stringify({ keep: ['4', '3', '1'] }));
      const out = await filterRelevantChunks('thể thức văn bản hành chính', chunks);
      expect(out.find((c: any) => c.id === '2')).toBeUndefined();
      expect(out.map((c: any) => c.id)).toEqual(['4', '3', '1']);
    });

    it('falls back to keeping all if LLM errors', async () => {
      process.env.ENABLE_RERANK_FILTER = 'true';
      cfg.callLLM.mockRejectedValueOnce(new Error('down'));
      const out = await filterRelevantChunks('thể thức', chunks);
      expect(out).toHaveLength(4);
    });
  });

  describe('checkFaithfulness', () => {
    it('returns parsed score', async () => {
      cfg.callLLM.mockResolvedValueOnce('{"score":0.9}');
      const s = await checkFaithfulness('q', 'a', 'c');
      expect(s).toBeCloseTo(0.9);
    });
    it('returns 0 on error', async () => {
      cfg.callLLM.mockRejectedValueOnce(new Error('down'));
      expect(await checkFaithfulness('q', 'a', 'c')).toBe(0);
    });
  });

  describe('checkAnswerability', () => {
    it('returns parsed score', async () => {
      cfg.callLLM.mockResolvedValueOnce('{"score":0.4}');
      expect(await checkAnswerability('q', 'c')).toBeCloseTo(0.4);
    });
    it('returns 0 on error', async () => {
      cfg.callLLM.mockRejectedValueOnce(new Error('down'));
      expect(await checkAnswerability('q', 'c')).toBe(0);
    });
  });

  it('clamps malformed and out-of-range judge scores', async () => {
    cfg.callLLM.mockResolvedValueOnce('{"score":2}');
    expect(await checkFaithfulness('q', 'a', 'c')).toBe(1);
    cfg.callLLM.mockResolvedValueOnce('{"score":-1}');
    expect(await checkAnswerability('q', 'c')).toBe(0);
  });

  it('checks answer relevancy from question and answer', async () => {
    cfg.callLLM.mockResolvedValueOnce('{"score":0.7}');
    await expect(checkAnswerRelevancy('q', 'a')).resolves.toBeCloseTo(0.7);
    expect(cfg.callLLM.mock.calls.at(-1)[1][1].content).toContain('Câu trả lời');
  });
});
