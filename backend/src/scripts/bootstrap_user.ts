import 'dotenv/config';
import { prisma } from '../utils/prisma';
import { hashPassword } from '../middleware/user_auth';
import { normalizeAccountCredentials, type AccountCredentials } from '../utils/validateEnv';

export interface BootstrapUserRecord {
  id: string;
  username: string;
  email: string | null;
}

export interface BootstrapUserDependencies {
  findMatchingUsers(username: string, email: string): Promise<BootstrapUserRecord[]>;
  hashPassword(password: string): Promise<string>;
  createUser(input: {
    username: string;
    email: string;
    passwordHash: string;
  }): Promise<BootstrapUserRecord>;
  log(message: string): void;
}

export interface BootstrapUserResult {
  created: boolean;
  userId: string;
}

type UserClientWithEmail = {
  findMany(args: unknown): Promise<BootstrapUserRecord[]>;
  create(args: unknown): Promise<BootstrapUserRecord>;
};

const userClient = prisma.user as unknown as UserClientWithEmail;

const productionDependencies: BootstrapUserDependencies = {
  findMatchingUsers: (username, email) => userClient.findMany({
    where: { OR: [{ username }, { email }] },
    select: { id: true, username: true, email: true },
  }),
  hashPassword,
  createUser: ({ username, email, passwordHash }) => userClient.create({
    data: { username, email, passwordHash },
    select: { id: true, username: true, email: true },
  }),
  log: (message) => console.log(message),
};

export async function bootstrapUser(
  input: AccountCredentials,
  deps: BootstrapUserDependencies = productionDependencies,
): Promise<BootstrapUserResult> {
  const credentials = normalizeAccountCredentials(input);
  const matches = await deps.findMatchingUsers(credentials.username, credentials.email);

  if (matches.length === 1
    && matches[0].username === credentials.username
    && matches[0].email?.toLowerCase() === credentials.email) {
    deps.log(`Operator bootstrap is already complete for user ${matches[0].id}.`);
    return { created: false, userId: matches[0].id };
  }
  if (matches.length > 0) {
    throw new Error('Operator bootstrap identity conflict: username or email belongs to another account');
  }

  const passwordHash = await deps.hashPassword(credentials.password);
  const user = await deps.createUser({
    username: credentials.username,
    email: credentials.email,
    passwordHash,
  });
  deps.log(`Operator bootstrap created user ${user.id}.`);
  return { created: true, userId: user.id };
}

async function main(): Promise<void> {
  await bootstrapUser({
    username: process.env.BOOTSTRAP_USERNAME ?? '',
    email: process.env.BOOTSTRAP_EMAIL ?? '',
    password: process.env.BOOTSTRAP_PASSWORD ?? '',
  });
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Operator bootstrap failed');
    process.exitCode = 1;
  });
}
