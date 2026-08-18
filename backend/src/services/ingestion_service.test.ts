import { cleanupIngestionFile, getDoclingIngestionTimeoutMs, processIngestion } from './ingestion_service';
import type { AccessScope } from '../utils/document_access';

jest.mock('../utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    chunk: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    document: {
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue({ content: 'Điều 1. Nội dung', storageKey: null, docType: 'law' }),
    },
  },
}));

jest.mock('./rag_service', () => ({
  ragService: {
    chunkDocument: jest.fn().mockReturnValue([{ content: 'Điều 1. Nội dung', level: 1 }]),
    indexChunk: jest.fn().mockResolvedValue({ id: 'chunk-1', embedded: true }),
    createSummaryForDocument: jest.fn().mockResolvedValue(undefined),
    storeDocumentSummary: jest.fn().mockResolvedValue(undefined),
  },
  ENABLE_SUMMARY_CHUNKS: jest.fn(() => true),
}));

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('form-data', () => ({
  __esModule: true,
  default: class MockFormData {
    append = jest.fn();
    getHeaders() { return { 'content-type': 'multipart/form-data' }; }
  },
}));
jest.mock('fs', () => ({
  createReadStream: jest.fn().mockReturnValue({}),
  existsSync: jest.fn().mockReturnValue(false),
  promises: { unlink: jest.fn() },
}));

describe('processIngestion summary lifecycle', () => {
  const access: AccessScope = { kind: 'user', userId: 'user-a' };

  beforeEach(() => {
    jest.clearAllMocks();
    const { ragService } = require('./rag_service');
    const { prisma } = require('../utils/prisma');
    const fs = require('fs');
    ragService.indexChunk.mockResolvedValue({ id: 'chunk-1', embedded: true });
    prisma.document.findUnique.mockResolvedValue({
      content: 'Điều 1. Nội dung', storageKey: null, docType: 'law',
    });
    fs.existsSync.mockReturnValue(false);
  });

  it('allows long Cloud Run parses without exceeding the service timeout', () => {
    expect(getDoclingIngestionTimeoutMs({ DOCLING_ASYNC_TIMEOUT_MS: '840000' })).toBe(840_000);
    expect(getDoclingIngestionTimeoutMs({ DOCLING_ASYNC_TIMEOUT_MS: 'invalid' })).toBe(840_000);
  });

  it('extracts embedded PDF text before invoking expensive OCR', async () => {
    const axios = require('axios');
    const { prisma } = require('../utils/prisma');
    const fs = require('fs');
    prisma.document.findUnique.mockResolvedValue({
      content: '', storageKey: 'uploads/text.pdf', docType: 'law',
    });
    fs.existsSync.mockReturnValue(true);
    axios.post.mockResolvedValue({ data: { text: 'A'.repeat(600) } });

    await processIngestion('doc-1', access);

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/parse?do_ocr=false'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('falls back to OCR when embedded PDF text is too short', async () => {
    const axios = require('axios');
    const { prisma } = require('../utils/prisma');
    const fs = require('fs');
    prisma.document.findUnique.mockResolvedValue({
      content: '', storageKey: 'uploads/scan.pdf', docType: 'law',
    });
    fs.existsSync.mockReturnValue(true);
    axios.post
      .mockResolvedValueOnce({ data: { text: 'short' } })
      .mockResolvedValueOnce({ data: { text: 'B'.repeat(600) } });

    await processIngestion('doc-1', access);

    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[0][0]).toContain('/parse?do_ocr=false');
    expect(axios.post.mock.calls[1][0]).toContain('/parse?do_ocr=true');
  });

  it('preserves the queued user scope through chunk and summary persistence', async () => {
    const { ragService } = require('./rag_service');
    await processIngestion('doc-1', access);

    expect(ragService.indexChunk).toHaveBeenCalledWith(
      'Điều 1. Nội dung',
      'doc-1',
      access,
      'law',
      { level: 1, article: undefined, clause: undefined, point: undefined },
    );
    expect(ragService.storeDocumentSummary).toHaveBeenCalledWith(
      'doc-1',
      'Điều 1. Nội dung',
      'law',
      access,
    );
    expect(ragService.createSummaryForDocument).not.toHaveBeenCalled();
  });

  it('clears partial chunks before every replay to keep ingestion idempotent', async () => {
    const { prisma } = require('../utils/prisma');
    await processIngestion('doc-1', access);
    expect(prisma.chunk.deleteMany).toHaveBeenCalledWith({ where: { documentId: 'doc-1' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('marks a document partial instead of indexed when an embedding is unavailable', async () => {
    const { ragService } = require('./rag_service');
    const { prisma } = require('../utils/prisma');
    ragService.indexChunk.mockResolvedValueOnce({ id: 'chunk-1', embedded: false });

    await processIngestion('doc-1', access);

    expect(prisma.document.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'doc-1', ownerId: 'user-a' },
      data: expect.objectContaining({
        ingestionStatus: 'partial',
        chunkCount: 1,
        embeddedChunkCount: 0,
        failedChunkCount: 1,
      }),
    }));
  });

  it('propagates ingestion failure and retains the upload for a durable retry', async () => {
    const { prisma } = require('../utils/prisma');
    const fs = require('fs');
    prisma.document.findUnique.mockResolvedValue({
      content: '', storageKey: 'uploads/failed.pdf', docType: 'law',
    });
    fs.existsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);

    await expect(processIngestion('doc-1', access)).rejects.toThrow(
      'No parsable content found',
    );

    expect(prisma.document.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ingestionStatus: 'failed' }),
    }));
    expect(fs.promises.unlink).not.toHaveBeenCalled();
  });

  it('removes the uploaded file only when the worker requests terminal cleanup', async () => {
    const { prisma } = require('../utils/prisma');
    const fs = require('fs');
    prisma.document.findUnique.mockResolvedValue({ storageKey: 'uploads/finished.pdf' });
    fs.existsSync.mockReturnValue(true);

    await cleanupIngestionFile('doc-1', access);

    expect(fs.promises.unlink).toHaveBeenCalledWith(expect.stringContaining('finished.pdf'));
  });
});
