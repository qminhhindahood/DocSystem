import 'dotenv/config';
import { hashPassword } from '../middleware/user_auth';
import { prisma } from '../utils/prisma';
import { normalizeUsername, validateAccountPassword } from '../utils/validateEnv';

export interface ResetOperatorDependencies {
  findUsers(username: string): Promise<Array<{ id: string; username: string; isDisabled: boolean }>>;
  hashPassword(password: string): Promise<string>;
  commitReset(input: { userId: string; passwordHash: string; usedAt: Date }): Promise<void>;
  now(): Date;
  log(message: string): void;
}

const productionDependencies: ResetOperatorDependencies = {
  findUsers: (username) => prisma.user.findMany({
    where: { username },
    select: { id: true, username: true, isDisabled: true },
  }),
  hashPassword,
  commitReset: async (input) => {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: input.userId },
        data: { passwordHash: input.passwordHash, sessionVersion: { increment: 1 } },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: input.userId, usedAt: null },
        data: { usedAt: input.usedAt },
      });
    });
  },
  now: () => new Date(),
  log: (message) => console.log(message),
};

export async function resetOperatorPassword(
  input: { username: string; password: string },
  deps: ResetOperatorDependencies = productionDependencies,
): Promise<{ userId: string }> {
  const username = normalizeUsername(input.username);
  const password = validateAccountPassword(input.password);
  const users = await deps.findUsers(username);
  if (users.length !== 1 || users[0].username !== username || users[0].isDisabled) {
    throw new Error('Operator password reset refused: canonical enabled operator was not found exactly once');
  }
  const passwordHash = await deps.hashPassword(password);
  await deps.commitReset({ userId: users[0].id, passwordHash, usedAt: deps.now() });
  deps.log(`Operator password reset completed for user ${users[0].id}.`);
  return { userId: users[0].id };
}

async function main(): Promise<void> {
  await resetOperatorPassword({
    username: process.env.RESET_USERNAME ?? '',
    password: process.env.RESET_PASSWORD ?? '',
  });
}

if (require.main === module) {
  void main().catch(() => {
    console.error('Operator password reset failed');
    process.exitCode = 1;
  });
}
