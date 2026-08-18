import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../utils/redis';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
}

const DEFAULT_KEY = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';

// H11: per-user key for upload/submit limiters — falls back to IP when no
// authenticated user is present.
const USER_KEY = (req: Request) =>
  req.user?.userId ?? DEFAULT_KEY(req);

export function rateLimiter(config: RateLimitConfig) {
  const { windowMs, maxRequests, keyGenerator = DEFAULT_KEY, skip } = config;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Rate-limit tests by hammering a live Redis connection; in the Jest
    // suite Redis isn't initialized, so the limiter would fail CLOSED and
    // break contract tests. Skip in the test environment.
    if (process.env.NODE_ENV === 'test' || skip?.(req)) return next();

    const key = `ratelimit:${keyGenerator(req)}`;
    try {
      // Atomic Lua script: SET if missing with TTL, else INCR + EXPIRE on first incr.
      const ttlSec = Math.ceil(windowMs / 1000);
      const script = `
        local c = redis.call("INCR", KEYS[1])
        if c == 1 then
          redis.call("EXPIRE", KEYS[1], ARGV[1])
        end
        return c
      `;
      const count = await redisClient.getClient().eval(script, {
        keys: [key],
        arguments: [String(ttlSec)],
      }) as number;

      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - count)));

      if (count > maxRequests) {
        return res.status(429).json({
          error: 'Too many requests',
          retryAfter: ttlSec,
        });
      }
    } catch (error) {
      // m5: align comment with reality — we fail CLOSED (503) on Redis error.
      // If Redis is down, we cannot enforce rate limits safely, so deny.
      console.error('[ratelimit] Redis error, denying request:', error);
    return res.status(503).json({ error: 'Service temporarily unavailable' });
    }
    next();
  };
}

export const generateLimiter = rateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  keyGenerator: (req) => `generate:${DEFAULT_KEY(req)}`,
});

export const streamLimiter = rateLimiter({
  windowMs: 60_000,
  maxRequests: 5,
  keyGenerator: (req) => `stream:${DEFAULT_KEY(req)}`,
});

// QA streams can hold an HTTP connection for several minutes; keep a
// dedicated, tighter budget instead of relying on the broad /api limiter.
export const qaLimiter = rateLimiter({
  windowMs: 60_000,
  maxRequests: 5,
  keyGenerator: (req) => `qa:${DEFAULT_KEY(req)}`,
});

export const searchLimiter = rateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
  keyGenerator: (req) => `search:${DEFAULT_KEY(req)}`,
});

// H11: dedicated per-user limiters for upload/index and feedback submission.
// Each limiter prefixes its key so separate budgets do not collide on one
// Redis counter (e.g. uploads exhausting the feedback budget and vice versa).
export const uploadLimiter = rateLimiter({
  windowMs: 15 * 60_000,
  maxRequests: 20,
  keyGenerator: (req) => `upload:${USER_KEY(req)}`,
});

export const templateUploadLimiter = rateLimiter({
  windowMs: 15 * 60_000,
  maxRequests: 10,
  keyGenerator: (req) => `template-upload:${USER_KEY(req)}`,
});

export const feedbackSubmitLimiter = rateLimiter({
  windowMs: 15 * 60_000,
  maxRequests: 30,
  keyGenerator: (req) => `feedback:${USER_KEY(req)}`,
});

export const forgotPasswordLimiter = rateLimiter({
  windowMs: 15 * 60_000,
  maxRequests: 5,
  keyGenerator: (req) => `forgot-password:${DEFAULT_KEY(req)}`,
});

export const resetPasswordLimiter = rateLimiter({
  windowMs: 15 * 60_000,
  maxRequests: 10,
  keyGenerator: (req) => `reset-password:${DEFAULT_KEY(req)}`,
});

export const signupLimiter = rateLimiter({
  windowMs: 15 * 60_000,
  maxRequests: 5,
  keyGenerator: (req) => `signup:${req.get('X-DocAI-Client-IP') || DEFAULT_KEY(req)}`,
});
