import { NextRequest, NextResponse } from 'next/server';
import { forwardToBackend } from '@/lib/server/backend';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/server/session';
import { enforceMutationOrigin } from '@/lib/server/request-security';
import { passwordResetDisabledResponse, passwordResetEnabled } from '@/lib/server/password-reset-mode';

const INVALID_RESET = 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.';

export async function POST(req: NextRequest) {
  const originError = enforceMutationOrigin(req);
  if (originError) return originError;
  if (!passwordResetEnabled()) return passwordResetDisabledResponse();

  try {
    const body = await req.json();
    const token = typeof body.token === 'string' ? body.token : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || password.length < 8 || password.length > 100) {
      return NextResponse.json({ error: INVALID_RESET }, { status: 400 });
    }

    const backendRes = await forwardToBackend('POST', '/api/auth/reset-password', {
      body: JSON.stringify({ token, password }),
      headers: { 'Content-Type': 'application/json' },
      signal: req.signal,
    });
    if (!backendRes.ok) return NextResponse.json({ error: INVALID_RESET }, { status: 400 });

    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
    return response;
  } catch {
    return NextResponse.json({ error: 'Không thể đặt lại mật khẩu. Vui lòng thử lại.' }, { status: 502 });
  }
}
