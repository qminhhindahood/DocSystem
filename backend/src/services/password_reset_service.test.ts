import { createHash } from 'node:crypto';
import {
  requestPasswordReset,
  resetPassword,
  type PasswordResetDependencies,
} from './password_reset_service';

const now = new Date('2026-08-09T12:00:00.000Z');

function dependencies(): PasswordResetDependencies & Record<string, jest.Mock> {
  return {
    now: jest.fn(() => now),
    randomBytes: jest.fn(() => Buffer.alloc(32, 7)),
    findUserByEmail: jest.fn().mockResolvedValue({
      id: 'user-1', email: 'owner@example.com', isDisabled: false,
    }),
    hasRecentToken: jest.fn().mockResolvedValue(false),
    invalidateOpenTokens: jest.fn().mockResolvedValue(undefined),
    createToken: jest.fn().mockResolvedValue(undefined),
    invalidateToken: jest.fn().mockResolvedValue(undefined),
    sendResetEmail: jest.fn().mockResolvedValue(undefined),
    hashPassword: jest.fn().mockResolvedValue('bcrypt-hash'),
    claimAndReset: jest.fn().mockResolvedValue(true),
    logError: jest.fn(),
  };
}

describe('password reset request', () => {
  it('stores only a SHA-256 hash of a 32-byte base64url token with a 30-minute expiry', async () => {
    const deps = dependencies();

    await expect(requestPasswordReset(' Owner@Example.COM ', deps)).resolves.toEqual({ accepted: true });

    const rawToken = Buffer.alloc(32, 7).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    expect(deps.findUserByEmail).toHaveBeenCalledWith('owner@example.com');
    expect(deps.hasRecentToken).toHaveBeenCalledWith('user-1', new Date(now.getTime() - 60_000));
    expect(deps.invalidateOpenTokens).toHaveBeenCalledWith('user-1', now);
    expect(deps.createToken).toHaveBeenCalledWith({
      userId: 'user-1', tokenHash, expiresAt: new Date(now.getTime() + 30 * 60_000),
    });
    expect(deps.sendResetEmail).toHaveBeenCalledWith('owner@example.com', rawToken);
    expect(JSON.stringify(deps.createToken.mock.calls)).not.toContain(rawToken);
  });

  it.each([
    ['missing', null],
    ['disabled', { id: 'user-1', email: 'owner@example.com', isDisabled: true }],
    ['email-null', { id: 'user-1', email: null, isDisabled: false }],
  ])('returns the identical public result for a %s account', async (_name, user) => {
    const deps = dependencies();
    deps.findUserByEmail.mockResolvedValue(user);

    await expect(requestPasswordReset('owner@example.com', deps)).resolves.toEqual({ accepted: true });

    expect(deps.createToken).not.toHaveBeenCalled();
    expect(deps.sendResetEmail).not.toHaveBeenCalled();
  });

  it('honors the 60-second cooldown without revealing it publicly', async () => {
    const deps = dependencies();
    deps.hasRecentToken.mockResolvedValue(true);

    await expect(requestPasswordReset('owner@example.com', deps)).resolves.toEqual({ accepted: true });

    expect(deps.invalidateOpenTokens).not.toHaveBeenCalled();
    expect(deps.createToken).not.toHaveBeenCalled();
  });

  it('invalidates a newly stored token when SMTP delivery fails', async () => {
    const deps = dependencies();
    deps.sendResetEmail.mockRejectedValue(new Error('smtp password=secret reset=https://example.test/token'));

    await expect(requestPasswordReset('owner@example.com', deps)).resolves.toEqual({ accepted: true });

    const tokenHash = createHash('sha256').update(Buffer.alloc(32, 7).toString('base64url')).digest('hex');
    expect(deps.invalidateToken).toHaveBeenCalledWith(tokenHash, now);
    expect(deps.logError).toHaveBeenCalledWith('Password reset email delivery failed');
    expect(JSON.stringify(deps.logError.mock.calls)).not.toContain('secret');
  });
});

describe('password reset claim', () => {
  it('hashes the new password and atomically claims the token while revoking sessions', async () => {
    const deps = dependencies();
    const rawToken = Buffer.alloc(32, 9).toString('base64url');

    await expect(resetPassword(rawToken, 'new-password-123', deps)).resolves.toEqual({ success: true });

    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    expect(deps.hashPassword).toHaveBeenCalledWith('new-password-123');
    expect(deps.claimAndReset).toHaveBeenCalledWith({ tokenHash, passwordHash: 'bcrypt-hash', now });
  });

  it('allows only one successful concurrent claim', async () => {
    const deps = dependencies();
    deps.claimAndReset.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const rawToken = Buffer.alloc(32, 9).toString('base64url');

    const results = await Promise.allSettled([
      resetPassword(rawToken, 'new-password-123', deps),
      resetPassword(rawToken, 'new-password-123', deps),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  });

  it.each([
    ['malformed token', 'not base64url!', 'new-password-123'],
    ['short password', Buffer.alloc(32, 9).toString('base64url'), 'short'],
  ])('rejects a %s before a database claim', async (_name, token, password) => {
    const deps = dependencies();

    await expect(resetPassword(token, password, deps)).rejects.toThrow(/invalid|password/i);

    expect(deps.claimAndReset).not.toHaveBeenCalled();
  });
});
