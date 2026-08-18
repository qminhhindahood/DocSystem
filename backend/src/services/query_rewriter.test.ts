import { buildQueryVariants, expandSynonyms, rewriteQuery } from './query_rewriter';

// Mock the LLM layer so the test never hits a live model.
jest.mock('./llm_config_service', () => ({
  getLLMConfig: jest.fn().mockResolvedValue({ baseUrl: 'http://x', model: 'm' }),
  callLLM: jest.fn().mockResolvedValue('ban hành quyết định công bố phê duyệt'),
}));

describe('query_rewriter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default OFF so rewriteQuery is a pass-through unless we flip it.
    process.env.ENABLE_QUERY_REWRITER = 'false';
  });

  describe('expandSynonyms (offline)', () => {
    it('adds legal synonyms when a key is present', () => {
      const out = expandSynonyms('ban hành quyết định');
      expect(out).toContain('ban hành');
      expect(out.length).toBeGreaterThan('ban hành quyết định'.length);
    });

    it('does not alter a query with no known keys', () => {
      const q = 'quốc hiệu tiêu ngữ';
      expect(expandSynonyms(q)).toBe(q);
    });

    it('handles empty input', () => {
      expect(expandSynonyms('')).toBe('');
    });
  });

  describe('rewriteQuery', () => {
    it('passes through unchanged when disabled', async () => {
      const cfg = require('./llm_config_service');
      const q = 'ban hành quyết định';
      const out = await rewriteQuery(q, undefined);
      expect(out).toBe(q);
      expect(cfg.callLLM).not.toHaveBeenCalled();
    });

    it('uses LLM rewrite when enabled and falls back to expansion on error', async () => {
      process.env.ENABLE_QUERY_REWRITER = 'true';
      const cfg = require('./llm_config_service');

      // First call: LLM succeeds
      let out = await rewriteQuery('ban hành quyết định', undefined);
      expect(cfg.callLLM).toHaveBeenCalledTimes(1);
      expect(out).toBe('ban hành quyết định công bố phê duyệt');

      // Second call: LLM throws -> graceful fallback to offline expansion
      cfg.callLLM.mockRejectedValueOnce(new Error('llm down'));
      out = await rewriteQuery('ban hành quyết định', undefined);
      expect(out).toContain('ban hành');
      expect(out).not.toBe('ban hành quyết định'); // expanded, not raw
    });
  });

  it('preserves the original legal identifier while adding distinct retrieval variants', async () => {
    process.env.ENABLE_QUERY_REWRITER = 'true';
    const variants = await buildQueryVariants('Nghị định 30/2020/NĐ-CP ban hành quyết định');

    expect(variants[0]).toBe('Nghị định 30/2020/NĐ-CP ban hành quyết định');
    expect(variants).toContain('ban hành quyết định công bố phê duyệt');
    expect(new Set(variants).size).toBe(variants.length);
  });
});
