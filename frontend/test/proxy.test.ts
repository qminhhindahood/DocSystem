import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { normalizeClientReturnTo } from '@/lib/auth';
import { proxy } from '@/proxy';

describe('normalizeClientReturnTo', () => {
  it('accepts a simple path', () => {
    expect(normalizeClientReturnTo('/documents')).toBe('/documents');
  });

  it('returns / for null', () => {
    expect(normalizeClientReturnTo(null)).toBe('/');
  });

  it('rejects protocol-relative URL', () => {
    expect(normalizeClientReturnTo('//evil.test')).toBe('/');
  });

  it('rejects absolute URL', () => {
    expect(normalizeClientReturnTo('https://evil.test')).toBe('/');
  });

  it('rejects backslash prefix', () => {
    expect(normalizeClientReturnTo('/\\path')).toBe('/');
  });
});

describe('route access proxy', () => {
  it('keeps the public landing page available without a session', () => {
    const response = proxy(new NextRequest('http://localhost/'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('redirects unauthenticated app routes to login', () => {
    const response = proxy(new NextRequest('http://localhost/dashboard'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost/login?returnTo=%2Fdashboard',
    );
  });

  it.each(['/generate', '/templates', '/qa'])(
    'allows %s to load when a session cookie is present',
    (pathname) => {
      const response = proxy(
        new NextRequest(`http://localhost${pathname}`, {
          headers: { cookie: 'docai_session=token' },
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
    },
  );

  it('allows the login route when an unverified session cookie is present', () => {
    const response = proxy(
      new NextRequest('http://localhost/login', {
        headers: { cookie: 'docai_session=stale-token' },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});
