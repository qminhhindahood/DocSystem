/**
 * User authentication routes
 * POST /api/auth/register — create new user
 * POST /api/auth/login — login, returns JWT
 * GET  /api/auth/me — get current user info
 */

import express from 'express';
import { isIP } from 'node:net';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { userAuthMiddleware, requireAuth, generateToken, hashPassword, verifyPassword } from '../middleware/user_auth';
import { validate } from '../middleware/validation';
import { isPublicRegistrationDisabled } from '../utils/validateEnv';
import { requestPasswordReset, resetPassword } from '../services/password_reset_service';
import { forgotPasswordLimiter, resetPasswordLimiter, signupLimiter } from '../middleware/ratelimit';
import { verifyTurnstile } from '../services/turnstile_service';
import {
  isEmailPasswordResetEnabled,
  PASSWORD_RESET_DISABLED_CODE,
  PASSWORD_RESET_DISABLED_MESSAGE,
} from '../utils/password_reset_mode';

const router = express.Router();

const RegisterSchema = z.object({
  body: z.object({
    username: z.string().min(3).max(50),
    email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
    password: z.string().min(8).max(100),
    turnstileToken: z.string().optional(),
  }),
});

const ForgotPasswordSchema = z.object({
  body: z.object({ email: z.string().trim().email().max(254) }),
});

const ResetPasswordSchema = z.object({
  body: z.object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    password: z.string().min(8).max(100),
  }),
});

const LoginSchema = z.object({
  body: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }),
});

const DeleteAccountSchema = z.object({
  body: z.object({
    password: z.string().min(8).max(100),
  }),
});

function requireEmailPasswordReset(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (isEmailPasswordResetEnabled()) return next();
  return res.status(503).json({
    code: PASSWORD_RESET_DISABLED_CODE,
    error: PASSWORD_RESET_DISABLED_MESSAGE,
  });
}

function requirePublicRegistration(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (!isPublicRegistrationDisabled()) return next();
  return res.status(403).json({ error: 'Public registration is disabled' });
}

/**
 * Register new user
 * POST /api/auth/register
 * Blocked when DISABLE_PUBLIC_REGISTER=true (production safety)
 */
router.post('/register', requirePublicRegistration, signupLimiter, validate(RegisterSchema), async (req, res) => {
  try {
    const { username, email, password, turnstileToken } = req.body;
    if (!turnstileToken || turnstileToken.length > 2_048) {
      return res.status(400).json({
        code: 'TURNSTILE_REQUIRED',
        error: 'Vui lòng hoàn tất bước xác minh.',
      });
    }
    const internalClientIp = req.get('X-DocAI-Client-IP');
    const remoteIp = internalClientIp && isIP(internalClientIp) ? internalClientIp : req.ip;
    const verification = await verifyTurnstile({ token: turnstileToken, remoteIp });
    if (!verification.ok) {
      if (verification.reason === 'unavailable') {
        return res.status(503).json({
          code: 'TURNSTILE_UNAVAILABLE',
          error: 'Không thể xác minh lúc này. Vui lòng thử lại sau.',
        });
      }
      return res.status(403).json({
        code: 'TURNSTILE_REJECTED',
        error: 'Xác minh không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.',
      });
    }

    // Check if user exists
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
    });
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
      },
      select: {
        id: true,
        username: true,
        createdAt: true,
        sessionVersion: true,
      },
    });

    // Generate token
    const token = generateToken({
      userId: user.id,
      username: user.username,
      sessionVersion: user.sessionVersion,
    });

    res.status(201).json({
      success: true,
      user: { id: user.id, username: user.username, createdAt: user.createdAt },
      token,
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/forgot-password', requireEmailPasswordReset, forgotPasswordLimiter, validate(ForgotPasswordSchema), async (req, res) => {
  await requestPasswordReset(req.body.email).catch(() => undefined);
  res.status(202).json({
    success: true,
    message: 'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi.',
  });
});

router.post('/reset-password', requireEmailPasswordReset, resetPasswordLimiter, validate(ResetPasswordSchema), async (req, res) => {
  try {
    await resetPassword(req.body.token, req.body.password);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.' });
  }
});

/**
 * Login
 * POST /api/auth/login
 */
router.post('/login', validate(LoginSchema), async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { username },
    });
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (user.isDisabled) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = generateToken({
      userId: user.id,
      username: user.username,
      sessionVersion: user.sessionVersion,
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * Get current user info
 * GET /api/auth/me
 */
router.get('/me', userAuthMiddleware, requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        username: true,
        createdAt: true,
        updatedAt: true,
        llmConfig: {
          select: {
            id: true,
            provider: true,
            baseUrl: true,
            model: true,
            // Never return encrypted key to client
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, user });
  } catch (error: any) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Unable to load user profile' });
  }
});

/**
 * Permanently delete the authenticated account and its cascade-owned data.
 * DELETE /api/auth/me
 */
router.delete(
  '/me',
  userAuthMiddleware,
  requireAuth,
  validate(DeleteAccountSchema),
  async (req, res) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { id: true, passwordHash: true },
      });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (!await verifyPassword(req.body.password, user.passwordHash)) {
        return res.status(401).json({ error: 'Invalid password' });
      }
      await prisma.$transaction(async (tx) => {
        await tx.user.delete({ where: { id: user.id } });
      });
      return res.status(204).send();
    } catch {
      // Database errors can include connection details. Keep the client and
      // production logs free of exception text on this destructive endpoint.
      console.error('Delete account error');
      return res.status(500).json({ error: 'Unable to delete account' });
    }
  },
);

export default router;
