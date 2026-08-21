jest.mock('./middleware/request_logging', () => ({
  requestLoggingMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { app } from './index';
import { withHttpServer } from './test/http';

describe('conversion status rate limiting', () => {
  it('keeps general protection while allowing the supported polling workflow', async () => {
    await withHttpServer(app, async (baseUrl) => {
      const generalStatuses = await Promise.all(
        Array.from({ length: 101 }, async () => {
          const response = await fetch(`${baseUrl}/api/missing`);
          return response.status;
        }),
      );
      expect(generalStatuses).toContain(429);

      const pollingStatuses = await Promise.all(
        Array.from({ length: 101 }, async (_, index) => {
          const response = await fetch(`${baseUrl}/api/convert/job-${index}`);
          return response.status;
        }),
      );

      expect(pollingStatuses).not.toContain(429);
      expect(new Set(pollingStatuses)).toEqual(new Set([401]));
    });
  }, 15_000);
});
