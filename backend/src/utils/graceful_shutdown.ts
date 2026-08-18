import type { Server } from 'http';

export interface ShutdownDependencies {
  getServer: () => Server | null;
  stopWorkers: () => Promise<void>;
  closeRedis: () => Promise<void>;
  disconnectPrisma: () => Promise<void>;
  graceMs: number;
}

async function drainServer(server: Server | null, graceMs: number): Promise<void> {
  if (!server) return;
  server.closeIdleConnections?.();
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (forceTimer) clearTimeout(forceTimer);
      resolve();
    };
    server.close(error => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
        console.error('HTTP server close failed:', error);
      }
      finish();
    });
    forceTimer = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, graceMs);
  });
}

export function createShutdownHandler(dependencies: ShutdownDependencies) {
  let shutdownPromise: Promise<void> | null = null;
  return (exitCode: number): Promise<void> => {
    if (shutdownPromise) {
      if (exitCode !== 0) process.exitCode = exitCode;
      return shutdownPromise;
    }
    process.exitCode = exitCode;
    shutdownPromise = (async () => {
      const server = dependencies.getServer();
      const [httpResult, workerResult] = await Promise.allSettled([
        drainServer(server, dependencies.graceMs),
        dependencies.stopWorkers(),
      ]);
      if (httpResult.status === 'rejected') console.error('HTTP drain failed:', httpResult.reason);
      if (workerResult.status === 'rejected') console.error('Worker shutdown failed:', workerResult.reason);
      const redisResult = await Promise.allSettled([dependencies.closeRedis()]);
      if (redisResult[0].status === 'rejected') console.error('Redis shutdown failed:', redisResult[0].reason);
      const prismaResult = await Promise.allSettled([dependencies.disconnectPrisma()]);
      if (prismaResult[0].status === 'rejected') console.error('Prisma shutdown failed:', prismaResult[0].reason);
    })();
    return shutdownPromise;
  };
}
