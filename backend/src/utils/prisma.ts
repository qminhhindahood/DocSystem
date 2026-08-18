import { PrismaClient } from '@prisma/client';

type PrismaLogLevel = 'query' | 'info' | 'warn' | 'error';

export function prismaLogLevels(
  nodeEnv: string | undefined,
  logQueries: string | undefined,
): PrismaLogLevel[] {
  if (nodeEnv === 'production') return ['error'];
  return logQueries === 'true' ? ['query', 'error', 'warn'] : ['error', 'warn'];
}

// Global variable to store singleton instance
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: prismaLogLevels(process.env.NODE_ENV, process.env.PRISMA_LOG_QUERIES),
  datasources: {
    db: {
      url: (() => {
        const baseUrl = process.env.DATABASE_URL || '';
        const separator = baseUrl.includes('?') ? '&' : '?';
        const connectionLimit = process.env.DB_CONNECTION_LIMIT || '20';
        return `${baseUrl}${separator}connection_limit=${connectionLimit}`;
      })(),
    },
  },
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Graceful shutdown
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

process.on('beforeExit', async () => {
  await disconnectPrisma();
});
