import { fuseRankedResults, selectDiverseResults, selectEvidenceWithSummaries } from './retrieval_pipeline';

describe('retrieval pipeline', () => {
  const chunks = {
    a: { id: 'a', documentId: 'doc-1', content: 'A', level: 1 },
    b: { id: 'b', documentId: 'doc-2', content: 'B', level: 1 },
    c: { id: 'c', documentId: 'doc-3', content: 'C', level: 1 },
  };

  it('keeps lexical-only candidates when fusing ranked retrieval lists', () => {
    const fused = fuseRankedResults([
      [chunks.a, chunks.b],
      [chunks.c, chunks.b],
    ]);

    expect(fused.map((chunk) => chunk.id)).toEqual(['b', 'a', 'c']);
  });

  it('deduplicates results and limits repeated documents without dropping the best result', () => {
    const results = [
      { ...chunks.a, retrievalScore: 0.9 },
      { ...chunks.a, id: 'a-2', retrievalScore: 0.8 },
      { ...chunks.b, retrievalScore: 0.7 },
      { ...chunks.c, retrievalScore: 0.6 },
    ];

    expect(selectDiverseResults(results, { limit: 3, maxPerDocument: 1 }).map((chunk) => chunk.id))
      .toEqual(['a', 'b', 'c']);
  });

  it('keeps summaries outside the evidence-result budget', () => {
    const results = [
      { id: 'summary', documentId: 'doc-1', content: 'summary', level: 0, isSummary: true },
      { ...chunks.a, retrievalScore: 0.9 },
      { ...chunks.b, retrievalScore: 0.8 },
    ];

    expect(selectEvidenceWithSummaries(results, { evidenceLimit: 2 }).map((chunk) => chunk.id))
      .toEqual(['summary', 'a', 'b']);
  });
});
