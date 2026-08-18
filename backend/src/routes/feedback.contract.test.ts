import express from 'express';
import { generateToken } from '../middleware/user_auth';
import { withHttpServer } from '../test/http';
import { prisma } from '../utils/prisma';
import feedbackRoutes from './feedback';
import { feedbackService } from '../services/feedback_service';

jest.mock('../utils/prisma', () => ({
  prisma: { user: { findUnique: jest.fn() } },
}));

jest.mock('../services/feedback_service', () => ({
  feedbackService: {
    submitFeedback: jest.fn().mockResolvedValue({
      feedbackId: 'feedback-1',
      editType: 'modification',
    }),
  },
}));

describe('feedback API tenant contract', () => {
  const token = generateToken({ userId: 'user-a', username: 'alice' });
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'user-a', username: 'alice', isDisabled: false, sessionVersion: 0,
    });
    (feedbackService.submitFeedback as jest.Mock).mockResolvedValue({
      feedbackId: 'feedback-1', editType: 'modification',
    });
    app = express();
    app.use(express.json());
    app.use('/api/feedback', feedbackRoutes);
  });

  it('returns 401 without a user token before feedback validation', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/feedback/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(401);
      expect(feedbackService.submitFeedback).not.toHaveBeenCalled();
    });
  });

  it('submits as the authenticated owner and returns no global training data', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/feedback/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          original: 'before',
          edited: 'after',
          documentType: 'cong-van',
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        success: true,
        feedbackId: 'feedback-1',
        editType: 'modification',
      });
      expect(feedbackService.submitFeedback).toHaveBeenCalledWith(expect.objectContaining({
        originalContent: 'before',
        editedContent: 'after',
        docType: 'cong-van',
        userId: 'user-a',
      }));
      expect(feedbackService.submitFeedback).not.toHaveBeenCalledWith(expect.objectContaining({
        isAdmin: expect.anything(),
      }));
    });
  });

  it('returns 404 when the owner-scoped feedback service cannot find the document', async () => {
    (feedbackService.submitFeedback as jest.Mock).mockRejectedValueOnce(new Error('Document not found'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await withHttpServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/feedback/submit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            documentId: 'user-b-document',
            original: 'before',
            edited: 'after',
          }),
        });

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ error: 'Document not found' });
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
