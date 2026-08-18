import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enforceMutationOrigin } from '@/lib/server/request-security';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('mutation origin enforcement', () => {
  it('accepts same-origin and rejects cross-origin or originless browser mutations', () => {
    const sameOrigin = new NextRequest('https://docs.example/api/session/logout', {
      method: 'POST',
      headers: { origin: 'https://docs.example', cookie: 'docai_session=token' },
    });
    expect(enforceMutationOrigin(sameOrigin)).toBeNull();

    const crossOrigin = new NextRequest('https://docs.example/api/session/logout', {
      method: 'POST',
      headers: { origin: 'https://evil.example', cookie: 'docai_session=token' },
    });
    expect(enforceMutationOrigin(crossOrigin)?.status).toBe(403);

    const originless = new NextRequest('https://docs.example/api/session/logout', {
      method: 'POST',
      headers: { cookie: 'docai_session=token' },
    });
    expect(enforceMutationOrigin(originless)?.status).toBe(403);
  });

  it('uses forwarded origin only when reverse proxy hops are explicitly trusted', () => {
    const request = new NextRequest('http://frontend:3000/api/proxy/workflow/stream', {
      method: 'POST',
      headers: {
        origin: 'https://docs.example',
        'x-forwarded-host': 'docs.example',
        'x-forwarded-proto': 'https',
      },
    });
    expect(enforceMutationOrigin(request)?.status).toBe(403);

    vi.stubEnv('FRONTEND_TRUST_PROXY_HOPS', '1');
    expect(enforceMutationOrigin(request)).toBeNull();
  });

  it('allows an originless internal request only with the configured bearer token', () => {
    vi.stubEnv('FRONTEND_INTERNAL_API_TOKEN', 'internal-secret');
    const request = new NextRequest('https://docs.example/api/analytics/track', {
      method: 'POST',
      headers: { authorization: 'Bearer internal-secret' },
    });
    expect(enforceMutationOrigin(request)).toBeNull();
  });
});
