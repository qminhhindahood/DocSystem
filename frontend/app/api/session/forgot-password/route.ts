import { NextRequest, NextResponse } from 'next/server';
import { forwardToBackend } from '@/lib/server/backend';
import { enforceMutationOrigin } from '@/lib/server/request-security';
import { passwordResetDisabledResponse, passwordResetEnabled } from '@/lib/server/password-reset-mode';

const SAFE_RESPONSE = {
  success: true,
  message: 'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi.',
};

export async function POST(req: NextRequest) {
  const originError = enforceMutationOrigin(req);
  if (originError) return originError;
  if (!passwordResetEnabled()) return passwordResetDisabledResponse();

  try {
    const body = await req.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return NextResponse.json({ error: 'Email không hợp lệ.' }, { status: 400 });
    }
    await forwardToBackend('POST', '/api/auth/forgot-password', {
      body: JSON.stringify({ email }),
      headers: { 'Content-Type': 'application/json' },
      signal: req.signal,
    });
  } catch {
    // Account existence and mail-provider details must never cross this boundary.
  }
  return NextResponse.json(SAFE_RESPONSE, { status: 202 });
}
