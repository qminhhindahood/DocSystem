/**
 * Per-user vision provider settings routes (BYOK).
 *
 * GET    /api/settings/llm                    — get current user's config (no secrets)
 * POST   /api/settings/llm                    — create/update config (AES-256-GCM key storage)
 * POST   /api/settings/llm/test               — test connection to the provider
 * DELETE /api/settings/llm                    — delete config
 *
 * Gemini is the sole provider for the wired scanned-page vision path.
 */

import express from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { userAuthMiddleware, requireAuth } from '../middleware/user_auth';
import { validate } from '../middleware/validation';
import { encryptApiKey, decryptApiKey } from '../utils/encryption';
import {
  canonicalizeProviderBaseUrl,
  providerRequiresApiKey,
  testLLMConnection,
} from '../services/llm_config_service';
import { LLM_PROVIDER_IDS, type LLMProvider } from '../constants/llm-providers';
import { validateProviderTarget, parseAllowlist } from '../utils/urlGuard';

const router = express.Router();

const LLMSettingsSchema = z.object({
  body: z.object({
    provider: z.enum(LLM_PROVIDER_IDS),
    baseUrl: z.string().trim().url().max(2_048),
    model: z.string().trim().min(1).max(200),
    apiKey: z.string().max(8_192).optional(),
  }),
});

/**
 * GET /api/settings/llm — get current user's LLM config
 * Never returns the encrypted API key
 */
router.get(
  '/',
  userAuthMiddleware,
  requireAuth,
  async (req, res) => {
    try {
      const config = await prisma.userLLMConfig.findUnique({
        where: { userId: req.user!.userId },
        select: {
          id: true,
          provider: true,
          baseUrl: true,
          model: true,
          encryptedApiKey: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const safeConfig = config?.provider === 'gemini' ? {
        id: config.id,
        provider: config.provider,
        baseUrl: config.baseUrl,
        model: config.model,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
        hasApiKey: Boolean(config.encryptedApiKey),
      } : null;

      res.json({
        success: true,
        config: safeConfig,
      });
    } catch (error: any) {
      console.error('Get LLM settings error:', error);
      res.status(500).json({ error: 'Unable to load LLM settings' });
    }
  },
);

/**
 * POST /api/settings/llm — create or update LLM config
 */
router.post(
  '/',
  userAuthMiddleware,
  requireAuth,
  validate(LLMSettingsSchema),
  async (req, res) => {
    try {
      const { provider, baseUrl, model, apiKey } = req.body;
      const providerType = provider as LLMProvider;
      const userId = req.user!.userId;
      const normalizedBaseUrl = canonicalizeProviderBaseUrl(providerType, baseUrl);
      const existing = await prisma.userLLMConfig.findUnique({
        where: { userId },
        select: { provider: true, encryptedApiKey: true, apiKeyIv: true, apiKeyAuthTag: true },
      });

      // Cloud-only product: no local-provider allowlist (BYOK Gemini).
      const allowlist = parseAllowlist(undefined);
      await validateProviderTarget(normalizedBaseUrl, providerType, allowlist).catch((err: Error) => {
        return res.status(400).json({ error: `Invalid provider URL: ${err.message}` });
      });
      if (res.headersSent) return;

      const hasSubmittedKey = typeof apiKey === 'string' && apiKey.length > 0;
      const canReuseSavedKey = Boolean(existing && existing.provider === provider && existing.encryptedApiKey);
      if (providerRequiresApiKey(providerType) && !hasSubmittedKey && !canReuseSavedKey) {
        return res.status(400).json({ error: 'API key is required for this provider' });
      }

      let encryptedApiKey = '';
      let apiKeyIv = '';
      let apiKeyAuthTag = '';
      if (hasSubmittedKey) {
        const encrypted = encryptApiKey(apiKey);
        encryptedApiKey = encrypted.encryptedApiKey;
        apiKeyIv = encrypted.apiKeyIv;
        apiKeyAuthTag = encrypted.apiKeyAuthTag;
      } else if (canReuseSavedKey && existing) {
        encryptedApiKey = existing.encryptedApiKey;
        apiKeyIv = existing.apiKeyIv;
        apiKeyAuthTag = existing.apiKeyAuthTag;
      }

      const config = await prisma.userLLMConfig.upsert({
        where: { userId },
        create: {
          userId,
          provider,
          baseUrl: normalizedBaseUrl,
          model,
          encryptedApiKey: encryptedApiKey || '',
          apiKeyIv: apiKeyIv || '',
          apiKeyAuthTag: apiKeyAuthTag || '',
        },
        update: {
          provider,
          baseUrl: normalizedBaseUrl,
          model,
          encryptedApiKey,
          apiKeyIv,
          apiKeyAuthTag,
        },
        select: {
          id: true,
          provider: true,
          baseUrl: true,
          model: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      res.json({ success: true, config: { ...config, hasApiKey: Boolean(encryptedApiKey) } });
    } catch (error: any) {
      console.error('Save LLM settings error:', error);
      res.status(500).json({ error: 'Unable to save LLM settings' });
    }
  },
);

/**
 * POST /api/settings/llm/test — test connection to user's LLM provider
 */
router.post(
  '/test',
  userAuthMiddleware,
  requireAuth,
  validate(LLMSettingsSchema),
  async (req, res) => {
    try {
      const { provider, baseUrl, model, apiKey } = req.body;
      const providerType = provider as LLMProvider;
      const normalizedBaseUrl = canonicalizeProviderBaseUrl(providerType, baseUrl);
      const submittedApiKey = typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : undefined;
      const existing = submittedApiKey ? null : await prisma.userLLMConfig.findUnique({
        where: { userId: req.user!.userId },
        select: { provider: true, encryptedApiKey: true, apiKeyIv: true, apiKeyAuthTag: true },
      });

      let effectiveApiKey = submittedApiKey;
      if (!effectiveApiKey && existing && existing.provider === provider && existing.encryptedApiKey) {
        effectiveApiKey = decryptApiKey(existing.encryptedApiKey, existing.apiKeyIv, existing.apiKeyAuthTag);
      }
      if (providerRequiresApiKey(providerType) && !effectiveApiKey) {
        return res.status(400).json({ success: false, error: 'API key is required for this provider' });
      }

      // Cloud-only product: no local-provider allowlist (BYOK Gemini).
      const allowlist = parseAllowlist(undefined);
      await validateProviderTarget(normalizedBaseUrl, providerType, allowlist).catch((err: Error) => {
        return res.status(400).json({ success: false, error: `Invalid provider URL: ${err.message}` });
      });
      if (res.headersSent) return;

      const result = await testLLMConnection({
        provider: providerType,
        baseUrl: normalizedBaseUrl,
        model,
        apiKey: effectiveApiKey,
      });

      res.json({
        success: result.ok,
        model: result.model,
        error: result.error,
      });
    } catch (error: any) {
      console.error('Test LLM connection error:', error);
      res.status(500).json({ success: false, error: 'Unable to test LLM connection' });
    }
  },
);

/**
 * DELETE /api/settings/llm — delete user's LLM config
 */
router.delete(
  '/',
  userAuthMiddleware,
  requireAuth,
  async (req, res) => {
    try {
      await prisma.userLLMConfig.delete({
        where: { userId: req.user!.userId },
      }).catch(() => {
        // Already deleted or never existed — not an error
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error('Delete LLM settings error:', error);
      res.status(500).json({ error: 'Unable to delete LLM settings' });
    }
  },
);

export default router;
