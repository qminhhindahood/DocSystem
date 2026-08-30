import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const forwardToBackend = vi.fn();
vi.mock('@/lib/server/backend', () => ({
  forwardToBackend: (...args: unknown[]) => forwardToBackend(...args),
  backendUrl: () => 'http://backend.test',
}));

beforeEach(() => {
  vi.clearAllMocks();
  forwardToBackend.mockResolvedValue(new Response(JSON.stringify({ user: { id: 'u1' } }), { status: 200 }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('backend proxy forwarding headers', () => {
  it('does not trust caller-supplied forwarding identity headers', async () => {
    const { POST } = await import('@/app/api/proxy/[...path]/route');
    const request = new NextRequest('http://localhost/api/proxy/convert', {
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
    ['/workflow/types', 'GET'],
    ['/documents', 'GET'],
    ['/templates', 'GET'],
    ['/qa/ask', 'POST'],
    ['/convert/job-1', 'DELETE'],
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
    const status = (await handler(request)).status;
    // Removed surfaces are gone from the allowlist entirely (404); a surviving
    // path with a disallowed method is 405.
    expect([404, 405]).toContain(status);
    if (path.startsWith('/convert')) expect(status).toBe(405);
  });
});
