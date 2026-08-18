import crypto from 'crypto';
import axios from 'axios';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { withRetry } from '../utils/retry';
import { embeddingsClient } from '../utils/embeddings_client';
import { doclingBreaker, embeddingsBreaker } from '../utils/circuit_breaker';
import { getLLMConfig, callLLM } from './llm_config_service';
import { PrismaPromise } from '@prisma/client';
import { documentWhere, ragOwnerId, type AccessScope } from '../utils/document_access';
import { getCloudRunAuthorization } from '../utils/cloud_run_auth';
// Node 18+ provides global FormData and Blob — no polyfill needed
const DOCLING_URL = process.env.DOCLING_URL || 'http://localhost:8001';
const DOCLING_TIMEOUT_MS = Number(process.env.DOCLING_TIMEOUT_MS) || 300_000;
const DOCLING_OCR_TIMEOUT_MS = Number(process.env.DOCLING_OCR_TIMEOUT_MS) || 1_800_000;
const SYSTEM_OWNER_ID = '00000000-0000-0000-0000-000000000001';

function ownerFilter(access: AccessScope): Prisma.Sql {
  return access.kind === 'system'
    ? Prisma.empty
    : Prisma.sql`AND d."ownerId" = ${access.userId}`;
}

export function stripVietnameseDiacritics(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

// Task B/H: generate per-document abstract chunks for global-context recall.
export const ENABLE_SUMMARY_CHUNKS = () => process.env.ENABLE_SUMMARY_CHUNKS === 'true';

export interface Chunk {
  id: string;
  documentId: string;
  level: number;
  article?: string;
  clause?: string;
  point?: string;
  content: string;
  isSummary?: boolean;
  summaryOf?: string;
  contentHash?: string;
  pageNumber?: number | null;
  metadata?: unknown;
  issuingAuthority?: string | null;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  repealedAt?: Date | null;
  sourceVersion?: string | null;
  embedding?: any;
  createdAt: Date;
}

/** Parsed hierarchical chunk before DB insertion */
export interface HierarchicalChunk {
  content: string;
  level: number;
  article?: string;
  clause?: string;
  point?: string;
  /** Parent context prepended for semantic completeness */
  parentContext?: string;
}

export interface IndexDocumentSource {
  title?: string;
  originalFilename?: string;
  mimeType?: string;
  fileSize?: number;
}

export class RAGService {
  private readonly queryEmbeddingCache = new Map<string, { value: number[]; expiresAt: number }>();
  // ─── Search ─────────────────────────────────────────────────────────────────

  /**
   * Hybrid search: combines pgvector cosine similarity with PostgreSQL
   * full-text search using Reciprocal Rank Fusion (RRF).
   *
   * @param query - The search query
   * @param topK - Number of results to return (default: 5)
   * @param docType - Filter by document type (optional)
   */
  async search(query: string, topK: number, docType: string | undefined, access: AccessScope): Promise<(Chunk & { parentContent?: string })[]> {
    try {
      if (!access) {
        throw new Error('Document search requires access context');
      }
      const queryEmbedding = await this.getEmbedding(query);

      // Validate embedding
      if (queryEmbedding.length !== 1024) {
        throw new Error(`Invalid embedding dimensions: expected 1024, got ${queryEmbedding.length}`);
      }
      if (!queryEmbedding.every(n => typeof n === 'number' && Number.isFinite(n))) {
        throw new Error('Invalid embedding format: all values must be finite numbers');
      }

      const safeTopK = Math.max(1, Math.min(Math.trunc(topK), 50));
      const queryVector = this.toPgVector(queryEmbedding);
      const accentlessQuery = stripVietnameseDiacritics(query);
      const fullTextQuery = accentlessQuery === query
        ? Prisma.sql`websearch_to_tsquery('simple', ${query})`
        : Prisma.sql`(websearch_to_tsquery('simple', ${query}) || websearch_to_tsquery('simple', ${accentlessQuery}))`;
      const docTypeFilter = docType ? Prisma.sql`AND d."docType" = ${docType}` : Prisma.empty;
      const accessFilter = ownerFilter(access);

      // ── Hybrid search: RRF(vector_rank, fts_rank) ──────────────────────
      // k = 60 is the standard RRF smoothing constant (configurable via env)
      const RRF_K = Number(process.env.RAG_RRF_K) || 60;
      const overFetchMultiplier = Number(process.env.RAG_OVERFETCH_MULTIPLIER) || 4;
      const candidateLimit = Math.max(safeTopK * overFetchMultiplier, 20); // over-fetch for fusion

      const chunks = await prisma.$queryRaw<(Chunk & { docTitle?: string; docTypeName?: string; rrf_score?: number })[]>(Prisma.sql`
        WITH vector_ranked AS (
          SELECT
            c.id,
            c."documentId",
            c.level,
            c.article,
            c.clause,
            c.point,
            c.content,
            c."pageNumber",
            c.metadata,
            c."createdAt",
            d.title AS "docTitle",
            d."docType" AS "docTypeName",
            d."issuingAuthority" AS "issuingAuthority",
            d."effectiveFrom" AS "effectiveFrom",
            d."effectiveTo" AS "effectiveTo",
            d."repealedAt" AS "repealedAt",
            d."sourceVersion" AS "sourceVersion",
            ROW_NUMBER() OVER (ORDER BY c.embedding <=> ${queryVector}::vector) AS vec_rank
          FROM "Chunk" c
          JOIN "Document" d ON d.id = c."documentId"
          WHERE c.embedding IS NOT NULL
          ${docTypeFilter}
          ${accessFilter}
          ORDER BY c.embedding <=> ${queryVector}::vector
          LIMIT ${candidateLimit}
        ),
        fts_ranked AS (
          SELECT
            c.id,
            c."documentId",
            c.level,
            c.article,
            c.clause,
            c.point,
            c.content,
            c."pageNumber",
            c.metadata,
            c."createdAt",
            d.title AS "docTitle",
            d."docType" AS "docTypeName",
            d."issuingAuthority" AS "issuingAuthority",
            d."effectiveFrom" AS "effectiveFrom",
            d."effectiveTo" AS "effectiveTo",
            d."repealedAt" AS "repealedAt",
            d."sourceVersion" AS "sourceVersion",
            ROW_NUMBER() OVER (ORDER BY ts_rank_cd(to_tsvector('simple', c.content), ${fullTextQuery}) DESC) AS fts_rank
          FROM "Chunk" c
          JOIN "Document" d ON d.id = c."documentId"
          WHERE to_tsvector('simple', c.content) @@ ${fullTextQuery}
          ${docTypeFilter}
          ${accessFilter}
          ORDER BY ts_rank_cd(to_tsvector('simple', c.content), ${fullTextQuery}) DESC
          LIMIT ${candidateLimit}
        )
        SELECT
          COALESCE(v.id, f.id) AS id,
          COALESCE(v."documentId", f."documentId") AS "documentId",
          COALESCE(v.level, f.level) AS level,
          COALESCE(v.article, f.article) AS article,
          COALESCE(v.clause, f.clause) AS clause,
          COALESCE(v.point, f.point) AS point,
          COALESCE(v.content, f.content) AS content,
          COALESCE(v."pageNumber", f."pageNumber") AS "pageNumber",
          COALESCE(v.metadata, f.metadata) AS metadata,
          COALESCE(v."createdAt", f."createdAt") AS "createdAt",
          COALESCE(v."docTitle", f."docTitle") AS "docTitle",
          COALESCE(v."docTypeName", f."docTypeName") AS "docTypeName",
          COALESCE(v."issuingAuthority", f."issuingAuthority") AS "issuingAuthority",
          COALESCE(v."effectiveFrom", f."effectiveFrom") AS "effectiveFrom",
          COALESCE(v."effectiveTo", f."effectiveTo") AS "effectiveTo",
          COALESCE(v."repealedAt", f."repealedAt") AS "repealedAt",
          COALESCE(v."sourceVersion", f."sourceVersion") AS "sourceVersion",
          COALESCE(1.0 / (${RRF_K} + v.vec_rank), 0) + COALESCE(1.0 / (${RRF_K} + f.fts_rank), 0) AS rrf_score
        FROM vector_ranked v
        FULL OUTER JOIN fts_ranked f ON v.id = f.id
        ORDER BY rrf_score DESC
        LIMIT ${safeTopK}
      `);

      // ── Parent context expansion ───────────────────────────────────────
      // For Level 2/3 chunks, fetch the parent Article (Level 1) to give
      // the LLM full context about which article this clause belongs to.
      const hasLevel2or3 = chunks.some(c => c.level > 1 && c.article);
const enrichedChunks = hasLevel2or3 ? await this.expandParentContext(chunks, access) : chunks;

      // Task H: always-on global-context prepend. Fetch the level-0 summary
      // chunk of the top-ranked chunk's document (if one exists) and insert it
      // first. This guarantees global grounding even when RRF buries the
      // abstract for narrow queries. No extra LLM call — single indexed lookup.
      const withSummary = await this.prependDocSummary(enrichedChunks, safeTopK, access);

      return withSummary;
    } catch (error) {
      console.error('RAG search error:', error);
      throw error;
    }
  }

  /**
   * Task H: prepend the level-0 summary chunk of the top result's document
   * (if present and not already in the result set). Returns chunks unchanged
   * if no summary exists or lookup fails.
   */
  private async prependDocSummary<T extends (Chunk & { parentContent?: string })>(
    chunks: T[],
    topK: number | undefined,
    access: AccessScope,
  ): Promise<T[]> {
    if (chunks.length === 0 || !ENABLE_SUMMARY_CHUNKS()) return chunks;
    if (!access) throw new Error('Document search requires access context');
    const topDocId = chunks[0].documentId;
    try {
      const summary = await prisma.$queryRaw<T[]>(Prisma.sql`
        SELECT c.id, c."documentId", c.level, c.article, c.clause, c.point, c.content, c."pageNumber", c.metadata, c."createdAt"
        FROM "Chunk" c JOIN "Document" d ON d.id = c."documentId"
        WHERE c."documentId" = ${topDocId} AND c."isSummary" = true AND c.level = 0
          ${ownerFilter(access)}
        LIMIT 1
      `);
      if (summary.length === 0) return chunks;
      const s = summary[0];
      if (chunks.some((c) => c.id === s.id)) return chunks;
      // Summary context is a separate budget from evidence. Do not discard a
      // ranked evidence chunk merely to make room for the summary.
      return [s, ...chunks];
    } catch (err) {
      console.warn('[RAG] prependDocSummary failed, skipping:', err);
      return chunks;
    }
  }

  /**
   * For each Level 2/3 chunk, fetch the parent Article (Level 1 chunk from
   * the same document with the same article label) and attach its content.
   */
  private async expandParentContext<T extends Chunk>(chunks: T[], access: AccessScope): Promise<(T & { parentContent?: string })[]> {
    const needsParent = chunks.filter(c => c.level > 1 && c.article);
    if (needsParent.length === 0) return chunks;
    if (!access) throw new Error('Document search requires access context');

    // Batch: collect unique (documentId, article) pairs
    const parentKeys = new Set<string>();
    for (const c of needsParent) {
      parentKeys.add(`${c.documentId}|||${c.article}`);
    }

    // Fetch exactly ONE parent per (documentId, article) key. DISTINCT ON
    // guarantees one row per key; LIMIT + Map.set had a dedup race where
    // duplicate (documentId, article) rows consumed LIMIT slots, leaving
    // some chunks with parentContent: undefined.
    const conditions = [...parentKeys].map(k => {
      const [docId, article] = k.split('|||');
      return Prisma.sql`("documentId" = ${docId} AND article = ${article} AND level = 1)`;
    });
    const parentChunks = await prisma.$queryRaw<{ documentId: string; article: string; content: string }[]>(
      Prisma.sql`
        SELECT DISTINCT ON (c."documentId", c.article) c."documentId", c.article, c.content
        FROM "Chunk" c JOIN "Document" d ON d.id = c."documentId"
        WHERE (${Prisma.join(conditions, ' OR ')})
          ${ownerFilter(access)}
        ORDER BY c."documentId", c.article, c."createdAt" ASC
      `
    );

    const parentMap = new Map<string, string>();
    for (const p of parentChunks) {
      parentMap.set(`${p.documentId}|||${p.article}`, p.content);
    }

    return chunks.map(c => {
      if (c.level > 1 && c.article) {
        const key = `${c.documentId}|||${c.article}`;
        return { ...c, parentContent: parentMap.get(key) };
      }
      return { ...c, parentContent: undefined };
    });
  }

  // ─── Embedding ──────────────────────────────────────────────────────────────

  /**
   * Get embedding for text using the embeddings service
   */
  private async getEmbedding(text: string): Promise<number[]> {
    const ttlSeconds = Math.max(0, Math.min(Number(process.env.RAG_QUERY_EMBED_CACHE_TTL_SECONDS) || 300, 3600));
    const cacheKey = this.contentHash(text);
    const cached = this.queryEmbeddingCache.get(cacheKey);
    if (ttlSeconds > 0 && cached) {
      if (cached.expiresAt > Date.now()) return cached.value;
      this.queryEmbeddingCache.delete(cacheKey); // evict stale entry
    }

    const embedding = await withRetry(async () => {
      return embeddingsBreaker.execute(() => embeddingsClient.generateEmbedding(text, 'query'));
    }, { maxRetries: 3, baseDelay: 1000 });
    if (ttlSeconds > 0) {
      this.queryEmbeddingCache.set(cacheKey, { value: embedding, expiresAt: Date.now() + ttlSeconds * 1000 });
      // Keep bounded local state even under a high-cardinality query workload.
      if (this.queryEmbeddingCache.size > 500) {
        const oldest = this.queryEmbeddingCache.keys().next().value;
        if (oldest) this.queryEmbeddingCache.delete(oldest);
      }
    }
    return embedding;
  }

  // ─── Indexing ─────────────────────────────────────────────────────────────

  /**
   * Index a document by parsing PDF, chunking, and creating embeddings
   */
  async indexDocument(
    pdfBuffer: Buffer,
    docType: string,
    access: AccessScope,
    source: IndexDocumentSource = {},
  ): Promise<string> {
    try {
      const ownerId = access.kind === 'user' ? access.userId : SYSTEM_OWNER_ID;
      // Parse PDF using Docling service
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }),
        'document.pdf',
      );

      // Fast path: try text extraction without OCR (< 60s for most PDFs)
      let parseResponse = await withRetry(
        () =>
    doclingBreaker.execute(async () =>
      axios.post(`${DOCLING_URL}/parse?do_ocr=false`, formData, {
        timeout: DOCLING_TIMEOUT_MS,
        headers: await getCloudRunAuthorization(DOCLING_URL),
      }),
    ),
        { maxRetries: 1, baseDelay: 1000 },
      );

      let { text } = parseResponse.data;

      // If text is too short for a multi-page PDF, the doc is likely scanned — retry with OCR
      if (text.length < 500) {
        console.log(`[indexDocument] Text-only extracted only ${text.length} chars — retrying with OCR...`);
        parseResponse = await withRetry(
          () =>
      doclingBreaker.execute(async () =>
        axios.post(`${DOCLING_URL}/parse?do_ocr=true`, formData, {
          timeout: DOCLING_OCR_TIMEOUT_MS,
          headers: await getCloudRunAuthorization(DOCLING_URL),
        }),
      ),
          { maxRetries: 1, baseDelay: 2000 },
        );
        text = parseResponse.data.text;
      }

      // Create document record
      const document = await prisma.document.create({
        data: {
          docType,
          title: source.title || `Document ${new Date().toISOString()}`,
          content: text,
          status: 'draft',
          ownerId,
          originalFilename: source.originalFilename,
          mimeType: source.mimeType || 'application/pdf',
          fileSize: source.fileSize ?? pdfBuffer.length,
        },
      });

      // Chunk the document hierarchically
      const hierarchicalChunks = this.chunkDocument(text);
      const docId = document.id;

      // Build chunk data array for batch insert
      const chunkData = hierarchicalChunks.map(c => ({
        documentId: docId,
        content: c.content,
        contentHash: this.contentHash(c.content),
        level: c.level,
        article: c.article,
        clause: c.clause,
        point: c.point,
        metadata: c.parentContext ? { parentContext: c.parentContext } : undefined,
      }));

      // Batch insert all chunks (skipDuplicates for idempotency)
      await prisma.chunk.createMany({
        data: chunkData,
        skipDuplicates: true,
      });

      // Fetch created chunks WITH content so we can match by content hash
      // instead of positional index (m8 fix). The old positional-slice approach
      // silently mis-mapped embeddings when skipDuplicates culled any chunks.
      const createdChunks = await prisma.chunk.findMany({
        where: { documentId: docId },
        select: { id: true, content: true, contentHash: true },
        orderBy: { id: 'asc' },
      });

      // Build a content→id map for matching. Use sha256 as a stable content hash.
      const contentIdMap = new Map<string, string>();
      for (const cc of createdChunks) {
        const key = cc.contentHash || this.contentHash(cc.content);
        if (!contentIdMap.has(key)) {
          contentIdMap.set(key, cc.id);
        }
      }

      // Generate embeddings from hierarchical chunks, then map via content hash.
      const embedTexts: string[] = [];
      const embedKeys: string[] = [];
      for (const hc of hierarchicalChunks) {
        const key = this.contentHash(hc.content);
        const matchedId = contentIdMap.get(key);
        if (matchedId) {
          embedTexts.push(hc.content);
          embedKeys.push(matchedId);
        }
      }

      if (embedTexts.length > 0) {
        const embeddings = await withRetry(
          () => embeddingsBreaker.execute(() => embeddingsClient.generateBatchEmbeddings(embedTexts)),
          { maxRetries: 2, baseDelay: 1000, retryContext: 'batch-embeddings' },
        );
        // M19fix: wrap ALL batch updates in a single $transaction so a mid-loop
        // failure rolls back every prior batch too. The old per-batch $transaction
        // committed each batch independently — a failure at batch N left batches
        // 1..N-1 with embeddings and N..end without, producing a half-indexed doc.
        const BATCH_SIZE = 50;
        const allUpdates: PrismaPromise<any>[] = [];
        for (let b = 0; b < embeddings.length; b += BATCH_SIZE) {
          const batch = embeddings.slice(b, b + BATCH_SIZE);
          const batchKeys = embedKeys.slice(b, b + BATCH_SIZE);
          for (let i = 0; i < batch.length; i++) {
            allUpdates.push(
              prisma.$executeRaw(Prisma.sql`
                UPDATE "Chunk" SET embedding = ${this.toPgVector(batch[i])}::vector WHERE id = ${batchKeys[i]}
              `)
            );
          }
        }
        await prisma.$transaction(allUpdates);
      }
      const skippedCount = hierarchicalChunks.length - embedKeys.length;
      if (skippedCount > 0) {
        console.warn(`[RAG] ${skippedCount} chunks skipped (no content match in DB — likely duplicates)`);
      }

      // Task B/H: create a level-0 summary chunk for global-context recall.
      // Best-effort: skips silently if disabled or generation fails.
      let summaryCreated = false;
      if (ENABLE_SUMMARY_CHUNKS()) {
        const summary = await this.generateSummary(text, docType, ragOwnerId(access));
        if (summary) {
          await this.createSummaryChunk(docId, summary, access);
          summaryCreated = true;
        }
      }

      const chunkCount = createdChunks.length + (summaryCreated ? 1 : 0);
      const embeddedChunkCount = embedKeys.length + (summaryCreated ? 1 : 0);
      await prisma.document.update({
        where: { id: docId },
        data: {
          ingestionStatus: 'indexed',
          processedAt: new Date(),
          chunkCount,
          embeddedChunkCount,
          failedChunkCount: chunkCount - embeddedChunkCount,
        },
      });

      return document.id;
    } catch (error) {
      console.error('Document indexing error:', error);
      throw error;
    }
  }

  /**
   * Parse PDF and store chunks WITHOUT embeddings (avoids OOM on large docs).
   * Use backfill_embeddings.ts to embed afterward.
   */
  async parseOnly(pdfBuffer: Buffer, docType: string, access: AccessScope): Promise<string> {
    const ownerId = access.kind === 'user' ? access.userId : SYSTEM_OWNER_ID;
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }),
      'document.pdf',
    );

    let parseResponse = await withRetry(
      () => doclingBreaker.execute(async () =>
        axios.post(`${DOCLING_URL}/parse?do_ocr=false`, formData, {
          timeout: DOCLING_TIMEOUT_MS,
          headers: await getCloudRunAuthorization(DOCLING_URL),
        })
      ),
      { maxRetries: 1, baseDelay: 1000 },
    );

    let { text } = parseResponse.data;
    if (text.length < 500) {
      console.log(`[parseOnly] Text-only: ${text.length} chars — retrying OCR...`);
      parseResponse = await withRetry(
        () => doclingBreaker.execute(async () =>
          axios.post(`${DOCLING_URL}/parse?do_ocr=true`, formData, {
            timeout: DOCLING_OCR_TIMEOUT_MS,
            headers: await getCloudRunAuthorization(DOCLING_URL),
          })
        ),
        { maxRetries: 1, baseDelay: 2000 },
      );
      text = parseResponse.data.text;
    }

    const document = await prisma.document.create({
      data: { docType, title: `Document ${new Date().toISOString()}`, content: text, status: 'draft', ownerId },
    });

    const hierarchicalChunks = this.chunkDocument(text);
    await prisma.chunk.createMany({
      data: hierarchicalChunks.map(c => ({
        documentId: document.id, content: c.content, level: c.level,
        article: c.article, clause: c.clause, point: c.point,
        contentHash: this.contentHash(c.content),
        metadata: c.parentContext ? { parentContext: c.parentContext } : undefined,
      })),
      skipDuplicates: true,
    });

    console.log(`[parseOnly] ${document.id}: ${hierarchicalChunks.length} chunks stored (no embeddings)`);
    return document.id;
  }

  // ─── Hierarchical Chunker ─────────────────────────────────────────────────

  /**
   * Chunk document text hierarchically (Article -> Clause -> Point).
   *
   * Supports two input formats:
   *   1. **Markdown** (from Docling): splits on `# Điều X` / `## Khoản X` headings
   *   2. **Plain text** (from PyMuPDF): splits on `Điều X.` / `1.` / `a)` patterns
   *
   * Parent context injection: Level 2/3 chunks prepend the parent Article
   * header so the LLM always knows which article a clause belongs to.
   *
   * This method is public so it can be called by the ingestion service and
   * the feedback RAG promotion service — ensuring a single source of truth
   * for chunking logic.
   */
  chunkDocument(text: string): HierarchicalChunk[] {
    if (!text || !text.trim()) {
      return [];
    }

    // H2: normalize CRLF/CR → LF. The chunker relies on ^/$ line anchors
    // (regex `m` flag) and section splits; stray CR/LF leaves carriage returns
    // embedded in chunk content and breaks heading/start-of-line matching.
    const normalized = text.replace(/\r\n?/g, '\n');
    text = normalized;

    // Task B/G: clean OCR/whitespace noise (soft hyphens, mid-word line breaks,
    // repeated spaces) BEFORE chunking so embeddings aren't polluted. The
    // mid-word-break fix is the key OCR win for Vietnamese legal text.
    text = this.cleanCorpusText(text);

    // Detect whether input is Markdown (from Docling) or plain text
    const isMarkdown = /^#{1,3}\s+/m.test(text);

    return isMarkdown
      ? this.chunkMarkdownDocument(text)
      : this.chunkPlainTextDocument(text);
  }

  /**
   * Chunk Markdown-formatted text (output from Docling).
   * Splits on Markdown headings: `# Điều X`, `## Khoản X`, etc.
   */
  private chunkMarkdownDocument(text: string): HierarchicalChunk[] {
    const chunks: HierarchicalChunk[] = [];

    // Split into sections by any heading (# or ## or ###)
    // Keep the heading with its section
    const sections = text.split(/(?=^#{1,3}\s+)/m).filter(s => s.trim());

    let currentArticleHeader = '';
    let currentArticleContent = '';
    let currentClauseHeader = '';

    for (const section of sections) {
      const headingMatch = section.match(/^(#{1,3})\s+(.*)/);
      if (!headingMatch) {
        // Preamble or text before any heading — store as Level 1
        if (section.trim()) {
          chunks.push({ content: section.trim(), level: 1 });
        }
        continue;
      }

      const headingLevel = headingMatch[1].length; // 1, 2, or 3
      const headingText = headingMatch[2].trim();
      const bodyText = section.substring(section.indexOf('\n') + 1).trim();

      // Check if this is an Article heading (Điều)
      const isArticle = /^[Đđ]iều\s+\d+/i.test(headingText);
      // Check if this is a Clause heading (Khoản or numbered like "1.", "2.")
      const isClause = /^(Khoản\s+\d+|\d+\.)/i.test(headingText);

      if (isArticle || headingLevel === 1) {
        // ─── Level 1: Article ──────────────────────────────────
        currentArticleHeader = headingText;
        currentArticleContent = section.trim();
        currentClauseHeader = '';

        chunks.push({
          content: section.trim(),
          level: 1,
          article: headingText,
        });
      } else if (isClause || headingLevel === 2) {
        // ─── Level 2: Clause ──────────────────────────────────
        currentClauseHeader = headingText;

        // Prepend parent article context
        const contextPrefix = currentArticleHeader
          ? `[${currentArticleHeader}]\n\n`
          : '';

        chunks.push({
          content: `${contextPrefix}${section.trim()}`,
          level: 2,
          article: currentArticleHeader || undefined,
          clause: headingText,
          parentContext: currentArticleHeader || undefined,
        });
      } else if (headingLevel === 3) {
        // ─── Level 3: Point ───────────────────────────────────
        const contextPrefix = [
          currentArticleHeader ? `[${currentArticleHeader}]` : '',
          currentClauseHeader ? `[${currentClauseHeader}]` : '',
        ].filter(Boolean).join(' > ');

        chunks.push({
          content: `${contextPrefix ? contextPrefix + '\n\n' : ''}${section.trim()}`,
          level: 3,
          article: currentArticleHeader || undefined,
          clause: currentClauseHeader || undefined,
          point: headingText,
          parentContext: contextPrefix || undefined,
        });
      }
    }

    return chunks;
  }

  /**
   * Chunk plain-text documents (from PyMuPDF fallback).
   * Splits on Vietnamese legal structure patterns:
   *   - Article: `Điều X.` or `Điều X:`
   *   - Clause:  `1.`, `2.`, `3.` (numbered at line start)
   *   - Point:   `a)`, `b)`, `c)` or `a.`, `b.` (lettered at line start)
   */
  private chunkPlainTextDocument(text: string): HierarchicalChunk[] {
    const chunks: HierarchicalChunk[] = [];

    // ─── Step 1: Split into articles ────────────────────────────────────
    // Match "Điều X" at the start of a line (with optional trailing characters)
    const articleRegex = /^([Đđ]iều\s+\d+[a-z]?\.?\s*.*)/gm;
    const articleMatches: { index: number; header: string; fullMatch: string }[] = [];
    let match;
    while ((match = articleRegex.exec(text)) !== null) {
      // Extract just the article label (e.g. "Điều 1") from the full match
      const labelMatch = match[1].match(/^[Đđ]iều\s+\d+[a-z]?/);
      articleMatches.push({
        index: match.index,
        header: labelMatch ? labelMatch[0] : match[1].split(/[.:]/)[0].trim(),
        fullMatch: match[1],
      });
    }

    // Build article sections
    interface ArticleSection { header: string; content: string }
    const articles: ArticleSection[] = [];

    if (articleMatches.length === 0) {
      // No article structure at all — single Level 1 chunk
      articles.push({ header: '', content: text });
    } else {
      // Preamble before the first article
      const preamble = text.substring(0, articleMatches[0].index).trim();
      if (preamble) {
        articles.push({ header: '', content: preamble });
      }
      // Each article
      for (let i = 0; i < articleMatches.length; i++) {
        const start = articleMatches[i].index;
        const end = i < articleMatches.length - 1 ? articleMatches[i + 1].index : text.length;
        articles.push({
          header: articleMatches[i].header,
          content: text.substring(start, end).trim(),
        });
      }
    }

    // ─── Step 2: For each article, split into clauses and points ────────
    for (const article of articles) {
      const currentArticle = article.header || undefined;

      // Level 1: full article chunk
      chunks.push({
        content: article.content,
        level: 1,
        article: currentArticle,
      });

      // ─── Clause splitting ─────────────────────────────────────────────
      // Only split clauses inside a real Article body (Điều X detected).
      // Without an article header, the "1. ..." pattern is just plain-text
      // enumeration — not legal clause numbering.
      if (!currentArticle) continue;

      // Match numbered clauses: "1. ...", "2. ...", OR "Khoản 1. ..."
      const clauseRegex = /^(\d+\.\s|Khoản\s+\d+(?:\.\d+)?\s*[.:]?\s)/gm;
      const clauseMatches: { index: number; label: string }[] = [];
      let cm;
      // Reset lastIndex and search within the article body (skip the first line = title)
      const articleBody = article.content;
      while ((cm = clauseRegex.exec(articleBody)) !== null) {
        clauseMatches.push({ index: cm.index, label: cm[1].trim() });
      }

      if (clauseMatches.length === 0) continue;

      for (let ci = 0; ci < clauseMatches.length; ci++) {
        const clauseStart = clauseMatches[ci].index;
        const clauseEnd = ci < clauseMatches.length - 1 ? clauseMatches[ci + 1].index : articleBody.length;
        const clauseContent = articleBody.substring(clauseStart, clauseEnd).trim();
        const clauseLabel = clauseMatches[ci].label;

        // Prepend parent article context
        const articleContext = currentArticle ? `[${currentArticle}]\n\n` : '';

        chunks.push({
          content: `${articleContext}${clauseContent}`,
          level: 2,
          article: currentArticle,
          clause: clauseLabel,
          parentContext: currentArticle,
        });

        // ─── Point splitting ─────────────────────────────────────────
        // Match lettered points: "a) ...", "b) ...", "a. ...", "b. ..."
        const pointRegex = /^([a-zđ][).])\s/gm;
        const pointMatches: { index: number; label: string }[] = [];
        let pm;
        while ((pm = pointRegex.exec(clauseContent)) !== null) {
          pointMatches.push({ index: pm.index, label: pm[1] });
        }

        if (pointMatches.length === 0) continue;

        for (let pi = 0; pi < pointMatches.length; pi++) {
          const pointStart = pointMatches[pi].index;
          const pointEnd = pi < pointMatches.length - 1 ? pointMatches[pi + 1].index : clauseContent.length;
          const pointContent = clauseContent.substring(pointStart, pointEnd).trim();
          const pointLabel = pointMatches[pi].label;

          const parentContext = [
            currentArticle ? `[${currentArticle}]` : '',
            clauseLabel ? `[${clauseLabel}]` : '',
          ].filter(Boolean).join(' > ');

          chunks.push({
            content: `${parentContext ? parentContext + '\n\n' : ''}${pointContent}`,
            level: 3,
            article: currentArticle,
            clause: clauseLabel,
            point: pointLabel,
            parentContext,
          });
        }
      }
    }

    return chunks;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Task B/G: clean OCR/whitespace noise from raw corpus text BEFORE chunking.
   * - Strip soft hyphens / backspace control chars (common Docling OCR artifacts).
   * - Collapse runs of spaces/tabs to a single space.
   * - Fix mid-word line breaks (e.g. "tư-\nơi" → "tư ơi") so tokens aren't split.
   * - Collapse 3+ blank lines to a single blank line.
   */
  private cleanCorpusText(text: string): string {
    return text
      .replace(/­/g, '') // soft hyphen U+00AD
      .replace(/[\b]/g, '') // backspace U+0008
      .replace(/[ \t]+/g, ' ') // collapse spaces/tabs
      .replace(/-\s*\n\s*/g, ' ') // repair OCR hyphenated line wraps
      .replace(/\s*\n\s*([a-záàảãạăâắầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ])/g, ' $1') // rejoin mid-word line breaks
      .replace(/\n{3,}/g, '\n\n') // collapse blank lines
      .trim();
  }

  /**
   * Task B/H: generate a concise per-document abstract used as a level-0 summary
   * chunk. Returns null if disabled or generation fails (caller proceeds without).
   */
  private async generateSummary(
    text: string,
    docType: string,
    userId?: string,
  ): Promise<string | null> {
    if (!ENABLE_SUMMARY_CHUNKS()) return null;
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
                  'Bạn là trợ lý tóm tắt văn bản pháp lý Việt Nam. Tóm tắt ngắn gọn văn bản sau thành 1 đoạn duy nhất, giữ nguyên tên cơ quan ban hành, căn cứ pháp lý và các điều/khoản chính. Không thêm giải thích.',
              },
              {
                role: 'user',
                content: `Loại văn bản: ${docType}\n\nNội dung:\n${text.substring(0, 8000)}`,
              },
            ],
            { temperature: 0.1, max_tokens: 512 },
          ),
        { maxRetries: 1, baseDelay: 1000, retryContext: 'doc-summary' },
      );
      return raw && raw.trim() ? raw.trim() : null;
    } catch (err) {
      console.warn('[RAG] Summary generation failed, skipping summary chunk:', err);
      return null;
    }
  }

  /**
   * Task B/H: store a level-0 summary chunk (atomic with the embedding update
   * inside the caller's transaction) so global context is retrievable.
   * Embedding is written via raw SQL because Prisma's `Unsupported` vector type
   * is not assignable through the typed `create` API (matches the rest of file).
   */
  private async createSummaryChunk(
    documentId: string,
    summary: string,
    access: AccessScope,
  ): Promise<void> {
    const embedding = await withRetry(
      () =>
        embeddingsBreaker.execute(() =>
          embeddingsClient.generateEmbedding(summary, 'passage'),
        ),
      { maxRetries: 2, baseDelay: 1000 },
    );
    const id = crypto.randomUUID();
    await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "Chunk" ("id", "documentId", "content", "contentHash", "level", "isSummary", "summaryOf", "embedding", "createdAt")
        SELECT ${id}, d.id, ${summary}, ${this.contentHash(summary)}, 0, true, ${`doc:${documentId}`}, ${this.toPgVector(embedding)}::vector, now()
        FROM "Document" d
        WHERE d.id = ${documentId}
        ${ownerFilter(access)}
    `);
  }

  /** Generate and persist one document summary as a best-effort extension. */
  async storeDocumentSummary(
    documentId: string,
    text: string,
    docType: string,
    access: AccessScope,
  ): Promise<void> {
    if (!ENABLE_SUMMARY_CHUNKS()) return;
    try {
      const existing = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT c.id
        FROM "Chunk" c
        JOIN "Document" d ON d.id = c."documentId"
        WHERE c."documentId" = ${documentId} AND c."isSummary" = true AND c.level = 0
        ${ownerFilter(access)}
        LIMIT 1
      `);
      if (existing.length > 0) return;
      const summary = await this.generateSummary(this.cleanCorpusText(text), docType, ragOwnerId(access));
      if (summary) await this.createSummaryChunk(documentId, summary, access);
    } catch (err) {
      console.warn('[RAG] Summary persistence failed, continuing without summary:', err);
    }
  }

  private toPgVector(values: number[]): string {
    return `[${values.join(',')}]`;
  }

  private contentHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Index a single chunk with embedding generation.
   * Used by the async ingestion pipeline for incremental chunk processing.
   */
  async indexChunk(
    text: string,
    documentId: string,
    access: AccessScope,
    docType?: string,
    metadata?: Record<string, any>,
  ): Promise<{ id: string; embedded: boolean; reused: boolean }> {
    const contentHash = this.contentHash(text);
    const { contentHash: _metadataHash, ...chunkMetadata } = metadata || {};
    const findExistingChunk = () => prisma.$queryRaw<Array<{ id: string; hasEmbedding: boolean }>>(Prisma.sql`
        SELECT c.id, c.embedding IS NOT NULL AS "hasEmbedding"
        FROM "Chunk" c
        JOIN "Document" d ON d.id = c."documentId"
        WHERE c."documentId" = ${documentId} AND c."contentHash" = ${contentHash}
        ${ownerFilter(access)}
        LIMIT 1
      `);

    let existingChunk = (await findExistingChunk())[0];
    let chunk: { id: string };
    if (existingChunk) {
      chunk = { id: existingChunk.id };
    } else {
      try {
        chunk = await prisma.chunk.create({
          data: {
            document: {
              connect: { id: documentId, ...documentWhere(access) },
            },
            content: text,
            contentHash,
            level: metadata?.level ?? 1,
            article: metadata?.article,
            clause: metadata?.clause,
            point: metadata?.point,
            metadata: Object.keys(chunkMetadata).length > 0 ? chunkMetadata : undefined,
          },
        });
      } catch (error) {
        // The database constraint is the source of truth when two ingestion
        // workers race to index the same document content.
        if ((error as { code?: string }).code !== 'P2002') throw error;
        existingChunk = (await findExistingChunk())[0];
        if (!existingChunk) throw error;
        chunk = { id: existingChunk.id };
      }
    }

    if (existingChunk?.hasEmbedding) return { id: chunk.id, embedded: true, reused: true };
    try {
      const embedding = await withRetry(
        () => embeddingsBreaker.execute(() => embeddingsClient.generateEmbedding(text, 'passage')),
        { maxRetries: 2, baseDelay: 1000 },
      );
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "Chunk" c
        SET embedding = ${this.toPgVector(embedding)}::vector
        FROM "Document" d
        WHERE c.id = ${chunk.id}
          AND d.id = c."documentId"
          ${ownerFilter(access)}
      `);
      return { id: chunk.id, embedded: true, reused: !!existingChunk };
    } catch (err) {
      console.warn(`[RAG] Embedding failed for chunk ${chunk.id}, stored without vector:`, err);
    }
    return { id: chunk.id, embedded: false, reused: !!existingChunk };
  }
}

export const ragService = new RAGService();
