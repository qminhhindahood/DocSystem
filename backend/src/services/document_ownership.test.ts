jest.mock('../utils/prisma', () => ({
  prisma: {
    document: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    feedback: { create: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    chunk: { create: jest.fn(), createMany: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock('../utils/embeddings_client', () => ({
  embeddingsClient: {
    generateEmbedding: jest.fn().mockResolvedValue(new Array(1024).fill(0.1)),
    generateBatchEmbeddings: jest.fn(),
  },
}));

import { FeedbackService } from './feedback_service';
import { processIngestion } from './ingestion_service';
import { RAGService, ragService } from './rag_service';

const prisma = require('../utils/prisma').prisma;
const mockFindFirst = prisma.document.findFirst as jest.Mock;

const sqlText = (query: any): string => String(query.text || query.sql || query);
const sqlValues = (query: any): unknown[] => query.values || [];
const userAccess = { kind: 'user' as const, userId: 'user-a' };

describe('document tenant isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((operations: Promise<unknown>[]) => Promise.all(operations));
    delete process.env.ENABLE_SUMMARY_CHUNKS;
  });

  it('rejects feedback with one document-id and owner predicate for a foreign document', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    const service = new FeedbackService();

    await expect(service.submitFeedback({
      documentId: 'user-b-document',
      originalContent: 'before',
      editedContent: 'after',
      userId: 'user-a',
    })).rejects.toThrow('Document not found');

    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: 'user-b-document', ownerId: 'user-a' },
      select: { id: true },
    });
    expect(prisma.feedback.create).not.toHaveBeenCalled();
  });

  it('creates an owner-bound document for feedback without a document id', async () => {
    prisma.document.create.mockResolvedValueOnce({ id: 'doc-a' });
    prisma.feedback.create.mockResolvedValueOnce({ id: 'feedback-a' });
    const service = new FeedbackService();

    await expect(service.submitFeedback({
      originalContent: 'original content',
      editedContent: 'edited content',
      docType: 'cong-van',
      userId: 'user-a',
    })).resolves.toEqual({ feedbackId: 'feedback-a', editType: 'modification' });

    expect(prisma.document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerId: 'user-a' }),
    });
    expect(prisma.feedback.count).not.toHaveBeenCalled();
  });

  it('filters RAG SQL by owner before ranking and excludes foreign results', async () => {
    const corpus = [
      { id: 'chunk-a', documentId: 'user-a-document', level: 1, content: 'owned', createdAt: new Date() },
      { id: 'chunk-b', documentId: 'user-b-document', level: 1, content: 'foreign', createdAt: new Date() },
    ];
    prisma.$queryRaw.mockImplementation(async (query: any) => {
      const sql = sqlText(query);
      const params = sqlValues(query);
      return /d\."ownerId"\s*=\s*\$\d+/.test(sql) && params.includes('user-a')
        ? corpus.filter((result) => result.documentId === 'user-a-document')
        : corpus;
    });
    const service = new RAGService();

    const results = await service.search('owned evidence', 5, undefined, userAccess);

    const query = prisma.$queryRaw.mock.calls[0][0];
    const sql = sqlText(query);
    const params = sqlValues(query);
    expect(sql).toMatch(/d\."ownerId"\s*=\s*\$\d+/);
    expect(params).toContain('user-a');
    expect(sql).toMatch(/WHERE c\.embedding IS NOT NULL[\s\S]*d\."ownerId"\s*=\s*\$\d+[\s\S]*ORDER BY c\.embedding/);
    expect(results).not.toContainEqual(expect.objectContaining({ documentId: 'user-b-document' }));
  });

  it('keeps async ingestion document reads and writes owner-bound', async () => {
    prisma.document.update.mockResolvedValue({});
    prisma.document.findUnique.mockImplementation(async ({ select }: any) => {
      if (select.content) return { content: 'Nội dung', storageKey: null };
      if (select.docType) return { docType: 'cong-van' };
      if (select.storageKey) return { storageKey: null };
      return null;
    });
    jest.spyOn(ragService, 'chunkDocument').mockReturnValue([]);

    await processIngestion('user-a-document', userAccess);

    expect(prisma.document.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-a-document', ownerId: 'user-a' },
    }));
    for (const [call] of prisma.document.update.mock.calls) {
      expect(call.where).toEqual({ id: 'user-a-document', ownerId: 'user-a' });
    }
  });
});
