import { diffLines } from 'diff';
import { prisma } from '../utils/prisma';

export interface FeedbackSubmission {
  documentId?: string;
  originalContent: string;
  editedContent: string;
  docType?: string;
  userId: string;
}

export interface FeedbackSubmissionResult {
  feedbackId: string;
  editType: "addition" | "deletion" | "modification";
}

function submissionDiff(original: string, edited: string): {
  diff: { additions: string[]; deletions: string[]; modifications: string[] };
  editType: FeedbackSubmissionResult['editType'];
} {
  const normalizedOriginal = original && !original.endsWith('\n') ? `${original}\n` : original;
  const normalizedEdited = edited && !edited.endsWith('\n') ? `${edited}\n` : edited;
  const changes = diffLines(normalizedOriginal, normalizedEdited);
  const additions: string[] = [];
  const deletions: string[] = [];
  const modifications: string[] = [];

  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    const next = changes[index + 1];
    if (change.removed && next?.added) {
      modifications.push(next.value.trim());
      index++;
    } else if (change.added) {
      additions.push(change.value.trim());
    } else if (change.removed) {
      deletions.push(change.value.trim());
    }
  }

  const editType = additions.length > 0 && deletions.length === 0 && modifications.length === 0
    ? 'addition'
    : deletions.length > 0 && additions.length === 0 && modifications.length === 0
      ? 'deletion'
      : 'modification';

  return { diff: { additions, deletions, modifications }, editType };
}

/**
 * Feedback Service
 * Captures and stores user edits for self-learning loop
 */
export class FeedbackService {
  /**
   * Normalize and persist feedback from generated or existing documents.
   */
  async submitFeedback(data: FeedbackSubmission): Promise<FeedbackSubmissionResult> {
    let documentId = data.documentId;

    if (!documentId) {
      if (!data.docType) {
        throw new Error('docType is required when documentId is not provided');
      }

      const document = await prisma.document.create({
        data: {
          docType: data.docType,
          title: `Feedback document ${new Date().toISOString()}`,
          content: data.editedContent,
          status: 'draft',
          ownerId: data.userId,
        },
      });
      documentId = document.id;
    } else {
      const document = await prisma.document.findFirst({
        where: { id: documentId, ownerId: data.userId },
        select: { id: true },
      });
      if (!document) throw new Error('Document not found');
    }

    const { diff, editType } = submissionDiff(data.originalContent, data.editedContent);
    const feedback = await prisma.feedback.create({
      data: {
        documentId,
        originalContent: data.originalContent,
        editedContent: data.editedContent,
        diff,
        editType,
      },
    });

    return {
      feedbackId: feedback.id,
      editType,
    };
  }

}

export const feedbackService = new FeedbackService();
