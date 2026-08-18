import { feedbackService } from './feedback_service';

const mockFeedbackCreate = jest.fn();
const mockFeedbackCount = jest.fn();
const mockFeedbackFindMany = jest.fn();
const mockDocumentCreate = jest.fn();
const mockDocumentFindFirst = jest.fn();
const mockAnalyzeFeedback = jest.fn();

jest.mock('../utils/prisma', () => ({
  prisma: {
    feedback: {
      create: (...args: any[]) => mockFeedbackCreate(...args),
      count: (...args: any[]) => mockFeedbackCount(...args),
      findMany: (...args: any[]) => mockFeedbackFindMany(...args),
    },
    document: {
      create: (...args: any[]) => mockDocumentCreate(...args),
      findFirst: (...args: any[]) => mockDocumentFindFirst(...args),
    },
  },
}));

jest.mock('./feedback_analysis', () => ({
  analyzeFeedback: (...args: any[]) => mockAnalyzeFeedback(...args),
}));

function analysisFor(editType: 'addition' | 'deletion' | 'modification') {
  return {
    diff: {
      additions: editType === 'addition' ? ['added'] : [],
      deletions: editType === 'deletion' ? ['removed'] : [],
      modifications: editType === 'modification' ? ['changed'] : [],
      jaccardSimilarity: 0.5,
    },
    classification: {
      primaryType: editType,
      subType: 'wording',
      priority: 'medium',
      affectsCompliance: false,
      confidence: 0.8,
    },
  };
}

describe('FeedbackService user-scoped submission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAnalyzeFeedback.mockReturnValue(analysisFor('modification'));
    mockFeedbackCreate.mockResolvedValue({ id: 'feedback-1' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('authorizes an existing document with one id-and-owner predicate', async () => {
    mockDocumentFindFirst.mockResolvedValue({ id: 'doc-a' });

    const result = await feedbackService.submitFeedback({
      documentId: 'doc-a',
      originalContent: 'Old text',
      editedContent: 'New text',
      userId: 'user-a',
    });

    expect(mockDocumentFindFirst).toHaveBeenCalledTimes(1);
    expect(mockDocumentFindFirst).toHaveBeenCalledWith({
      where: { id: 'doc-a', ownerId: 'user-a' },
      select: { id: true },
    });
    expect(mockDocumentCreate).not.toHaveBeenCalled();
    expect(result).toEqual({ feedbackId: 'feedback-1', editType: 'modification' });
  });

  it('rejects a foreign document before creating feedback', async () => {
    mockDocumentFindFirst.mockResolvedValue(null);

    await expect(feedbackService.submitFeedback({
      documentId: 'doc-b',
      originalContent: 'Old text',
      editedContent: 'New text',
      userId: 'user-a',
    })).rejects.toThrow('Document not found');

    expect(mockDocumentFindFirst).toHaveBeenCalledWith({
      where: { id: 'doc-b', ownerId: 'user-a' },
      select: { id: true },
    });
    expect(mockFeedbackCreate).not.toHaveBeenCalled();
  });

  it('binds a feedback-created document to the authenticated owner', async () => {
    mockDocumentCreate.mockResolvedValue({ id: 'doc-new' });

    const result = await feedbackService.submitFeedback({
      docType: 'cong-van',
      originalContent: 'Original text',
      editedContent: 'Original text\nAdded line',
      userId: 'user-a',
    });

    expect(mockDocumentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        docType: 'cong-van',
        content: 'Original text\nAdded line',
        ownerId: 'user-a',
      }),
    });
    expect(mockDocumentFindFirst).not.toHaveBeenCalled();
    expect(result).toEqual({ feedbackId: 'feedback-1', editType: 'addition' });
  });

  it('persists only the reduced feedback payload and invokes no legacy analysis or training paths', async () => {
    mockDocumentFindFirst.mockResolvedValue({ id: 'doc-a' });

    const result = await feedbackService.submitFeedback({
      documentId: 'doc-a',
      originalContent: 'Old text',
      editedContent: 'New text',
      userId: 'user-a',
    });

    expect(result).toEqual({ feedbackId: 'feedback-1', editType: 'modification' });
    expect(mockAnalyzeFeedback).not.toHaveBeenCalled();
    expect(mockFeedbackCount).not.toHaveBeenCalled();
    expect(mockFeedbackFindMany).not.toHaveBeenCalled();

    const createData = mockFeedbackCreate.mock.calls[0][0].data;
    expect(Object.keys(createData).sort()).toEqual([
      'diff',
      'documentId',
      'editedContent',
      'editType',
      'originalContent',
    ].sort());
    expect(createData.diff).toEqual({
      additions: [],
      deletions: [],
      modifications: ['New text'],
    });

    for (const forbiddenField of [
      'subType',
      'priority',
      'jaccardSimilarity',
      'affectsCompliance',
      'classificationConfidence',
      'reviewStatus',
      'approvedForTraining',
      'approvedForRag',
      'sessionId',
      'modelName',
      'confidence',
    ]) {
      expect(createData).not.toHaveProperty(forbiddenField);
    }
  });
});
