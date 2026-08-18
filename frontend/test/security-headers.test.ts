import { describe, expect, it } from 'vitest';

describe('Next security configuration', () => {
  it('disables the framework banner and configures browser defenses', async () => {
    const config = (await import('@/next.config.js')).default;
    expect(config.poweredByHeader).toBe(false);
    expect(config.output).toBe('standalone');

    const rules = await config.headers();
    const rule = rules[0];
    if (!rule) throw new Error('Expected a global header rule');
    const headers = new Map(rule.headers.map((header: { key: string; value: string }) => [header.key, header.value]));
    expect(headers.get('Content-Security-Policy')).toContain("worker-src 'self' blob:");
    expect(headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
  });
});
