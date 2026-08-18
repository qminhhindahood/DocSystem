import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { deriveClientIp } from '@/lib/server/client-ip';

afterEach(() => vi.unstubAllEnvs());

describe('deriveClientIp', () => {
  it('reads the client address from the trusted forwarding chain', () => {
    vi.stubEnv('FRONTEND_TRUST_PROXY_HOPS', '1');
    const request = new NextRequest('https://app.example/api/session/signup', {
      headers: { 'x-forwarded-for': '203.0.113.8, 10.0.0.2' },
    });
    expect(deriveClientIp(request)).toBe('203.0.113.8');
  });

  it('fails closed when forwarding hops are not configured or the value is invalid', () => {
    expect(deriveClientIp(new NextRequest('https://app.example/api/session/signup', {
      headers: { 'x-forwarded-for': '203.0.113.8', 'x-docai-client-ip': '198.51.100.2' },
    }))).toBeUndefined();

    vi.stubEnv('FRONTEND_TRUST_PROXY_HOPS', '1');
    expect(deriveClientIp(new NextRequest('https://app.example/api/session/signup', {
      headers: { 'x-forwarded-for': 'not-an-ip' },
    }))).toBeUndefined();
  });
});
