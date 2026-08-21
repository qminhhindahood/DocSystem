jest.mock('./middleware/request_logging', () => ({
  requestLoggingMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { app } from './index';
import {
  CONVERSION_STATUS_RATE_LIMIT_MAX,
  SUPPORTED_BULK_POLL_REQUESTS_PER_WINDOW,
  supportedBulkPollRequests,
} from './middleware/conversion_status_limiter';
import { withHttpServer } from './test/http';

describe('conversion status rate limiting', () => {
  it('budgets the full sustained ten-job polling window', () => {
    expect(SUPPORTED_BULK_POLL_REQUESTS_PER_WINDOW).toBe(6_000);
    expect(CONVERSION_STATUS_RATE_LIMIT_MAX).toBeGreaterThan(
      SUPPORTED_BULK_POLL_REQUESTS_PER_WINDOW,
    );
    expect(supportedBulkPollRequests(30 * 60 * 1_000)).toBe(12_000);
  });
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
