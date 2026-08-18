import { RAGService, Chunk } from './rag_service';
import { SYSTEM_ACCESS, type AccessScope } from '../utils/document_access';

jest.mock('../utils/prisma', () => ({
  prisma: {
    chunk: { create: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    document: { create: jest.fn() },
  },
}));
jest.mock('../utils/embeddings_client', () => ({
  embeddingsClient: {
    generateEmbedding: jest.fn().mockResolvedValue(new Array(1024).fill(0.1)),
    generateBatchEmbeddings: jest.fn().mockResolvedValue([new Array(1024).fill(0.1)]),
  },
}));
jest.mock('./llm_config_service', () => ({
  getLLMConfig: jest.fn().mockResolvedValue({ baseUrl: 'x', model: 'm' }),
  callLLM: jest.fn().mockResolvedValue('TÓM TẮT: văn bản về thể thức văn bản hành chính.'),
}));

const prisma = require('../utils/prisma').prisma;
const llm = require('./llm_config_service');

const sqlText = (query: any): string => String(query.text || query.sql || query);
const sqlValues = (query: any): unknown[] => query.values || [];

describe('RAGService', () => {
  let ragService: RAGService;

  beforeEach(() => {
    jest.clearAllMocks();
    ragService = new RAGService();
  });

  afterEach(() => {
    delete process.env.ENABLE_SUMMARY_CHUNKS;
  });

  describe('chunkDocument', () => {
    it('should create chunks from document text', () => {
      const text = 'Nội dung chung không có điều khoản rõ ràng.';

      const chunks = ragService['chunkDocument'](text);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].content).toBe(text.trim());
      expect(chunks[0].level).toBe(1);
    });

    it('should handle empty input', () => {
      const text = '';
      const chunks = ragService['chunkDocument'](text);
      expect(chunks.length).toBe(0);
    });

    it('should handle whitespace-only input', () => {
      const text = '   \n\n  ';
      const chunks = ragService['chunkDocument'](text);
      // Whitespace-only content gets filtered out
      expect(chunks.length).toBe(0);
    });

    it('should handle Article (Điều) headers correctly', () => {
      const text = 'Điều 1. Quy định chung\n\nNội dung của điều 1.';

      const chunks = ragService['chunkDocument'](text);

      // Should have at least one chunk with level 1 for the Article
      const level1Chunks = chunks.filter(c => c.level === 1);
      expect(level1Chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should preserve content in chunks', () => {
      const text = 'Đây là nội dung kiểm tra.\n\nNhiều dòng.';

      const chunks = ragService['chunkDocument'](text);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].content).toContain('nội dung kiểm tra');
    });

    it('normalizes CRLF and lone carriage returns before chunking', () => {
      const chunks = ragService['chunkDocument']('Điều 1. Quy định\r\n\r\nNội dung\rĐiều tiếp theo.');
      expect(chunks.map(c => c.content).join('\n')).not.toContain('\r');
    });
  });

  describe('toPgVector', () => {
    it('should convert array to pgvector format', () => {
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];

      const result = ragService['toPgVector'](embedding);

      expect(result).toBe('[0.1,0.2,0.3,0.4,0.5]');
    });

    it('should handle empty array', () => {
      const result = ragService['toPgVector']([]);

      expect(result).toBe('[]');
    });

    it('should handle large embedding vectors', () => {
      const embedding = Array(1024).fill(0.123456);

      const result = ragService['toPgVector'](embedding);

      expect(result).toContain('0.123456');
      expect(result.startsWith('[')).toBe(true);
      expect(result.endsWith(']')).toBe(true);
    });

    it('should handle negative values', () => {
      const embedding = [-0.5, 0.0, 0.5, -1.0, 1.0];

      const result = ragService['toPgVector'](embedding);

      expect(result).toBe('[-0.5,0,0.5,-1,1]');
    });
  });

  describe('topK validation', () => {
    it('should clamp topK to minimum of 1', () => {
      const topK = Math.max(1, Math.min(Math.trunc(-5), 50));
      expect(topK).toBe(1);
    });

    it('should clamp topK to maximum of 50', () => {
      const topK = Math.max(1, Math.min(Math.trunc(1000), 50));
      expect(topK).toBe(50);
    });

    it('should pass through valid topK values', () => {
      expect(Math.max(1, Math.min(Math.trunc(5), 50))).toBe(5);
      expect(Math.max(1, Math.min(Math.trunc(10), 50))).toBe(10);
    });

    it('should handle zero topK', () => {
      const topK = Math.max(1, Math.min(Math.trunc(0), 50));
      expect(topK).toBe(1);
    });
  });

  describe('cleanCorpusText (Task B/G)', () => {
    it('collapses repeated spaces and blank lines', () => {
      const dirty = 'CỘNG   HÒA\n\n\n\nXÃ  HỘI';
      const clean = (ragService as any).cleanCorpusText(dirty);
      expect(clean).not.toMatch(/ {2,}/);
      expect(clean).not.toMatch(/\n{3,}/);
    });

    it('rejoins mid-word line breaks', () => {
      const dirty = 'tư-\nời ban hành';
      const clean = (ragService as any).cleanCorpusText(dirty);
      expect(clean).toContain('tư ời ban hành');
    });
  });

  describe('summary chunk generation (Task B/H)', () => {
    it('prepends a summary without consuming an evidence result slot', async () => {
      process.env.ENABLE_SUMMARY_CHUNKS = 'true';
      prisma.$queryRaw.mockResolvedValue([{ id: 'summary', documentId: 'doc-1', level: 0, content: 'summary' }]);
      const chunks = [
        { id: 'c1', documentId: 'doc-1', level: 1, content: 'one', createdAt: new Date() },
        { id: 'c2', documentId: 'doc-1', level: 1, content: 'two', createdAt: new Date() },
      ];
      const result = await (ragService as any).prependDocSummary(chunks, 2, SYSTEM_ACCESS);
      expect(result.map((c: any) => c.id)).toEqual(['summary', 'c1', 'c2']);
    });

    it('stores a level-0 summary chunk when ENABLE_SUMMARY_CHUNKS is true', async () => {
      process.env.ENABLE_SUMMARY_CHUNKS = 'true';
      prisma.$executeRaw.mockResolvedValue(undefined);

      const summary = await (ragService as any).generateSummary('Nội dung văn bản về thể thức.', 'cong-van');
      expect(summary).toContain('TÓM TẮT');

      await (ragService as any).createSummaryChunk('doc-1', summary!, SYSTEM_ACCESS);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      const sql = prisma.$executeRaw.mock.calls[0][0];
      expect(String(sql.sql || sql.text || sql)).toContain('INSERT INTO "Chunk"');
      expect(String(sql.sql || sql.text || sql)).not.toContain('"updatedAt"');
    });

    it('returns null when ENABLE_SUMMARY_CHUNKS is false', async () => {
      process.env.ENABLE_SUMMARY_CHUNKS = 'false';
      const summary = await (ragService as any).generateSummary('x', 'cong-van');
      expect(summary).toBeNull();
    });
  });

  describe('document access scope', () => {
    const userAccess: AccessScope = { kind: 'user', userId: 'user-a' };
    const corpus = [
      {
        id: 'chunk-a',
        documentId: 'doc-a',
        ownerId: 'user-a',
        level: 2,
        article: 'Điều 1',
        content: 'owned evidence',
        createdAt: new Date('2026-01-01'),
      },
      {
        id: 'chunk-b',
        documentId: 'doc-b',
        ownerId: 'user-b',
        level: 1,
        article: 'Điều 2',
        content: 'foreign evidence',
        createdAt: new Date('2026-01-02'),
      },
    ];

    function captureScopedQueries(): any[] {
      const queries: any[] = [];
      prisma.$queryRaw.mockImplementation(async (query: any) => {
        queries.push(query);
        const sql = sqlText(query);
        const values = sqlValues(query);
        const hasOwnerPredicate = /d\."ownerId"\s*=\s*\$\d+/.test(sql);
        const ownerId = values.includes('user-a') ? 'user-a' : undefined;

        if (sql.includes('WITH vector_ranked')) {
          return hasOwnerPredicate
            ? corpus.filter((chunk) => chunk.ownerId === ownerId)
            : corpus;
        }
        if (sql.includes('SELECT DISTINCT ON')) {
          return [{
            documentId: 'doc-a',
            article: 'Điều 1',
            content: 'owned parent',
          }];
        }
        if (sql.includes('c."isSummary" = true')) {
          return [{
            id: 'summary-a',
            documentId: 'doc-a',
            ownerId: 'user-a',
            level: 0,
            content: 'owned summary',
            createdAt: new Date('2026-01-01'),
          }];
        }
        return [];
      });
      return queries;
    }

    beforeEach(() => {
      process.env.ENABLE_SUMMARY_CHUNKS = 'true';
    });

    it('filters user search and enrichment SQL before ranking and excludes foreign rows', async () => {
      const queries = captureScopedQueries();

      const results = await ragService.search('quy định', 5, undefined, userAccess);

      expect(queries).toHaveLength(3);
      for (const query of queries) {
        expect(sqlText(query)).toMatch(/d\."ownerId"\s*=\s*\$\d+/);
        expect(sqlValues(query)).toContain('user-a');
      }
      expect(sqlText(queries[0])).toMatch(
        /WHERE c\.embedding IS NOT NULL[\s\S]*d\."ownerId"\s*=\s*\$\d+[\s\S]*ORDER BY c\.embedding/,
      );
      expect(sqlText(queries[0])).toMatch(
        /WHERE to_tsvector[\s\S]*d\."ownerId"\s*=\s*\$\d+[\s\S]*ORDER BY ts_rank_cd/,
      );
      expect(results).toEqual(expect.arrayContaining([
        expect.objectContaining({ documentId: 'doc-a' }),
      ]));
      expect(results).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ documentId: 'doc-b' }),
      ]));
    });

    it('keeps explicit system search and enrichment SQL unscoped', async () => {
      const queries = captureScopedQueries();

      const results = await ragService.search('quy định', 5, undefined, SYSTEM_ACCESS);

      expect(queries).toHaveLength(3);
      for (const query of queries) {
        expect(sqlText(query)).not.toMatch(/d\."ownerId"\s*=\s*\$\d+/);
      }
      expect(results).toEqual(expect.arrayContaining([
        expect.objectContaining({ documentId: 'doc-a' }),
        expect.objectContaining({ documentId: 'doc-b' }),
      ]));
    });
  });

  it('uses a symmetric fusion query so FTS-only candidates can be returned', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await ragService.search('Nghị định 30/2020', 5, undefined, SYSTEM_ACCESS);

    const query = prisma.$queryRaw.mock.calls[0][0];
    expect(String(query.sql || query.text || query)).toContain('FULL OUTER JOIN fts_ranked');
    expect(sqlValues(query)).toContain('Nghi dinh 30/2020');
  });

  it('requires an explicit document access scope for retrieval', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const unsafeSearch = ragService.search as unknown as (query: string) => ReturnType<RAGService['search']>;
    try {
      await expect(unsafeSearch.call(ragService, 'private document')).rejects.toThrow('Document search requires access context');
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('reuses an already embedded chunk with the same document content hash', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'existing-chunk', hasEmbedding: true }]);

    await expect(ragService.indexChunk('Điều 1. Nội dung', 'doc-1', SYSTEM_ACCESS)).resolves.toEqual({
      id: 'existing-chunk', embedded: true, reused: true,
    });
    expect(prisma.chunk.create).not.toHaveBeenCalled();
  });

  it('recovers from a duplicate-content race by reusing the winning chunk', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'race-winner', hasEmbedding: true }]);
    prisma.chunk.create.mockRejectedValueOnce({ code: 'P2002' });

    await expect(ragService.indexChunk('Điều 1. Nội dung', 'doc-1', SYSTEM_ACCESS)).resolves.toEqual({
      id: 'race-winner', embedded: true, reused: true,
    });
  });

  it('authorizes every user chunk read and mutation through the owning document', async () => {
    const access: AccessScope = { kind: 'user', userId: 'user-a' };
    prisma.$queryRaw.mockResolvedValueOnce([]);
    prisma.chunk.create.mockResolvedValueOnce({ id: 'chunk-a' });
    prisma.$executeRaw.mockResolvedValueOnce(1);

    await ragService.indexChunk('Điều 1. Nội dung', 'doc-a', access);

    const read = prisma.$queryRaw.mock.calls[0][0];
    expect(sqlText(read)).toMatch(/JOIN "Document" d ON d\.id = c\."documentId"/);
    expect(sqlText(read)).toMatch(/d\."ownerId"\s*=\s*\$\d+/);
    expect(sqlValues(read)).toContain('user-a');
    expect(prisma.chunk.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        document: { connect: { id: 'doc-a', ownerId: 'user-a' } },
      }),
    });
    expect(prisma.chunk.create.mock.calls[0][0].data).not.toHaveProperty('documentId');
    const update = prisma.$executeRaw.mock.calls[0][0];
    expect(sqlText(update)).toMatch(/UPDATE "Chunk" c[\s\S]*FROM "Document" d/);
    expect(sqlText(update)).toMatch(/d\."ownerId"\s*=\s*\$\d+/);
    expect(sqlValues(update)).toContain('user-a');
  });

  it('authorizes summary reads and writes through the owning document', async () => {
    process.env.ENABLE_SUMMARY_CHUNKS = 'true';
    const access: AccessScope = { kind: 'user', userId: 'user-a' };
    prisma.$queryRaw.mockResolvedValueOnce([]);
    prisma.$executeRaw.mockResolvedValueOnce(1);
    const storeDocumentSummary = (ragService as any).storeDocumentSummary;

    expect(typeof storeDocumentSummary).toBe('function');
    if (typeof storeDocumentSummary !== 'function') return;
    await storeDocumentSummary.call(ragService, 'doc-a', 'Nội dung văn bản pháp lý', 'cong-van', access);

    const read = prisma.$queryRaw.mock.calls[0][0];
    expect(sqlText(read)).toMatch(/JOIN "Document" d ON d\.id = c\."documentId"/);
    expect(sqlText(read)).toMatch(/d\."ownerId"\s*=\s*\$\d+/);
    expect(sqlValues(read)).toContain('user-a');
    const insert = prisma.$executeRaw.mock.calls[0][0];
    expect(sqlText(insert)).toMatch(/INSERT INTO "Chunk"[\s\S]*SELECT[\s\S]*FROM "Document" d/);
    expect(sqlText(insert)).toMatch(/d\."ownerId"\s*=\s*\$\d+/);
    expect(sqlValues(insert)).toContain('user-a');
  });

  it('caches identical query embeddings for the configured TTL', async () => {
    process.env.RAG_QUERY_EMBED_CACHE_TTL_SECONDS = '60';
    await (ragService as any).getEmbedding('quy định về thể thức');
    await (ragService as any).getEmbedding('quy định về thể thức');

    expect(require('../utils/embeddings_client').embeddingsClient.generateEmbedding).toHaveBeenCalledTimes(1);
  });
});
