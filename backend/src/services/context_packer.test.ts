import { packRetrievalContext, selectEvaluationEvidence } from './context_packer';
import type { ContextChunk } from './context_packer';

describe('packRetrievalContext', () => {
  const baseChunk = (overrides: Partial<ContextChunk> = {}): ContextChunk => ({
    id: 'chunk',
    documentId: 'd1',
    level: 1,
    content: 'Nội dung chứng cứ.',
    ...overrides,
  });

  it('keeps a document summary separate from evidence and preserves whole chunks within budget', () => {
    const packed = packRetrievalContext([
      baseChunk({ id: 'summary', level: 0, isSummary: true, content: 'Tóm tắt tài liệu.' }),
      baseChunk({ id: 'evidence-1', content: 'Điều 1. Nội dung chứng cứ quan trọng.' }),
      baseChunk({ id: 'duplicate', content: 'Điều 1. Nội dung chứng cứ quan trọng.' }),
      baseChunk({ id: 'evidence-2', documentId: 'd2', content: 'Điều 2. Chứng cứ thứ hai.' }),
    ], { maxChars: 360, maxPerDocument: 1 });

    expect(packed.summaryText).toContain('Tóm tắt tài liệu');
    expect(packed.chunks.map((c) => c.id)).toEqual(['evidence-1', 'evidence-2']);
    expect(packed.context).toContain('<untrusted_retrieved_context>');
    expect(packed.context).not.toContain('duplicate');
  });

  it('does not split an evidence chunk to satisfy a character budget', () => {
    const packed = packRetrievalContext([
      baseChunk({ id: 'too-large', content: 'x'.repeat(100) }),
      baseChunk({ id: 'fits', documentId: 'd2', content: 'short evidence' }),
    ], { maxChars: 120 });

    expect(packed.chunks.map((c) => c.id)).toEqual(['fits']);
    expect(packed.truncated).toBe(true);
  });

  it('includes legal provenance in the evidence label', () => {
    const packed = packRetrievalContext([{
      id: 'legal', documentId: 'd1', level: 1, content: 'Nội dung pháp lý.',
      docTitle: 'Nghị định mẫu', pageNumber: 3, issuingAuthority: 'Chính phủ',
      sourceVersion: '2026.1', effectiveFrom: '2026-01-01',
    }], { maxChars: 300 });

    expect(packed.context).toContain('trang 3');
    expect(packed.context).toContain('cơ quan: Chính phủ');
    expect(packed.context).toContain('phiên bản: 2026.1');
    expect(packed.context).toContain('hiệu lực từ: 2026-01-01');
  });

  it.each([1, 10, 64, 128, 8000])('never exceeds maxChars=%i', (maxChars) => {
    // For small budgets use no summary and tiny content
    const tinyContent = maxChars < 100 ? 'a' : 'nội dung. x'.repeat(10);
    const packed = packRetrievalContext([
      baseChunk({ id: 'e1', content: tinyContent }),
      baseChunk({ id: 'e2', documentId: 'd2', content: tinyContent }),
    ], { maxChars, maxPerDocument: 2 });

    expect(packed.context.length).toBeLessThanOrEqual(maxChars);
  });

  it('returns empty context when maxChars is too small for XML wrappers', () => {
    const packed = packRetrievalContext([
      baseChunk({ id: 'e1', content: 'abc' }),
    ], { maxChars: 5 });

    expect(packed.context).toBe('');
    expect(packed.truncated).toBe(true);
  });

  it('tracks truncated correctly when evidence is omitted', () => {
    const packed = packRetrievalContext([
      baseChunk({ id: 'kept', content: 'fits' }),
      baseChunk({ id: 'dropped', documentId: 'd2', content: 'x'.repeat(999) }),
    ], { maxChars: 200 });

    expect(packed.chunks.map((c) => c.id)).toEqual(['kept']);
    expect(packed.truncated).toBe(true);
  });

  it('includes summary when evidence is empty', () => {
    const packed = packRetrievalContext([
      baseChunk({ id: 's1', level: 0, isSummary: true, content: 'Tóm tắt.' }),
    ], { maxChars: 200 });

    expect(packed.summaryText).toContain('Tóm tắt.');
    expect(packed.chunks).toEqual([]);
    expect(packed.context).toContain('Tóm tắt.');
  });

  it('budgets the complete rendered block including wrapper and separator', () => {
    // With maxChars barely enough for one block but not separator + second block
    // Block for e1: "[Nguồn 1]\n" (10) + "aaa..." (5) = 15. XML wrapper = 47.
    // Summary none, so separator not needed. Total: 15+47 = 62 ≤ 80 ✓
    const packed = packRetrievalContext([
      baseChunk({ id: 'e1', content: 'a'.repeat(5) }),
      baseChunk({ id: 'e2', documentId: 'd2', content: 'b'.repeat(5) }),
    ], { maxChars: 80 });

    expect(packed.chunks.length).toBeGreaterThanOrEqual(1);
    expect(packed.context.length).toBeLessThanOrEqual(80);
  });

  it('never emits an oversized summary beyond the complete rendered budget', () => {
    const packed = packRetrievalContext([
      baseChunk({ id: 'summary', level: 0, isSummary: true, content: 's'.repeat(500) }),
      baseChunk({ id: 'evidence', content: 'usable evidence' }),
    ], { maxChars: 120 });

    expect(packed.context.length).toBeLessThanOrEqual(120);
    expect(packed.summaryText).toBe('');
    expect(packed.chunks.map(chunk => chunk.id)).toEqual(['evidence']);
    expect(packed.truncated).toBe(true);
  });
});

describe('selectEvaluationEvidence', () => {
  const summary = (id: string): ContextChunk => ({
    id, documentId: 'd1', level: 0, isSummary: true, content: 'Tóm tắt.',
  });
  const evidence = (id: string): ContextChunk => ({
    id, documentId: 'd1', level: 1, content: 'Nội dung.',
  });

  it('takes the first K evidence chunks, never summary rows', () => {
    const result = selectEvaluationEvidence(
      [summary('s1'), evidence('e1'), summary('s2'), evidence('e2')],
      2,
    );
    expect(result.map((c) => c.id)).toEqual(['e1', 'e2']);
  });

  it('returns fewer than K when there are not enough evidence chunks', () => {
    const result = selectEvaluationEvidence([summary('s1')], 5);
    expect(result).toEqual([]);
  });

  it('returns at most topK chunks', () => {
    const result = selectEvaluationEvidence(
      [evidence('e1'), evidence('e2'), evidence('e3')],
      2,
    );
    expect(result.map((c) => c.id)).toEqual(['e1', 'e2']);
  });

  it('filters chunks with level === 0 even without isSummary flag', () => {
    const result = selectEvaluationEvidence(
      [{ id: 'l0', documentId: 'd1', level: 0, content: 'level0' },
       evidence('e1')],
      5,
    );
    expect(result.map((c) => c.id)).toEqual(['e1']);
  });
});
