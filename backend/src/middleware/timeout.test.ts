import express from 'express';
import { fastTimeout, requestTimeout } from './timeout';
import { withHttpServer } from '../test/http';

describe('requestTimeout middleware', () => {
  it('lets normal requests continue to the next handler', async () => {
    const app = express();
    app.use(fastTimeout);
    app.get('/ok', (req, res) => res.json({ ok: true }));
    app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
      res.status(500).json({ error: String(error) });
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/ok`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    });
  });

  it('returns 408 when a request does not finish before the deadline', async () => {
    let observedAbort = false;
    const app = express();
    app.use(requestTimeout({ ms: 10, message: 'Too slow' }));
    app.get('/hang', (req) => {
      req.abortSignal.addEventListener('abort', () => { observedAbort = true; });
      // Intentionally leave the request open.
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/hang`);

      expect(response.status).toBe(408);
      await expect(response.json()).resolves.toMatchObject({
        error: 'Too slow',
        timeout: 10,
        path: '/hang',
      });
      expect(observedAbort).toBe(true);
    });
  });
});
