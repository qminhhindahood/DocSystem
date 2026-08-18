import { emitRetrievalMetric } from './retrieval_observability';

describe('retrieval observability', () => {
  const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);

  beforeEach(() => {
    info.mockClear();
    process.env.RAG_OBSERVABILITY = 'false';
  });

  afterAll(() => info.mockRestore());

  it('does not log query or document content and is opt-in', () => {
    emitRetrievalMetric({ durationMs: 12, variantCount: 2, candidateCount: 12, selectedCount: 5 });
    expect(info).not.toHaveBeenCalled();

    process.env.RAG_OBSERVABILITY = 'true';
    emitRetrievalMetric({ durationMs: 12, variantCount: 2, candidateCount: 12, selectedCount: 5 });
    expect(info).toHaveBeenCalledWith('[rag.retrieval]', expect.stringContaining('"candidateCount":12'));
  });
});
