export const SESSION_COOKIE = 'docai_session';

export interface SessionCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
}

export function sessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
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
