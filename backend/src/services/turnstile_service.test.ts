import { verifyTurnstile } from './turnstile_service';

const env = {
  TURNSTILE_SECRET_KEY: 'secret-test-key',
  TURNSTILE_EXPECTED_HOSTNAMES: 'app.example.com,www.example.com',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('verifyTurnstile', () => {
  it('accepts a valid signup challenge for an expected hostname', async () => {
    const fetchStub = jest.fn().mockResolvedValue(response({ success: true, action: 'signup', hostname: 'app.example.com' }));

    await expect(verifyTurnstile({ token: 'valid-token', remoteIp: '203.0.113.8' }, fetchStub, env))
      .resolves.toEqual({ ok: true });
    expect(fetchStub).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchStub.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const request = new URLSearchParams(fetchStub.mock.calls[0][1].body);
    expect(Object.fromEntries(request)).toEqual({
      secret: 'secret-test-key', response: 'valid-token', remoteip: '203.0.113.8',
    });
    expect(fetchStub.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [{ success: false, 'error-codes': ['invalid-input-response'] }, 'rejected'],
    [{ success: true, action: 'login', hostname: 'app.example.com' }, 'rejected'],
    [{ success: true, action: 'signup', hostname: 'evil.example' }, 'rejected'],
  ])('rejects an invalid or mismatched response %#', async (body, reason) => {
    await expect(verifyTurnstile({ token: 'token' }, jest.fn().mockResolvedValue(response(body)), env))
      .resolves.toEqual({ ok: false, reason });
  });

  it.each([
    jest.fn().mockRejectedValue(new Error('network failure')),
    jest.fn().mockResolvedValue(response({}, 503)),
    jest.fn().mockResolvedValue(new Response('not-json', { status: 200 })),
  ])('fails closed when Siteverify is unavailable %#', async (fetchStub) => {
    await expect(verifyTurnstile({ token: 'token' }, fetchStub, env))
      .resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});
