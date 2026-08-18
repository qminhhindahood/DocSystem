import { getPasswordResetMode, isEmailPasswordResetEnabled } from './password_reset_mode';

describe('password reset mode', () => {
  it('requires an explicit mode in production', () => {
    expect(() => getPasswordResetMode({ NODE_ENV: 'production' })).toThrow(/PASSWORD_RESET_MODE/);
  });

  it.each(['disabled', 'email'] as const)('accepts %s', (mode) => {
    expect(getPasswordResetMode({ NODE_ENV: 'production', PASSWORD_RESET_MODE: mode })).toBe(mode);
  });

  it('rejects every other value', () => {
    expect(() => getPasswordResetMode({ NODE_ENV: 'production', PASSWORD_RESET_MODE: 'smtp' }))
      .toThrow(/disabled.*email/);
  });

  it('keeps email recovery enabled by default outside production', () => {
    expect(isEmailPasswordResetEnabled({ NODE_ENV: 'test' })).toBe(true);
  });
});
