jest.mock('../utils/prisma', () => ({
  prisma: {
    user: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../middleware/user_auth', () => ({
  hashPassword: jest.fn(),
}));

import { hashPassword } from '../middleware/user_auth';
import { prisma } from '../utils/prisma';
import {
  resetOperatorPassword,
  type ResetOperatorDependencies,
} from './reset_operator_password';

const mockFindMany = prisma.user.findMany as jest.Mock;
const mockTransaction = prisma.$transaction as jest.Mock;
const mockProductionHash = hashPassword as jest.Mock;
const mockUserUpdate = jest.fn();
const mockTokenUpdateMany = jest.fn();

function dependencies() {
  const deps: ResetOperatorDependencies & {
    findUsers: jest.Mock;
    hashPassword: jest.Mock;
    commitReset: jest.Mock;
    now: jest.Mock;
    log: jest.Mock;
  } = {
    findUsers: jest.fn(),
    hashPassword: jest.fn().mockResolvedValue('bcrypt-hash'),
    commitReset: jest.fn().mockResolvedValue(undefined),
    now: jest.fn().mockReturnValue(new Date('2026-08-11T00:00:00.000Z')),
    log: jest.fn(),
  };
  return deps;
}

describe('operator password reset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => callback({
      user: { update: mockUserUpdate },
      passwordResetToken: { updateMany: mockTokenUpdateMany },
    }));
    mockProductionHash.mockResolvedValue('production-hash');
    mockUserUpdate.mockResolvedValue({ id: 'operator-1' });
    mockTokenUpdateMany.mockResolvedValue({ count: 2 });
  });

  it('resets exactly one enabled canonical operator', async () => {
    const deps = dependencies();
    deps.findUsers.mockResolvedValue([{ id: 'operator-1', username: 'owner', isDisabled: false }]);

    await expect(resetOperatorPassword({ username: ' owner ', password: 'new-password-123' }, deps))
      .resolves.toEqual({ userId: 'operator-1' });

    expect(deps.findUsers).toHaveBeenCalledWith('owner');
    expect(deps.hashPassword).toHaveBeenCalledWith('new-password-123');
    expect(deps.commitReset).toHaveBeenCalledWith({
      userId: 'operator-1',
      passwordHash: 'bcrypt-hash',
      usedAt: new Date('2026-08-11T00:00:00.000Z'),
    });
  });

  it.each([
    ['missing', []],
    ['ambiguous', [
      { id: 'operator-1', username: 'owner', isDisabled: false },
      { id: 'operator-2', username: 'owner', isDisabled: false },
    ]],
    ['disabled', [{ id: 'operator-1', username: 'owner', isDisabled: true }]],
  ])('rejects a %s operator without hashing or mutation', async (_caseName, users) => {
    const deps = dependencies();
    deps.findUsers.mockResolvedValue(users);

    await expect(resetOperatorPassword({ username: 'owner', password: 'new-password-123' }, deps))
      .rejects.toThrow(/operator/i);

    expect(deps.hashPassword).not.toHaveBeenCalled();
    expect(deps.commitReset).not.toHaveBeenCalled();
  });

  it('never logs credential material', async () => {
    const deps = dependencies();
    deps.findUsers.mockResolvedValue([{ id: 'operator-1', username: 'owner', isDisabled: false }]);

    await resetOperatorPassword({ username: 'owner', password: 'new-password-123' }, deps);

    expect(JSON.stringify(deps.log.mock.calls)).not.toMatch(/owner|new-password-123|bcrypt-hash/);
  });

  it('updates the password, session version, and unused reset tokens in one transaction', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    mockFindMany.mockResolvedValue([{ id: 'operator-1', username: 'owner', isDisabled: false }]);

    try {
      await resetOperatorPassword({ username: 'owner', password: 'new-password-123' });
    } finally {
      log.mockRestore();
    }

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'operator-1' },
      data: { passwordHash: 'production-hash', sessionVersion: { increment: 1 } },
    });
    expect(mockTokenUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'operator-1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });
});
