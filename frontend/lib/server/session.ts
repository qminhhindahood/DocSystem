export const SESSION_COOKIE = 'docai_session';

export interface SessionCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
}

export function sessionCookieSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  const configured = env.SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return env.NODE_ENV !== 'development';
}

export function sessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  };
}

export function normalizeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return '/'; }
  return decoded.startsWith('/') && !decoded.startsWith('//') && !decoded.includes('\\') ? value : '/';
}
