const mockQueryRaw = jest.fn();
const mockRedisConnected = jest.fn();
const mockConversionHealthy = jest.fn();

jest.mock('../utils/prisma', () => ({ prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) } }));
jest.mock('../utils/redis', () => ({
  redisClient: {
    isFallback: false,
    isConnected: (...args: unknown[]) => mockRedisConnected(...args),
  },
}));
jest.mock('./conversion_service_client', () => ({
  conversionServiceHealthy: (...args: unknown[]) => mockConversionHealthy(...args),
}));

import { checkReadiness } from './readiness_service';

describe('readiness service (standalone stack)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CONVERSION_SERVICE_URL = 'http://conversion:8004';
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockRedisConnected.mockResolvedValue(true);
    mockConversionHealthy.mockResolvedValue(true);
  });

  it('probes only database, redis, and the conversion service', async () => {
    const report = await checkReadiness({});
    expect(report.status).toBe('ok');
    expect(report.services).toEqual({
      database: 'healthy', redis: 'healthy', conversion: 'healthy',
    });
  });

  it('is degraded when the conversion service is down', async () => {
    mockConversionHealthy.mockResolvedValue(false);
    const report = await checkReadiness({});
    expect(report.status).toBe('degraded');
    expect(report.services.conversion).toBe('unhealthy');
  });

  it('returns promptly and degraded when the database probe hangs', async () => {
    mockQueryRaw.mockReturnValue(new Promise(() => undefined));
    const started = Date.now();
    const report = await checkReadiness({ timeoutMs: 20 });
    expect(Date.now() - started).toBeLessThan(500);
    expect(report.status).toBe('degraded');
    expect(report.services.database).toBe('unhealthy');
  });
});
