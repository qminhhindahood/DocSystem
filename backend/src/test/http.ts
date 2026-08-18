import type { Express } from 'express';
import { Server } from 'http';

export async function withHttpServer<T>(
  app: Express,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to determine test server address');
    }

    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}
