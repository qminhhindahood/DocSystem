import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';
import { prisma } from '../utils/prisma';
import { hashPassword } from '../middleware/user_auth';
import { sendPasswordResetEmail } from './password_reset_mailer';

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 30 * 60_000;
const REQUEST_COOLDOWN_MS = 60_000;

export interface PasswordResetDependencies {
  now(): Date;
  randomBytes(size: number): Buffer;
  findUserByEmail(email: string): Promise<{ id: string; email: string | null; isDisabled: boolean } | null>;
  hasRecentToken(userId: string, createdAfter: Date): Promise<boolean>;
  invalidateOpenTokens(userId: string, usedAt: Date): Promise<void>;
  createToken(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  invalidateToken(tokenHash: string, usedAt: Date): Promise<void>;
  sendResetEmail(email: string, rawToken: string): Promise<void>;
  hashPassword(password: string): Promise<string>;
  claimAndReset(input: { tokenHash: string; passwordHash: string; now: Date }): Promise<boolean>;
  logError(message: string): void;
}

type ResetDatabase = {
  user: {
    findUnique(args: unknown): Promise<{ id: string; email: string | null; isDisabled: boolean } | null>;
    update(args: unknown): Promise<unknown>;
  };
  passwordResetToken: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    findUnique(args: unknown): Promise<{ userId: string } | null>;
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  $transaction<T>(work: (tx: ResetDatabase) => Promise<T>): Promise<T>;
};

const database = prisma as unknown as ResetDatabase;

function tokenHash(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function isCanonicalResetToken(rawToken: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return false;
  const decoded = Buffer.from(rawToken, 'base64url');
  return decoded.length === TOKEN_BYTES && decoded.toString('base64url') === rawToken;
}

const productionDependencies: PasswordResetDependencies = {
  now: () => new Date(),
  randomBytes: nodeRandomBytes,
  findUserByEmail: (email) => database.user.findUnique({
    where: { email },
    select: { id: true, email: true, isDisabled: true },
  }),
  hasRecentToken: async (userId, createdAfter) => Boolean(await database.passwordResetToken.findFirst({
    where: { userId, usedAt: null, createdAt: { gte: createdAfter } },
    select: { id: true },
  })),
  invalidateOpenTokens: async (userId, usedAt) => {
    await database.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt } });
  },
  createToken: async (input) => {
    await database.passwordResetToken.create({ data: input });
  },
  invalidateToken: async (hash, usedAt) => {
    await database.passwordResetToken.updateMany({
      where: { tokenHash: hash, usedAt: null },
      data: { usedAt },
    });
  },
  sendResetEmail: async (email, rawToken) => {
    await sendPasswordResetEmail(email, rawToken);
  },
  hashPassword,
  claimAndReset: (input) => database.$transaction(async (tx) => {
    const claim = await tx.passwordResetToken.updateMany({
      where: { tokenHash: input.tokenHash, usedAt: null, expiresAt: { gt: input.now } },
      data: { usedAt: input.now },
    });
    if (claim.count !== 1) return false;

    const token = await tx.passwordResetToken.findUnique({
      where: { tokenHash: input.tokenHash },
      select: { userId: true },
    });
    if (!token) return false;

    await tx.user.update({
      where: { id: token.userId },
      data: { passwordHash: input.passwordHash, sessionVersion: { increment: 1 } },
    });
    await tx.passwordResetToken.updateMany({
      where: { userId: token.userId, usedAt: null },
      data: { usedAt: input.now },
    });
    return true;
  }),
  logError: (message) => console.error(message),
};

export async function requestPasswordReset(
  rawEmail: string,
  deps: PasswordResetDependencies = productionDependencies,
): Promise<{ accepted: true }> {
  const email = rawEmail.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { accepted: true };

  const user = await deps.findUserByEmail(email);
  if (!user || user.isDisabled || !user.email) return { accepted: true };

  const now = deps.now();
  if (await deps.hasRecentToken(user.id, new Date(now.getTime() - REQUEST_COOLDOWN_MS))) {
    return { accepted: true };
  }

  const rawToken = deps.randomBytes(TOKEN_BYTES).toString('base64url');
  const hash = tokenHash(rawToken);
  await deps.invalidateOpenTokens(user.id, now);
  await deps.createToken({
    userId: user.id,
    tokenHash: hash,
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
  });

  try {
    await deps.sendResetEmail(user.email, rawToken);
  } catch {
    await deps.invalidateToken(hash, now);
    deps.logError('Password reset email delivery failed');
  }
  return { accepted: true };
}

export async function resetPassword(
  rawToken: string,
  newPassword: string,
  deps: PasswordResetDependencies = productionDependencies,
): Promise<{ success: true }> {
  if (!isCanonicalResetToken(rawToken)) throw new Error('Invalid or expired password reset token');
  if (newPassword.length < 8 || newPassword.length > 100) {
    throw new Error('Password must contain between 8 and 100 characters');
  }

  const passwordHash = await deps.hashPassword(newPassword);
  const claimed = await deps.claimAndReset({
    tokenHash: tokenHash(rawToken),
    passwordHash,
    now: deps.now(),
  });
  if (!claimed) throw new Error('Invalid or expired password reset token');
  return { success: true };
}
