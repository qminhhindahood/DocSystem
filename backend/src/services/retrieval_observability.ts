export interface RetrievalMetric {
  durationMs: number;
  variantCount: number;
  candidateCount: number;
  selectedCount: number;
  retried?: boolean;
}

/** Emits aggregate-only retrieval telemetry; never query text or source content. */
export function emitRetrievalMetric(metric: RetrievalMetric): void {
  if (process.env.RAG_OBSERVABILITY !== 'true') return;
  console.info('[rag.retrieval]', JSON.stringify({
    event: 'retrieval_complete',
    ...metric,
  }));
}
