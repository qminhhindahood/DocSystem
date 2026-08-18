export type PasswordResetMode = 'disabled' | 'email';

export const PASSWORD_RESET_DISABLED_CODE = 'PASSWORD_RESET_DISABLED';
export const PASSWORD_RESET_DISABLED_MESSAGE =
  'Khôi phục mật khẩu qua email chưa được bật cho bản dùng thử cá nhân.';

export function getPasswordResetMode(env: NodeJS.ProcessEnv = process.env): PasswordResetMode {
  const raw = env.PASSWORD_RESET_MODE?.trim();
  if (!raw && env.NODE_ENV !== 'production') return 'email';
  if (raw === 'disabled' || raw === 'email') return raw;
  throw new Error('PASSWORD_RESET_MODE must be explicitly set to disabled or email in production');
}

export function isEmailPasswordResetEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return getPasswordResetMode(env) === 'email';
}
