import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const forwardToBackend = vi.fn();
vi.mock('@/lib/server/backend', () => ({
  forwardToBackend: (...args: unknown[]) => forwardToBackend(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  forwardToBackend.mockResolvedValue(new Response(JSON.stringify({ user: { id: 'u1' } }), { status: 200 }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('analytics tracking route', () => {
  it('requires a session and bounds event batches', async () => {
    const { POST } = await import('@/app/api/analytics/track/route');
    const unauthenticated = new NextRequest('http://localhost/api/analytics/track', {
      method: 'POST',
      body: JSON.stringify({ events: [{ event: 'page_view' }] }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    });
    expect((await POST(unauthenticated)).status).toBe(401);

    forwardToBackend.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const forgedCookie = new NextRequest('http://localhost/api/analytics/track', {
      method: 'POST',
      body: JSON.stringify({ events: [{ event: 'page_view' }] }),
      headers: { 'content-type': 'application/json', cookie: 'docai_session=forged', origin: 'http://localhost' },
    });
    expect((await POST(forgedCookie)).status).toBe(401);

    const oversized = new NextRequest('http://localhost/api/analytics/track', {
      method: 'POST',
      body: JSON.stringify({ events: Array.from({ length: 51 }, () => ({ event: 'page_view' })) }),
      headers: { 'content-type': 'application/json', cookie: 'docai_session=token', origin: 'http://localhost' },
    });
    expect((await POST(oversized)).status).toBe(400);
  });

  it('accepts a bounded valid batch without logging user event data', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { POST } = await import('@/app/api/analytics/track/route');
    const request = new NextRequest('http://localhost/api/analytics/track', {
      method: 'POST',
      body: JSON.stringify({ events: [{ event: 'page_view', timestamp: Date.now(), category: 'navigation' }] }),
      headers: { 'content-type': 'application/json', cookie: 'docai_session=token', origin: 'http://localhost' },
    });

    expect((await POST(request)).status).toBe(200);
    expect(log).not.toHaveBeenCalled();
  });
});

describe('backend proxy forwarding headers', () => {
  it('does not trust caller-supplied forwarding identity headers', async () => {
    const { POST } = await import('@/app/api/proxy/[...path]/route');
    const request = new NextRequest('http://localhost/api/proxy/workflow/stream', {
      method: 'POST',
      body: '{}',
      headers: {
        'content-type': 'application/json', cookie: 'docai_session=token', origin: 'http://localhost',
        forwarded: 'for=attacker', 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.8',
      },
    });

    expect((await POST(request)).status).toBe(200);
    const call = forwardToBackend.mock.calls[0];
    if (!call) throw new Error('Expected the proxy to forward to the backend helper');
    const headers = (call[2] as { headers: Record<string, string> }).headers;
    expect(headers).not.toHaveProperty('forwarded');
    expect(headers).not.toHaveProperty('x-forwarded-for');
    expect(headers).not.toHaveProperty('x-real-ip');
    expect(headers.authorization).toBe('Bearer token');
  });

  it.each([
    ['/admin/users', 'GET'],
    ['/workflow/types', 'DELETE'],
    ['/templates/template-1/analyze', 'DELETE'],
  ])('rejects non-allowlisted proxy request %s %s', async (path, method) => {
    const route = await import('@/app/api/proxy/[...path]/route');
    const handler = route[method as keyof typeof route] as ((request: NextRequest) => Promise<Response>) | undefined;
    if (!handler) {
      expect(method).toBe('OPTIONS');
      return;
    }
    const request = new NextRequest(`http://localhost/api/proxy${path}`, {
      method,
      headers: { cookie: 'docai_session=token', origin: 'http://localhost' },
    });
    expect((await handler(request)).status).toBe(method === 'GET' ? 404 : 405);
  });
});
