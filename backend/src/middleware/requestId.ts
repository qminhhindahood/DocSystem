/**
 * Request ID Middleware
 * Attaches a short unique request ID to every request for log correlation.
 * Adds X-Request-ID header to responses and req.id for downstream use.
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

// M16: validate client-supplied X-Request-ID to prevent log injection.
// Accept only short, URL-safe tokens; otherwise generate a fresh id.
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && REQUEST_ID_RE.test(incoming)
      ? incoming
      : uuidv4().slice(0, 8);
  req.id = id;
  res.setHeader('X-Request-ID', id);
  next();
}
