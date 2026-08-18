import express from 'express';
import { z } from 'zod';
import { userAuthMiddleware, requireAuth } from '../middleware/user_auth';
import { validate } from '../middleware/validation';
import {
  getDocumentProfile,
  upsertDocumentProfile,
  reserveDocumentNumber,
  validateProfileData,
} from '../services/document_profile_service';

const router = express.Router();

router.use(userAuthMiddleware, requireAuth);

const UpsertProfileSchema = z.object({
  body: z.object({
    supervisingAgency: z.string().max(200).optional().nullable(),
    agencyName: z.string().max(200).optional().nullable(),
    agencyCode: z.string().max(50).optional().nullable(),
    agencyAddress: z.string().max(500).optional().nullable(),
    agencyEmail: z.string().email().max(254).optional().nullable(),
    agencyWebsite: z.string().url().max(500).optional().nullable(),
    agencyPhone: z.string().max(50).optional().nullable(),
    defaultPlace: z.string().max(200).optional().nullable(),
    defaultRecipients: z.array(z.string().max(300)).max(50).optional().nullable(),
    signatoryName: z.string().max(200).optional().nullable(),
    signatoryTitle: z.string().max(200).optional().nullable(),
    documentNumberPrefix: z.string().max(50).optional().nullable(),
    // Client must never set nextDocumentNumber
  }).strict().refine((data) => {
    // Client must not send nextDocumentNumber
    return true;
  }),
});

// GET /api/settings/document-profile — get own profile
router.get('/', async (req, res) => {
  try {
    const profile = await getDocumentProfile(req.user!.userId);
    res.json({ success: true, profile: profile ?? null });
  } catch (error: any) {
    console.error('Error getting document profile:', error);
    res.status(500).json({ error: 'Failed to get document profile' });
  }
});

// PUT /api/settings/document-profile — upsert own profile
router.put('/', validate(UpsertProfileSchema), async (req, res) => {
  try {
    // Client must not set nextDocumentNumber — validate in service too
    if (req.body.nextDocumentNumber !== undefined) {
      return res.status(422).json({ error: 'nextDocumentNumber is reserved' });
    }

    const profile = await upsertDocumentProfile(req.user!.userId, req.body);
    res.json({ success: true, profile });
  } catch (error: any) {
    if (
      error.message?.includes('exceeds') ||
      error.message?.includes('Invalid type') ||
      error.message?.includes('must be an array') ||
      error.message?.includes('has more than')
    ) {
      return res.status(422).json({ error: error.message });
    }
    console.error('Error upserting document profile:', error);
    res.status(500).json({ error: 'Failed to update document profile' });
  }
});

// POST /api/settings/document-profile/reserve-number — atomic number reservation
router.post('/reserve-number', async (req, res) => {
  try {
    const documentNumber = await reserveDocumentNumber(req.user!.userId);
    res.json({ success: true, documentNumber });
  } catch (error: any) {
    console.error('Error reserving document number:', error);
    res.status(500).json({ error: 'Failed to reserve document number' });
  }
});

export default router;
