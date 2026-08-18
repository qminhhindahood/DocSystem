const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const EXPECTED_ACTION = 'signup';

export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: 'rejected' | 'unavailable' };

interface TurnstileInput {
  token: string;
  remoteIp?: string;
}

interface TurnstileResponse {
  success?: boolean;
  action?: string;
  hostname?: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function verifyTurnstile(
  input: TurnstileInput,
  fetchImpl: FetchLike = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TurnstileResult> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  const expectedHostnames = new Set(
    (env.TURNSTILE_EXPECTED_HOSTNAMES ?? '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!secret || expectedHostnames.size === 0) return { ok: false, reason: 'unavailable' };

  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret,
        response: input.token,
        ...(input.remoteIp ? { remoteip: input.remoteIp } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false, reason: 'unavailable' };

    const result = await response.json() as TurnstileResponse;
    if (!result || typeof result !== 'object') return { ok: false, reason: 'unavailable' };
    if (!result.success) return { ok: false, reason: 'rejected' };
    if (result.action !== EXPECTED_ACTION) return { ok: false, reason: 'rejected' };
    if (!result.hostname || !expectedHostnames.has(result.hostname.toLowerCase())) {
      return { ok: false, reason: 'rejected' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
