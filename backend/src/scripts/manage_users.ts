import 'dotenv/config';
import { prisma } from '../utils/prisma';
import { normalizeUsername } from '../utils/validateEnv';

export type UserAdminAction = 'list' | 'disable' | 'enable' | 'delete';

export interface SafeUserSummary {
  id: string;
  username: string;
  email: string | null;
  role: string;
  isDisabled: boolean;
  createdAt: Date;
}

export interface ManageUsersDependencies {
  listUsers(): Promise<SafeUserSummary[]>;
  findUsers(username: string): Promise<Array<{
    id: string;
    username: string;
    isDisabled: boolean;
  }>>;
  setDisabled(userId: string, disabled: boolean): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  log(message: string): void;
}

const productionDependencies: ManageUsersDependencies = {
  listUsers: () => prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      isDisabled: true,
      createdAt: true,
    },
  }),
  findUsers: (username) => prisma.user.findMany({
    where: { username },
    select: { id: true, username: true, isDisabled: true },
  }),
  setDisabled: async (userId, disabled) => {
    await prisma.user.update({
      where: { id: userId },
      data: { isDisabled: disabled, sessionVersion: { increment: 1 } },
    });
  },
  deleteUser: async (userId) => {
    await prisma.$transaction(async (tx) => {
      await tx.user.delete({ where: { id: userId } });
    });
  },
  log: (message) => console.log(message),
};

function parseAction(raw: string): UserAdminAction {
  if (raw === 'list' || raw === 'disable' || raw === 'enable' || raw === 'delete') {
    return raw;
  }
  throw new Error('USER_ADMIN_ACTION must be list, disable, enable, or delete');
}

export async function manageUsers(
  input: { action: string; username: string; confirm: string },
  deps: ManageUsersDependencies = productionDependencies,
): Promise<void> {
  const action = parseAction(input.action);
  if (action === 'list') {
    deps.log(JSON.stringify({ users: await deps.listUsers() }));
    return;
  }

  const username = normalizeUsername(input.username);
  const users = await deps.findUsers(username);
  if (users.length !== 1 || users[0].username !== username) {
    throw new Error('User management refused: canonical user was not found exactly once');
  }
  const user = users[0];
  if (action === 'delete') {
    if (input.confirm !== username) {
      throw new Error('Deletion confirmation must exactly match the canonical username');
    }
    await deps.deleteUser(user.id);
  } else {
    await deps.setDisabled(user.id, action === 'disable');
  }
  deps.log(JSON.stringify({ action, userId: user.id, success: true }));
}

async function main(): Promise<void> {
  await manageUsers({
    action: process.env.USER_ADMIN_ACTION ?? '',
    username: process.env.USER_ADMIN_USERNAME ?? '',
    confirm: process.env.USER_ADMIN_CONFIRM ?? '',
  });
}

if (require.main === module) {
  void main().catch(() => {
    console.error('User management failed');
    process.exitCode = 1;
  });
}
