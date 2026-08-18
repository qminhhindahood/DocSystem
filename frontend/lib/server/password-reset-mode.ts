import { NextResponse } from 'next/server';

export const PASSWORD_RESET_DISABLED_BODY = {
  code: 'PASSWORD_RESET_DISABLED',
  error: 'Khôi phục mật khẩu qua email chưa được bật cho bản dùng thử cá nhân.',
} as const;

export function passwordResetEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = env.PASSWORD_RESET_MODE?.trim();
  if (!mode && env.NODE_ENV !== 'production') return true;
  if (mode === 'disabled') return false;
  if (mode === 'email') return true;
  throw new Error('PASSWORD_RESET_MODE must be explicitly set to disabled or email in production');
}

export function passwordResetDisabledResponse() {
  return NextResponse.json(PASSWORD_RESET_DISABLED_BODY, { status: 503 });
}
