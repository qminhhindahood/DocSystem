export interface RetrievalResult {
  id: string;
  documentId?: string;
  content: string;
  level: number;
  retrievalScore?: number;
  isSummary?: boolean;
}

/** Keep global document context, but do not make it displace ranked evidence. */
export function selectEvidenceWithSummaries<T extends RetrievalResult>(
  results: T[],
  options: { evidenceLimit: number; maxPerDocument?: number; maxSummaries?: number } = { evidenceLimit: 5 },
): T[] {
  const summaries = results
    .filter((result) => result.isSummary || result.level === 0)
    .slice(0, options.maxSummaries ?? 2);
  const evidence = selectDiverseResults(
    results.filter((result) => !result.isSummary && result.level !== 0),
    { limit: options.evidenceLimit, maxPerDocument: options.maxPerDocument ?? 2 },
  );
  return [...summaries, ...evidence];
}

const RRF_K = 60;

/**
 * Fuse ranked lists from independent retrieval routes or query variants.
 * Rank fusion intentionally preserves candidates that occur in only one list.
 */
export function fuseRankedResults<T extends RetrievalResult>(lists: T[][], limit = 50): T[] {
  const byId = new Map<string, { item: T; score: number; firstSeen: number }>();
  let seen = 0;

  for (const list of lists) {
    list.forEach((item, index) => {
      const current = byId.get(item.id);
      const score = 1 / (RRF_K + index + 1);
      if (current) {
        current.score += score;
      } else {
        byId.set(item.id, { item, score, firstSeen: seen++ });
      }
    });
  }

  return [...byId.values()]
    .sort((a, b) => b.score - a.score || a.firstSeen - b.firstSeen)
    .slice(0, Math.max(1, limit))
    .map(({ item, score }) => ({ ...item, retrievalScore: score }));
}

export function selectDiverseResults<T extends RetrievalResult>(
  results: T[],
  options: { limit: number; maxPerDocument?: number },
): T[] {
  const maxPerDocument = Math.max(1, options.maxPerDocument ?? 2);
  const documentCounts = new Map<string, number>();
  const contentKeys = new Set<string>();
  const selected: T[] = [];

  for (const result of results) {
    const normalizedContent = result.content.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normalizedContent || contentKeys.has(normalizedContent)) continue;
    const documentKey = result.documentId || result.id;
    const count = documentCounts.get(documentKey) ?? 0;
    if (count >= maxPerDocument) continue;

    selected.push(result);
    contentKeys.add(normalizedContent);
    documentCounts.set(documentKey, count + 1);
    if (selected.length >= Math.max(1, options.limit)) break;
  }

  return selected;
}
