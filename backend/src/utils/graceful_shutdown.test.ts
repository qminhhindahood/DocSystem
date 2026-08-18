import { createShutdownHandler } from './graceful_shutdown';

describe('graceful shutdown', () => {
  const originalExitCode = process.exitCode;
  afterEach(() => {
    process.exitCode = originalExitCode;
    jest.useRealTimers();
  });

  it('stops accepting HTTP, waits for drain/workers, then closes Redis and Prisma without process.exit', async () => {
    const events: string[] = [];
    const server = {
      closeIdleConnections: jest.fn(() => events.push('idle-closed')),
      closeAllConnections: jest.fn(),
      close: jest.fn((callback: (error?: Error) => void) => {
        events.push('http-close');
        setImmediate(() => { events.push('http-drained'); callback(); });
      }),
    } as any;
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const shutdown = createShutdownHandler({
      getServer: () => server,
      stopWorkers: async () => { events.push('workers-stopped'); },
      closeRedis: async () => { events.push('redis-closed'); },
      disconnectPrisma: async () => { events.push('prisma-disconnected'); },
      graceMs: 1_000,
    });

    await Promise.all([shutdown(0), shutdown(0)]);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(events.indexOf('redis-closed')).toBeGreaterThan(events.indexOf('http-drained'));
    expect(events.indexOf('redis-closed')).toBeGreaterThan(events.indexOf('workers-stopped'));
    expect(events.indexOf('prisma-disconnected')).toBeGreaterThan(events.indexOf('redis-closed'));
    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it('force-closes connections after the drain deadline', async () => {
    jest.useFakeTimers();
    const server = {
      closeIdleConnections: jest.fn(),
      closeAllConnections: jest.fn(),
      close: jest.fn(),
    } as any;
    const shutdown = createShutdownHandler({
      getServer: () => server,
      stopWorkers: async () => undefined,
      closeRedis: async () => undefined,
      disconnectPrisma: async () => undefined,
      graceMs: 100,
    });
    const result = shutdown(1);
    await jest.advanceTimersByTimeAsync(100);
    await result;
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });
});
