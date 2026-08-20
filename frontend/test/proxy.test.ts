import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { normalizeClientReturnTo } from '@/lib/auth';
import { proxy } from '@/proxy';

describe('normalizeClientReturnTo', () => {
  it('accepts a simple path', () => {
    expect(normalizeClientReturnTo('/convert')).toBe('/convert');
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

  it('redirects the unauthenticated convert route to login', () => {
    const response = proxy(new NextRequest('http://localhost/convert'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost/login?returnTo=%2Fconvert',
    );
  });

  it('allows /convert to load when a session cookie is present', () => {
    const response = proxy(
      new NextRequest('http://localhost/convert', {
        headers: { cookie: 'docai_session=token' },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

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
