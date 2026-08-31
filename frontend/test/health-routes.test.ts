import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const forwardToBackend = vi.fn();
vi.mock('@/lib/server/backend', () => ({
  forwardToBackend: (...args: unknown[]) => forwardToBackend(...args),
  backendUrl: () => 'http://backend.test',
}));

import { GET as live } from '@/app/api/live/route';
import { GET as ready } from '@/app/api/ready/route';

describe('frontend health routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PASSWORD_RESET_MODE', 'disabled');
    vi.stubEnv('DISABLE_PUBLIC_REGISTER', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports process liveness without calling the backend', async () => {
    const response = await live();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'alive' });
    expect(forwardToBackend).not.toHaveBeenCalled();
  });

  it('reports ready only when the private backend is ready', async () => {
    forwardToBackend.mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    const response = await ready();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready' });
    expect(forwardToBackend).toHaveBeenCalledWith('GET', '/ready');
  });

  it.each([
    ['non-2xx', () => forwardToBackend.mockResolvedValue(new Response('database=down', { status: 503 }))],
    ['unreachable', () => forwardToBackend.mockRejectedValue(new Error('Backend http://private token=secret'))],
  ])('maps a %s backend result to a redacted 503', async (_name, arrange) => {
    arrange();
    const response = await ready();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toEqual({ status: 'not_ready' });
    expect(JSON.stringify(body)).not.toMatch(/database|private|secret|http:/);
  });

  it('rejects readiness when public registration lacks a Turnstile site key', async () => {
    vi.stubEnv('DISABLE_PUBLIC_REGISTER', 'false');
    vi.stubEnv('TURNSTILE_SITE_KEY', '');
    forwardToBackend.mockResolvedValue(new Response('{}', { status: 200 }));

    const response = await ready();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'not_ready' });
    expect(forwardToBackend).not.toHaveBeenCalled();
  });

  it('rejects open-registration readiness when public support configuration is fake', async () => {
    vi.stubEnv('DISABLE_PUBLIC_REGISTER', 'false');
    vi.stubEnv('TURNSTILE_SITE_KEY', 'turnstile-site-key');
    vi.stubEnv('PUBLIC_OPERATOR_NAME', 'DocAI');
    vi.stubEnv('PUBLIC_OPERATOR_JURISDICTION', 'Vietnam');
    vi.stubEnv('PUBLIC_SUPPORT_EMAIL', 'support@example.invalid');
    vi.stubEnv('PUBLIC_POLICY_EFFECTIVE_DATE', '2026-08-31');
    forwardToBackend.mockResolvedValue(new Response('{}', { status: 200 }));

    const response = await ready();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'not_ready' });
    expect(forwardToBackend).not.toHaveBeenCalled();
  });

  it('accepts complete public configuration before checking backend readiness', async () => {
    vi.stubEnv('DISABLE_PUBLIC_REGISTER', 'false');
    vi.stubEnv('TURNSTILE_SITE_KEY', 'turnstile-site-key');
    vi.stubEnv('PUBLIC_OPERATOR_NAME', 'DocAI');
    vi.stubEnv('PUBLIC_OPERATOR_JURISDICTION', 'Vietnam');
    vi.stubEnv('PUBLIC_SUPPORT_EMAIL', 'support@docai.example.vn');
    vi.stubEnv('PUBLIC_POLICY_EFFECTIVE_DATE', '2026-08-31');
    forwardToBackend.mockResolvedValue(new Response('{}', { status: 200 }));

    const response = await ready();

    expect(response.status).toBe(200);
    expect(forwardToBackend).toHaveBeenCalledWith('GET', '/ready');
  });

  it('rejects readiness when password reset mode is invalid', async () => {
    vi.stubEnv('PASSWORD_RESET_MODE', 'smtp-later');

    const response = await ready();

    expect(response.status).toBe(503);
    expect(forwardToBackend).not.toHaveBeenCalled();
  });
});
