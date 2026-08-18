/** User authentication middleware for database-revalidated user sessions. */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';

const getJwtSecret = () => process.env.JWT_SECRET || '';
const USER_TOKEN_CLAIMS = new Set([
  'userId',
  'username',
  'tokenUse',
  'sessionVersion',
  'iat',
  'exp',
  'iss',
  'aud',
]);

export interface AuthPayload {
  userId: string;
  username: string;
  tokenUse: 'user';
  sessionVersion: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export async function verifyUserToken(token: string): Promise<AuthPayload> {
  const jwtSecret = getJwtSecret();
  if (!jwtSecret) throw new Error('JWT secret is not configured');

  const verified = jwt.verify(token, jwtSecret, {
    algorithms: ['HS256'],
    issuer: 'ai-document-system',
    audience: 'ai-document-api',
  });

  if (typeof verified !== 'object' || verified === null || Array.isArray(verified)) {
    throw new Error('Invalid token claims');
  }
  const claims = verified as Record<string, unknown>;

  if (
    Object.keys(claims).some((claim) => !USER_TOKEN_CLAIMS.has(claim)) ||
    claims.tokenUse !== 'user' ||
    typeof claims.userId !== 'string' ||
    typeof claims.username !== 'string' ||
    (claims.sessionVersion !== undefined
      && (!Number.isSafeInteger(claims.sessionVersion) || Number(claims.sessionVersion) < 0))
  ) {
    throw new Error('Invalid token claims');
  }

  const account = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, username: true, isDisabled: true, sessionVersion: true },
  });
  const tokenSessionVersion = claims.sessionVersion === undefined ? 0 : Number(claims.sessionVersion);
  if (!account || account.isDisabled || account.username !== claims.username
    || account.sessionVersion !== tokenSessionVersion) {
    throw new Error('Inactive account');
  }

  return {
    userId: account.id,
    username: account.username,
    tokenUse: 'user',
    sessionVersion: account.sessionVersion,
  };
}

/** Verify a required user session from the Authorization header. */
export async function userAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization token' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    req.user = await verifyUserToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Attach a valid user session when supplied, while allowing an absent session. */
export async function optionalUserAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (authHeader === undefined) {
    next();
    return;
  }
  if (!authHeader.startsWith('Bearer ') || authHeader.slice(7).trim() === '') {
    res.status(401).json({ error: 'Missing or invalid authorization token' });
    return;
  }

  try {
    req.user = await verifyUserToken(authHeader.slice(7));
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Require authentication (any logged-in user)
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

/**
 * Generate JWT token for a user
 */
export function generateToken(user: { userId: string; username: string; sessionVersion?: number }): string {
  const jwtSecret = getJwtSecret();
  if (!jwtSecret) throw new Error('JWT secret is not configured');
  return jwt.sign({
    userId: user.userId,
    username: user.username,
    tokenUse: 'user',
    sessionVersion: user.sessionVersion ?? 0,
  }, jwtSecret, {
    expiresIn: '7d',
    issuer: 'ai-document-system',
    audience: 'ai-document-api',
  });
}

/**
 * Hash password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  const bcrypt = await import('bcrypt');
  return bcrypt.hash(password, 12);
}

/**
 * Verify password against hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const bcrypt = await import('bcrypt');
  return bcrypt.compare(password, hash);
}
