/**
 * ratelimit.config.test.ts — upload-limiter burst headroom (ticket 01).
 *
 * A pilot user converting ~50 docs/day does so in bursts; the old hardcoded
 * 20 uploads / 15 min rate-limited a legitimate 50/day burst at ~5 uploads
 * in 5 minutes. The limiter must (a) default to headroom above the daily
 * quota (60/15min), and (b) be env-tunable per deployment.
 *
 * Env-dependent module tests require fresh module state: jest.resetModules()
 * + require() after setting the env, mirroring
 * convert.upload_errors.contract.test.ts.
 */

const WINDOW_MS = 15 * 60_000;

function loadLimiter() {
  let mod: typeof import('./ratelimit');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('./ratelimit');
  });
  return mod!;
}

describe('upload limiter burst headroom (ticket 01)', () => {
  const ORIGIN_ENV = { ...process.env };

  afterEach(() => {
    process.env = ORIGIN_ENV;
    delete process.env.UPLOAD_RATE_LIMIT_MAX;
  });

  it('defaults to 60 requests / 15 min — above the 50/day pilot quota', () => {
    delete process.env.UPLOAD_RATE_LIMIT_MAX;
    const { UPLOAD_RATE_LIMIT_MAX } = loadLimiter();
    expect(UPLOAD_RATE_LIMIT_MAX).toBe(60);
    expect(UPLOAD_RATE_LIMIT_MAX).toBeGreaterThan(50);
  });

  it('honors UPLOAD_RATE_LIMIT_MAX from the environment', () => {
    process.env.UPLOAD_RATE_LIMIT_MAX = '120';
    const { UPLOAD_RATE_LIMIT_MAX } = loadLimiter();
    expect(UPLOAD_RATE_LIMIT_MAX).toBe(120);
  });

  it('rejects invalid UPLOAD_RATE_LIMIT_MAX values loudly (NaN)', () => {
    process.env.UPLOAD_RATE_LIMIT_MAX = 'bogus';
    expect(() => loadLimiter()).toThrow(/UPLOAD_RATE_LIMIT_MAX/);
  });

  it('rejects non-decimal numerics (hex/scientific) like Python int() does', () => {
    // Number() alone would accept these; the decimal-strict regex must not.
    for (const raw of ['0x10', '1e2', ' 60 ', '+60', '60.0']) {
      process.env.UPLOAD_RATE_LIMIT_MAX = raw;
      expect(() => loadLimiter()).toThrow(/UPLOAD_RATE_LIMIT_MAX/);
    }
  });

  it('rejects non-positive UPLOAD_RATE_LIMIT_MAX values loudly', () => {
    process.env.UPLOAD_RATE_LIMIT_MAX = '0';
    expect(() => loadLimiter()).toThrow(/UPLOAD_RATE_LIMIT_MAX/);
  });

  it('keeps the 15-minute window for the upload limiter', () => {
    const { UPLOAD_RATE_WINDOW_MS } = loadLimiter();
    expect(UPLOAD_RATE_WINDOW_MS).toBe(WINDOW_MS);
  });
});
