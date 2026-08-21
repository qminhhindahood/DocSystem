import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
export function supportedBulkPollRequests(rateWindowMs: number): number {
  return Math.ceil(10 * (rateWindowMs / 1_500));
}

export const SUPPORTED_BULK_POLL_REQUESTS_PER_WINDOW = supportedBulkPollRequests(windowMs);
export const CONVERSION_STATUS_RATE_LIMIT_MAX = Number(
  process.env.CONVERSION_STATUS_RATE_LIMIT_MAX,
) || Math.ceil(SUPPORTED_BULK_POLL_REQUESTS_PER_WINDOW * 1.2);

/** Exact polling endpoint only; reports and downloads retain the general cap. */
export function isConversionStatusRequest(req: Request): boolean {
  const pathname = req.originalUrl.split('?', 1)[0];
  return req.method === 'GET' && /^\/api\/convert\/[^/]+\/?$/.test(pathname);
}

export const generalApiLimiter = rateLimit({
  windowMs,
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isConversionStatusRequest,
});

export const conversionStatusLimiter = rateLimit({
  windowMs,
  // Ten supported jobs polling every 1.5 seconds make 6,000 reads/window.
  max: CONVERSION_STATUS_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
});
