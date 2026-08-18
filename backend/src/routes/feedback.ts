import express from 'express';
import { feedbackService } from '../services/feedback_service';
import { FeedbackSchema, validate } from '../middleware/validation';
import { sanitizeInput } from '../middleware/sanitize';
import { userAuthMiddleware, requireAuth } from '../middleware/user_auth';
import { feedbackSubmitLimiter } from '../middleware/ratelimit';

const router = express.Router();

// Sanitize HTML in feedback content to prevent XSS
router.use('/submit', sanitizeInput(['originalContent', 'editedContent']));

/**
* Submit edit feedback
* POST /api/feedback/submit
* Body: { documentId, originalContent, editedContent }
*/
router.post('/submit', userAuthMiddleware, requireAuth, feedbackSubmitLimiter, validate(FeedbackSchema), async (req, res) => {
try {
const { feedbackId, editType } = await feedbackService.submitFeedback({
  ...req.body,
  userId: req.user!.userId,
});

res.json({
success: true,
feedbackId,
editType
});
} catch (error: any) {
console.error('Feedback submission error:', error);
const status = error?.message === 'Document not found' ? 404 : 500;
res.status(status).json({ error: status === 404 ? 'Document not found' : 'Feedback submission failed' });
}
});

export default router;
