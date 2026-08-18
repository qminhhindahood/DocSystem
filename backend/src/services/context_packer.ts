import { selectDiverseResults, type RetrievalResult } from './retrieval_pipeline';

export interface ContextChunk extends RetrievalResult {
  isSummary?: boolean;
  article?: string;
  clause?: string;
  point?: string;
  docTitle?: string;
  pageNumber?: number | null;
  issuingAuthority?: string | null;
  effectiveFrom?: Date | string | null;
  effectiveTo?: Date | string | null;
  repealedAt?: Date | string | null;
  sourceVersion?: string | null;
}

export interface PackedContext {
  context: string;
  summaryText: string;
  chunks: ContextChunk[];
  truncated: boolean;
  estimatedTokens: number;
}

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

function formatDate(value?: Date | string | null): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function provenanceLabel(chunk: ContextChunk): string | undefined {
  const parts = [
    chunk.issuingAuthority ? `cơ quan: ${chunk.issuingAuthority}` : undefined,
    chunk.sourceVersion ? `phiên bản: ${chunk.sourceVersion}` : undefined,
    formatDate(chunk.effectiveFrom) ? `hiệu lực từ: ${formatDate(chunk.effectiveFrom)}` : undefined,
    formatDate(chunk.effectiveTo) ? `đến: ${formatDate(chunk.effectiveTo)}` : undefined,
    formatDate(chunk.repealedAt) ? `bãi bỏ: ${formatDate(chunk.repealedAt)}` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join('; ') : undefined;
}

const SUMMARY_WRAPPER = (title?: string) => `[Tóm tắt${title ? `: ${title}` : ''}]\n`;
const EVIDENCE_WRAPPER = (idx: number, chunk: ContextChunk): string => {
  const location = [chunk.article, chunk.clause, chunk.point, chunk.pageNumber ? `trang ${chunk.pageNumber}` : undefined]
    .filter(Boolean)
    .join(' · ');
  const provenance = provenanceLabel(chunk);
  return `[Nguồn ${idx + 1}${chunk.docTitle ? `: ${chunk.docTitle}` : ''}${location ? ` — ${location}` : ''}${provenance ? ` (${provenance})` : ''}]\n`;
};
const SEPARATOR = '\n\n---\n\n';

function buildSummaryBlock(chunk: ContextChunk): string {
  return `${SUMMARY_WRAPPER(chunk.docTitle)}${chunk.content}`;
}

function buildEvidenceBlock(chunk: ContextChunk, index: number): string {
  return `${EVIDENCE_WRAPPER(index, chunk)}${chunk.content}`;
}

/**
 * Packs retrieval evidence by budgeting the *complete rendered* content
 * — wrappers, separators, and inner text — not just the raw chunk content.
 * Retrieved documents are untrusted data, never instructions for the model.
 */
export function packRetrievalContext(
  chunks: ContextChunk[],
  options: { maxChars: number; maxPerDocument?: number; maxChunks?: number } = { maxChars: 8000 },
): PackedContext {
  const summaries = chunks.filter((chunk) => chunk.isSummary || chunk.level === 0);
  const evidence = selectDiverseResults(
    chunks.filter((chunk) => !chunk.isSummary && chunk.level !== 0),
    { limit: options.maxChunks ?? chunks.length, maxPerDocument: options.maxPerDocument ?? 2 },
  ) as ContextChunk[];

  const XML_OPEN = '<untrusted_retrieved_context>\n';
  const XML_CLOSE = '\n</untrusted_retrieved_context>';

  // If maxChars is shorter than the XML wrapper, return empty
  if (options.maxChars < XML_OPEN.length + XML_CLOSE.length) {
    return {
      context: '',
      summaryText: '',
      chunks: [],
      truncated: true,
      estimatedTokens: 0,
    };
  }

  let remaining = options.maxChars - XML_OPEN.length - XML_CLOSE.length;
  const selectedSummaryBlocks: string[] = [];
  let omittedSummaries = summaries.length > 2;
  for (const summary of summaries.slice(0, 2)) {
    const block = buildSummaryBlock(summary);
    const cost = (selectedSummaryBlocks.length > 0 ? SEPARATOR.length : 0) + block.length;
    if (cost > remaining) { omittedSummaries = true; continue; }
    selectedSummaryBlocks.push(block);
    remaining -= cost;
  }
  const summaryText = selectedSummaryBlocks.join(SEPARATOR);
  const selected: ContextChunk[] = [];

  for (const chunk of evidence) {
    const block = buildEvidenceBlock(chunk, selected.length);
    const hasPriorBlock = selectedSummaryBlocks.length > 0 || selected.length > 0;
    const blockCost = (hasPriorBlock ? SEPARATOR.length : 0) + block.length;

    if (blockCost > remaining) continue;

    selected.push(chunk);
    remaining -= blockCost;
  }

  const evidenceText = selected
    .map((chunk, i) => buildEvidenceBlock(chunk, i))
    .join(SEPARATOR);

  const body = [summaryText, evidenceText].filter(Boolean).join(SEPARATOR);
  const context = body
    ? `${XML_OPEN}${body}${XML_CLOSE}`
    : '';

  return {
    context,
    summaryText,
    chunks: selected,
    truncated: omittedSummaries || selected.length < evidence.length,
    estimatedTokens: estimateTokens(context),
  };
}

/**
 * Selects the first K evidence chunks for evaluation metrics, excluding summary rows.
 * Ensures metrics like Recall@K and MRR operate on actual evidence, not summaries.
 */
export function selectEvaluationEvidence(
  chunks: ContextChunk[],
  topK: number,
): ContextChunk[] {
  return chunks
    .filter((chunk) => !chunk.isSummary && chunk.level !== 0)
    .slice(0, topK);
}
