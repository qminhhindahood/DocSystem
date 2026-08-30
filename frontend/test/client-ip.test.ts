import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { deriveClientIp } from '@/lib/server/client-ip';

afterEach(() => vi.unstubAllEnvs());

describe('deriveClientIp', () => {
  it('reads the client address appended by one trusted proxy', () => {
    vi.stubEnv('FRONTEND_TRUST_PROXY_HOPS', '1');
    const request = new NextRequest('https://app.example/api/session/signup', {
      headers: { 'x-forwarded-for': '198.51.100.7' },
    });
    expect(deriveClientIp(request)).toBe('198.51.100.7');
  });

  it('ignores a client-supplied prefix when the trusted proxy appends the client', () => {
    vi.stubEnv('FRONTEND_TRUST_PROXY_HOPS', '1');
    const request = new NextRequest('https://app.example/api/session/signup', {
      headers: { 'x-forwarded-for': '203.0.113.99, 198.51.100.7' },
    });

    expect(deriveClientIp(request)).toBe('198.51.100.7');
  });

  it('fails closed when forwarding hops are not configured or the value is invalid', () => {
    expect(deriveClientIp(new NextRequest('https://app.example/api/session/signup', {
      headers: { 'x-forwarded-for': '203.0.113.8', 'x-docai-client-ip': '198.51.100.2' },
    }))).toBeUndefined();

    vi.stubEnv('FRONTEND_TRUST_PROXY_HOPS', '1');
    expect(deriveClientIp(new NextRequest('https://app.example/api/session/signup', {
      headers: { 'x-forwarded-for': 'not-an-ip' },
    }))).toBeUndefined();

    vi.stubEnv('FRONTEND_TRUST_PROXY_HOPS', '3');
    expect(deriveClientIp(new NextRequest('https://app.example/api/session/signup', {
      headers: { 'x-forwarded-for': '203.0.113.8' },
    }))).toBeUndefined();
  });
});
