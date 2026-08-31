import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { normalizeReturnTo } from '@/lib/server/session';

const mockForwardToBackend = vi.fn();
vi.mock('@/lib/server/backend', () => ({
  forwardToBackend: (...args: unknown[]) => mockForwardToBackend(...args),
  backendUrl: () => 'http://backend.test',
}));

import { POST as signup } from '@/app/api/session/signup/route';
import { POST as forgotPassword } from '@/app/api/session/forgot-password/route';
import { POST as resetPassword } from '@/app/api/session/reset-password/route';
import { DELETE as deleteAccount } from '@/app/api/session/account/route';

function mutationRequest(path: string, body: unknown, origin = 'https://app.example.com') {
  return new NextRequest(`https://app.example.com${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('normalizeReturnTo', () => {
  it('accepts a simple path', () => {
    expect(normalizeReturnTo('/convert?job=1')).toBe('/convert?job=1');
  });

  it('returns / for null', () => {
    expect(normalizeReturnTo(null)).toBe('/');
  });

  it('returns / for undefined', () => {
    expect(normalizeReturnTo(undefined)).toBe('/');
  });

  it('returns / for a number', () => {
    expect(normalizeReturnTo(42)).toBe('/');
  });

  it('rejects protocol-relative URL', () => {
    expect(normalizeReturnTo('//evil.test')).toBe('/');
  });

  it('rejects absolute URL', () => {
    expect(normalizeReturnTo('https://evil.test')).toBe('/');
  });

  it('rejects double-encoded protocol-relative', () => {
    expect(normalizeReturnTo('/%2f%2fevil.test')).toBe('/');
  });

  it('rejects backslash prefix', () => {
    expect(normalizeReturnTo('/\\evil.test')).toBe('/');
  });

  it('rejects path with backslash', () => {
    expect(normalizeReturnTo('/convert\\evil')).toBe('/');
  });

  it('returns / for malformed encoded string', () => {
    expect(normalizeReturnTo('%G')).toBe('/');
  });
});

describe('password recovery session routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PASSWORD_RESET_MODE = 'email';
  });

  it('normalizes required signup email before forwarding', async () => {
    mockForwardToBackend.mockResolvedValue(new Response(JSON.stringify({
      token: 'session-token', user: { id: 'u1', username: 'alice' },
    }), { status: 201, headers: { 'content-type': 'application/json' } }));

    const response = await signup(mutationRequest('/api/session/signup', {
      username: 'alice', email: ' Alice@Example.COM ', password: 'password123', passwordConfirmation: 'password123',
      turnstileToken: 'challenge-token',
    }));

    expect(response.status).toBe(200);
    expect(mockForwardToBackend).toHaveBeenCalledWith('POST', '/api/auth/register', expect.objectContaining({
      body: JSON.stringify({ username: 'alice', email: 'alice@example.com', password: 'password123', turnstileToken: 'challenge-token' }),
    }));
  });

  it('requires a Turnstile challenge before forwarding signup', async () => {
    const response = await signup(mutationRequest('/api/session/signup', {
      username: 'alice', email: 'alice@example.com', password: 'password123', passwordConfirmation: 'password123',
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('TURNSTILE_REQUIRED');
    expect(mockForwardToBackend).not.toHaveBeenCalled();
  });

  it('uses the client appended by the trusted proxy and ignores spoofed headers', async () => {
    vi.stubEnv('FRONTEND_TRUST_PROXY_HOPS', '1');
    mockForwardToBackend.mockResolvedValue(new Response(JSON.stringify({
      token: 'session-token', user: { id: 'u1', username: 'alice' },
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const request = mutationRequest('/api/session/signup', {
      username: 'alice', email: 'alice@example.com', password: 'password123', passwordConfirmation: 'password123',
      turnstileToken: 'challenge-token',
    });
    request.headers.set('x-forwarded-for', '203.0.113.99, 198.51.100.7');
    request.headers.set('x-docai-client-ip', '198.51.100.2');

    await signup(request);

    expect(mockForwardToBackend).toHaveBeenCalledWith('POST', '/api/auth/register', expect.objectContaining({
      headers: expect.objectContaining({ 'X-DocAI-Client-IP': '198.51.100.7' }),
    }));
  });

  it('rejects a cross-origin forgot-password request before forwarding', async () => {
    const response = await forgotPassword(mutationRequest(
      '/api/session/forgot-password', { email: 'owner@example.com' }, 'https://evil.example',
    ));

    expect(response.status).toBe(403);
    expect(mockForwardToBackend).not.toHaveBeenCalled();
  });

  it.each([
    ['/api/session/forgot-password', { email: 'not-an-email' }, forgotPassword],
    ['/api/session/reset-password', { token: 'bad', password: 'short' }, resetPassword],
  ])('returns the stable disabled response for %s without parsing or forwarding', async (path, body, handler) => {
    process.env.PASSWORD_RESET_MODE = 'disabled';

    const response = await handler(mutationRequest(path, body));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 'PASSWORD_RESET_DISABLED',
      error: 'Khôi phục mật khẩu qua email chưa được bật cho bản dùng thử cá nhân.',
    });
    expect(mockForwardToBackend).not.toHaveBeenCalled();
  });

  it('redacts backend failures behind the enumeration-safe forgot response', async () => {
    mockForwardToBackend.mockRejectedValue(new Error('SMTP password=secret token=raw-token'));

    const response = await forgotPassword(mutationRequest(
      '/api/session/forgot-password', { email: 'owner@example.com' },
    ));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({
      success: true,
      message: 'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi.',
    });
    expect(JSON.stringify(body)).not.toMatch(/secret|raw-token|SMTP/);
  });

  it('expires the session cookie after a successful password reset', async () => {
    mockForwardToBackend.mockResolvedValue(new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const token = 'A'.repeat(43);

    const response = await resetPassword(mutationRequest('/api/session/reset-password', {
      token, password: 'new-password-123',
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toMatch(/docai_session=;.*Max-Age=0/i);
  });
});

describe('account deletion session route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function accountRequest(body: unknown, token = 'session-token') {
    return new NextRequest('https://app.example.com/api/session/account', {
      method: 'DELETE',
      headers: {
        origin: 'https://app.example.com',
        'content-type': 'application/json',
        ...(token ? { cookie: `docai_session=${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it('requires a session before forwarding deletion', async () => {
    const response = await deleteAccount(accountRequest({ password: 'correct-password' }, ''));

    expect(response.status).toBe(401);
    expect(mockForwardToBackend).not.toHaveBeenCalled();
  });

  it('forwards a wrong-password response without clearing the session', async () => {
    mockForwardToBackend.mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid password' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await deleteAccount(accountRequest({ password: 'wrong-password' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Invalid password' });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('clears the session only after backend deletion succeeds', async () => {
    mockForwardToBackend.mockResolvedValue(new Response(null, { status: 204 }));

    const response = await deleteAccount(accountRequest({ password: 'correct-password' }));

    expect(response.status).toBe(204);
    expect(mockForwardToBackend).toHaveBeenCalledWith('DELETE', '/api/auth/me', {
      body: JSON.stringify({ password: 'correct-password' }),
      headers: {
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
      },
    });
    expect(response.headers.get('set-cookie')).toMatch(/docai_session=;.*Max-Age=0/i);
  });
});
