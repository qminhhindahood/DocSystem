/**
 * Query Rewriter for Retrieval (Task A)
 *
 * Expands/rewrites a retrieval query to improve vector recall for terse
 * Vietnamese legal prompts. Two-tier, offline-first design:
 *   1. Cheap deterministic synonym expansion (zero LLM cost).
 *   2. Optional LLM rewrite for deeper semantics; falls back to (1) on any error.
 *
 * Env-gated via ENABLE_QUERY_REWRITER. When OFF, rewriteQuery() is a pass-through
 * so eval and raw callers are unaffected. Reused by both the orchestrator
 * (ResearcherAgent) and the /api/qa/ask route.
 */

import { getLLMConfig, callLLM } from './llm_config_service';
import { withRetry } from '../utils/retry';

export const ENABLE_REWRITER = () => process.env.ENABLE_QUERY_REWRITER === 'true';

/**
 * Vietnamese legal synonym map. Keyed by a substring that, if present in the
 * query, triggers appending its synonyms. Kept small + deterministic — extend
 * as corpus analysis shows recall gaps.
 */
const LEGAL_SYNONYMS: Record<string, string[]> = {
  'ban hành': ['công bố', 'phê duyệt', 'ra quyết định'],
  'quy trình': ['thủ tục', 'trình tự', 'cách thức'],
  'văn bản': ['công văn', 'quyết định', 'thông tư', 'chỉ thị'],
  'hiệu lực': ['có hiệu lực', 'thi hành', 'thời hạn áp dụng'],
  'ký ban hành': ['ký và ban hành', 'thẩm quyền ký'],
  'thể thức': ['hình thức', 'cấu trúc văn bản'],
  'nơi nhận': ['nơi nhận văn bản', 'đơn vị nhận'],
  'căn cứ': ['cơ sở pháp lý', 'nguyên tắc'],
  'chữ ký': ['ký tên', 'đóng dấu ký'],
};

/**
 * Deterministic offline expansion. Pure function — safe to unit test.
 */
export function expandSynonyms(query: string): string {
  if (!query) return query;
  const lower = query.toLowerCase();
  let out = query;
  for (const [key, syns] of Object.entries(LEGAL_SYNONYMS)) {
    if (lower.includes(key)) {
      out += ' ' + syns.join(' ');
    }
  }
  return out.trim();
}

/**
 * Always broadens a query via deterministic synonym expansion, regardless of
 * ENABLE_QUERY_REWRITER. When the LLM rewriter is enabled, the expanded query
 * is also passed through rewriteQuery for optional LLM-based improvement, but
 * the deterministic expansion is never skipped.
 *
 * This guarantees that weak-evidence retries in self_correct use a different
 * (broader) search query even when the LLM rewriter is disabled.
 */
export async function broadenQuery(query: string, userId?: string): Promise<string> {
  const expanded = expandSynonyms(query).trim();
  if (!ENABLE_REWRITER()) {
    // Always broaden: if no synonyms matched, append a general legal fallback
    // so the retry query differs from the original.
    return expanded === query.trim()
      ? `${query.trim()} quy định hướng dẫn liên quan`
      : expanded;
  }
  const rewritten = (await rewriteQuery(expanded, userId)).trim();
  return rewritten && rewritten !== query.trim() ? rewritten : expanded;
}

/**
 * Rewrite a query for vector retrieval.
 * - If disabled, returns the original query unchanged.
 * - Otherwise expands offline, then asks the LLM to produce a tighter rewrite,
 *   falling back to the offline expansion on any failure (network/parse).
 */
export async function rewriteQuery(query: string, userId?: string): Promise<string> {
  if (!ENABLE_REWRITER()) return query;
  const expanded = expandSynonyms(query);
  try {
    const cfg = await getLLMConfig(userId);
    const raw = await withRetry(
      () =>
        callLLM(
          cfg,
          [
            {
              role: 'system',
              content:
                'Bạn là bộ viết lại truy vấn pháp lý tiếng Việt để tối ưu tìm kiếm vector. Chỉ trả về truy vấn đã viết lại, không giải thích, không đề mục.',
            },
            { role: 'user', content: expanded },
          ],
          { temperature: 0.1, max_tokens: 256 },
        ),
      { maxRetries: 1, baseDelay: 500, retryContext: 'query-rewriter' },
    );
    return raw && raw.trim() ? raw.trim() : expanded;
  } catch {
    // Safe fallback: offline expansion still improves recall vs. raw query.
    return expanded;
  }
}

/**
 * Return complementary retrieval queries rather than replacing the user's
 * original wording. Exact legal identifiers must remain searchable even when
 * an LLM produces a broader semantic rewrite.
 */
export async function buildQueryVariants(query: string, userId?: string): Promise<string[]> {
  const original = query.trim();
  if (!original) return [];
  if (!ENABLE_REWRITER()) return [original];

  const expanded = expandSynonyms(original);
  const rewritten = await rewriteQuery(original, userId);
  const maxVariants = Math.max(1, Math.min(Number(process.env.RAG_MAX_QUERY_VARIANTS) || 3, 5));
  const variants: string[] = [];

  for (const candidate of [original, expanded, rewritten]) {
    const normalized = candidate.replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length > 1000) continue;
    if (!variants.some((existing) => existing.toLocaleLowerCase('vi-VN') === normalized.toLocaleLowerCase('vi-VN'))) {
      variants.push(normalized);
    }
    if (variants.length >= maxVariants) break;
  }

  return variants;
}
