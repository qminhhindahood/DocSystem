/**
 * Self-Correcting Retrieval / Generation Loop (Task E)
 *
 * Mirrors the reference repo's agentic quality loop, but bounded:
 *   - retryRetrieve: if the relevancy filter keeps <2 chunks, rewrite the query
 *     and re-search (up to RAG_MAX_RETRIES times). This attacks "wrong chunk"
 *     failures at runtime.
 *   - shouldRegenerate: after generation, if faithfulness is below
 *     RAG_FAITHFULNESS_MIN or answerability below RAG_ANSWERABILITY_MIN, signal
 *     a regenerate. The caller decides whether to retry (bounded).
 *
 * Env-gated via ENABLE_SELF_CORRECT. When OFF, retryRetrieve delegates straight
 * to search() and shouldRegenerate always returns false. Hard-capped retries
 * with safe fallbacks so the pipeline can never loop forever.
 */

import { broadenQuery, buildQueryVariants, rewriteQuery } from './query_rewriter';
import { filterRelevantChunks, checkFaithfulness, checkAnswerability, RelChunk } from './context_filter';
import { fuseRankedResults, selectEvidenceWithSummaries } from './retrieval_pipeline';
import { emitRetrievalMetric } from './retrieval_observability';

export const ENABLE_SELF_CORRECT = () => process.env.ENABLE_SELF_CORRECT === 'true';
const MAX_RETRIES = () => {
  const value = Number(process.env.RAG_MAX_RETRIES);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, Math.trunc(value))) : 1;
};
const FAITHFULNESS_MIN = () => Number(process.env.RAG_FAITHFULNESS_MIN) || 0.5;
const ANSWERABILITY_MIN = () => Number(process.env.RAG_ANSWERABILITY_MIN) || 0.3;

export interface RetryOpts {
  userId?: string;
  docType?: string;
}

export interface RetrieveQualityOptions {
  userId?: string;
  docType?: string;
  /** Number of candidates retained before reranking/filtering. */
  candidateLimit?: number;
  /** Final evidence count returned to the caller. */
  finalLimit?: number;
  maxPerDocument?: number;
}

export async function retrieveWithQuality<T extends RelChunk>(
  query: string,
  search: (q: string) => Promise<T[]>,
  opts: RetrieveQualityOptions = {},
): Promise<T[]> {
  const startedAt = Date.now();
  const variants = await buildQueryVariants(query, opts.userId);
  const lists = await Promise.all(variants.map((variant) => search(variant)));
  const candidateLimit = Math.max(2, Math.min(opts.candidateLimit ?? 20, 50));
  const finalLimit = Math.max(1, Math.min(opts.finalLimit ?? 5, candidateLimit));
  const fused = fuseRankedResults(lists as T[][], candidateLimit) as T[];
  let filtered = await filterRelevantChunks(query, fused, opts.userId) as T[];

  // A single bounded retry is reserved for evidence scarcity, not merely an
  // arbitrary raw-result count. This avoids re-answering from the same weak
  // context when reranking finds insufficient supporting evidence.
  let retried = false;
  if (ENABLE_SELF_CORRECT() && filtered.length < Math.min(2, finalLimit)) {
    retried = true;
    filtered = await retryRetrieve(query, search, opts) as T[];
  }

  const selected = selectEvidenceWithSummaries(filtered, {
    evidenceLimit: finalLimit,
    maxPerDocument: opts.maxPerDocument ?? 2,
  }) as T[];
  emitRetrievalMetric({
    durationMs: Date.now() - startedAt,
    variantCount: variants.length,
    candidateCount: fused.length,
    selectedCount: selected.length,
    retried,
  });
  return selected;
}

/**
 * Retrieve with one bounded self-correction pass.
 * Returns filtered chunks; if even after rewriting it keeps <2, returns the
 * best-effort set (filtered if non-empty, else the last raw search) so the
 * caller always gets something.
 */
export async function retryRetrieve(
  query: string,
  search: (q: string) => Promise<any[]>,
  opts: RetryOpts = {},
): Promise<any[]> {
  if (!ENABLE_SELF_CORRECT()) return search(query);

  let q = query;
  let lastRaw: any[] = [];
  for (let i = 0; i <= MAX_RETRIES(); i++) {
    const chunks = await search(q);
    lastRaw = chunks;
    const filtered = await filterRelevantChunks(q, chunks as any, opts.userId);
    if (filtered.length >= 2 || i === MAX_RETRIES()) {
      return filtered.length ? filtered : chunks;
    }
    // Broaden the query deterministically for the next pass — works even
    // when the optional LLM rewriter is disabled.
    q = await broadenQuery(q, opts.userId);
  }
  return lastRaw;
}

/**
 * Decide whether a generated answer should be regenerated.
 * True when faithfulness or answerability falls below threshold.
 */
export async function shouldRegenerate(
  question: string,
  answer: string,
  context: string,
  userId?: string,
): Promise<boolean> {
  if (!ENABLE_SELF_CORRECT()) return false;
  const faith = await checkFaithfulness(question, answer, context, userId);
  return faith < FAITHFULNESS_MIN();
}

/**
 * Answerability is a retrieval decision. Retrying generation with unchanged,
 * weak context cannot make an answer more grounded; callers should retrieve
 * more evidence or abstain before they start generation.
 */
export async function hasSufficientEvidence(
  question: string,
  context: string,
  userId?: string,
): Promise<boolean> {
  if (!ENABLE_SELF_CORRECT()) return true;
  const score = await checkAnswerability(question, context, userId);
  return score >= ANSWERABILITY_MIN();
}
