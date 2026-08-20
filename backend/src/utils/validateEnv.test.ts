describe('validateEnv configuration (standalone stack)', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });
  afterAll(() => { process.env = originalEnv; });

  const REQUIRED_VARS = () => ({
    DATABASE_URL: process.env.DATABASE_URL || 'postgres://db',
    REDIS_URL: 'redis://redis',
    JWT_SECRET: 'x'.repeat(32),
    CONVERSION_SERVICE_URL: 'http://conversion:8004',
    LLM_CONFIG_ENCRYPTION_KEY: 'ab'.repeat(32),
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_FROM: 'DocAI <no-reply@example.com>',
    PASSWORD_RESET_BASE_URL: 'https://app.example.com/reset-password',
    PASSWORD_RESET_MODE: 'email',
  });

  it('rejects wildcard CORS when credentials are enabled', () => {
    process.env.NODE_ENV = 'development';
    Object.assign(process.env, REQUIRED_VARS());
    process.env.CORS_ORIGIN = '*';
    const { validateEnv } = require('./validateEnv');
    expect(() => validateEnv()).toThrow(/CORS_ORIGIN/);
  });

  it('requires HTTPS CORS origins in production', () => {
    process.env.NODE_ENV = 'production';
    Object.assign(process.env, REQUIRED_VARS());
    process.env.CORS_ORIGIN = 'http://app.example.test';
    const { validateEnv } = require('./validateEnv');
    expect(() => validateEnv()).toThrow(/HTTPS/);
  });

  it('rejects ambiguous booleans and invalid numerics', () => {
    process.env.NODE_ENV = 'development';
    Object.assign(process.env, REQUIRED_VARS());
    process.env.DISABLE_PUBLIC_REGISTER = 'yes';
    const { validateEnv } = require('./validateEnv');
    expect(() => validateEnv()).toThrow(/DISABLE_PUBLIC_REGISTER/);
    process.env.DISABLE_PUBLIC_REGISTER = 'false';
    process.env.TRUST_PROXY_HOPS = '-1';
    expect(() => validateEnv()).toThrow(/TRUST_PROXY_HOPS/);
    process.env.TRUST_PROXY_HOPS = '0';
    expect(() => validateEnv()).not.toThrow();
  });

  it('requires the conversion service URL and rejects credentials in it', () => {
    process.env.NODE_ENV = 'development';
    Object.assign(process.env, REQUIRED_VARS());
    delete process.env.CONVERSION_SERVICE_URL;
    const { validateEnv } = require('./validateEnv');
    expect(() => validateEnv()).toThrow(/CONVERSION_SERVICE_URL/);

    process.env.CONVERSION_SERVICE_URL = 'http://user:pass@conversion:8004';
    expect(() => validateEnv()).toThrow(/CONVERSION_SERVICE_URL/);
  });

  it('requires a 64-hex-char LLM_CONFIG_ENCRYPTION_KEY for BYOK key storage', () => {
    process.env.NODE_ENV = 'development';
    Object.assign(process.env, REQUIRED_VARS());
    delete process.env.LLM_CONFIG_ENCRYPTION_KEY;
    const { validateEnv } = require('./validateEnv');
    expect(() => validateEnv()).toThrow(/LLM_CONFIG_ENCRYPTION_KEY/);

    process.env.LLM_CONFIG_ENCRYPTION_KEY = 'not-hex';
    expect(() => validateEnv()).toThrow(/LLM_CONFIG_ENCRYPTION_KEY/);

    process.env.LLM_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(16); // 32 hex chars = 16 bytes
    expect(() => validateEnv()).toThrow(/LLM_CONFIG_ENCRYPTION_KEY/);

    process.env.LLM_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32);
    expect(() => validateEnv()).not.toThrow();
  });

  it('fails closed for production registration unless explicitly enabled', () => {
    const { isPublicRegistrationDisabled } = require('./validateEnv');
    expect(isPublicRegistrationDisabled({ NODE_ENV: 'production' })).toBe(true);
    expect(isPublicRegistrationDisabled({ NODE_ENV: 'production', DISABLE_PUBLIC_REGISTER: 'false' })).toBe(false);
    expect(isPublicRegistrationDisabled({ NODE_ENV: 'development' })).toBe(false);
  });

  it('requires complete Turnstile configuration when production registration is enabled', () => {
    process.env.NODE_ENV = 'production';
    Object.assign(process.env, REQUIRED_VARS());
    process.env.CORS_ORIGIN = 'https://app.example.com';
    process.env.PASSWORD_RESET_MODE = 'disabled';
    process.env.DISABLE_PUBLIC_REGISTER = 'false';
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.TURNSTILE_EXPECTED_HOSTNAMES;
    const { validateEnv } = require('./validateEnv');

    expect(() => validateEnv()).toThrow(/TURNSTILE_SECRET_KEY/);
    process.env.TURNSTILE_SECRET_KEY = 'turnstile-secret';
    expect(() => validateEnv()).toThrow(/TURNSTILE_EXPECTED_HOSTNAMES/);
    process.env.TURNSTILE_EXPECTED_HOSTNAMES = 'app.example.com';
    expect(() => validateEnv()).not.toThrow();
  });

  it('shares canonical username and password validation without changing password bytes', () => {
    const { normalizeUsername, validateAccountPassword } = require('./validateEnv');

    expect(normalizeUsername('  owner  ')).toBe('owner');
    expect(() => normalizeUsername('ab')).toThrow(/3 and 50/);
    expect(validateAccountPassword('  password-with-spaces  ')).toBe('  password-with-spaces  ');
    expect(() => validateAccountPassword('short')).toThrow(/8 and 100/);
  });

  it('requires complete password-reset mail configuration in production', () => {
    process.env.NODE_ENV = 'production';
    Object.assign(process.env, REQUIRED_VARS());
    process.env.CORS_ORIGIN = 'https://app.example.com';
    delete process.env.SMTP_HOST;
    const { validateEnv } = require('./validateEnv');

    expect(() => validateEnv()).toThrow(/SMTP_HOST/);
  });

  it('accepts explicit disabled password recovery without SMTP', () => {
    process.env.NODE_ENV = 'production';
    Object.assign(process.env, REQUIRED_VARS());
    process.env.CORS_ORIGIN = 'https://app.example.com';
    process.env.PASSWORD_RESET_MODE = 'disabled';
    for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASS', 'PASSWORD_RESET_BASE_URL']) {
      delete process.env[key];
    }
    const { validateEnv } = require('./validateEnv');

    expect(() => validateEnv()).not.toThrow();
  });

  it('requires paired SMTP credentials and an HTTPS reset URL in production', () => {
    process.env.NODE_ENV = 'production';
    Object.assign(process.env, REQUIRED_VARS());
    process.env.CORS_ORIGIN = 'https://app.example.com';
    process.env.SMTP_USER = 'smtp-user';
    delete process.env.SMTP_PASS;
    const { validateEnv } = require('./validateEnv');
    expect(() => validateEnv()).toThrow(/SMTP_USER.*SMTP_PASS|SMTP_PASS.*SMTP_USER/);

    delete process.env.SMTP_USER;
    process.env.PASSWORD_RESET_BASE_URL = 'http://app.example.com/reset-password';
    expect(() => validateEnv()).toThrow(/PASSWORD_RESET_BASE_URL.*HTTPS/);
  });
});
