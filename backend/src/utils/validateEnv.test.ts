describe('validateEnv configuration', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });
  afterAll(() => { process.env = originalEnv; });

  const REQUIRED_VARS = () => ({
    DATABASE_URL: process.env.DATABASE_URL || 'postgres://db',
    REDIS_URL: 'redis://redis',
    DOCLING_URL: 'http://docling',
    EMBEDDINGS_URL: 'http://emb',
    JWT_SECRET: 'x'.repeat(32),
    LLM_CONFIG_ENCRYPTION_KEY: 'a'.repeat(64),
    DOCUMENT_RENDERER_URL: 'http://localhost:8005',
    RENDERER_INTERNAL_TOKEN: '0123456789abcdef'.repeat(2), // gitleaks:allow -- deterministic test-only token
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
    delete process.env.CORS_ORIGIN;
    delete process.env.NODE_ENV;
    Object.keys(REQUIRED_VARS()).forEach(k => delete process.env[k]);
  });

  it('requires HTTPS CORS origins in production', () => {
    process.env.NODE_ENV = 'production';
    Object.assign(process.env, REQUIRED_VARS());
    process.env.CORS_ORIGIN = 'http://app.example.test';
    const { validateEnv } = require('./validateEnv');
    expect(() => validateEnv()).toThrow(/HTTPS/);
  });

  it('rejects ambiguous booleans, invalid numerics, and weak renderer tokens', () => {
    process.env.NODE_ENV = 'development';
    Object.assign(process.env, REQUIRED_VARS());
    process.env.ENABLE_SELF_CORRECT = 'yes';
    const { validateEnv } = require('./validateEnv');
    expect(() => validateEnv()).toThrow(/ENABLE_SELF_CORRECT/);
    process.env.ENABLE_SELF_CORRECT = 'false';
    process.env.TRUST_PROXY_HOPS = '-1';
    expect(() => validateEnv()).toThrow(/TRUST_PROXY_HOPS/);
    process.env.TRUST_PROXY_HOPS = '0';
    process.env.RENDERER_INTERNAL_TOKEN = 'short';
    expect(() => validateEnv()).toThrow(/RENDERER_INTERNAL_TOKEN/);
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

  it('allows per-user-only LLM configuration and validates optional system defaults', () => {
    process.env.NODE_ENV = 'development';
    Object.assign(process.env, REQUIRED_VARS());
    delete process.env.DEFAULT_LLM_PROVIDER;
    delete process.env.DEFAULT_LLM_BASE_URL;
    delete process.env.DEFAULT_LLM_MODEL;
    delete process.env.DEFAULT_LLM_API_KEY;
    const { validateEnv } = require('./validateEnv');
    expect(() => validateEnv()).not.toThrow();

    process.env.DEFAULT_LLM_PROVIDER = 'openrouter';
    process.env.DEFAULT_LLM_BASE_URL = 'https://openrouter.ai/api/v1';
    process.env.DEFAULT_LLM_MODEL = 'openrouter/free';
    expect(() => validateEnv()).toThrow(/DEFAULT_LLM_API_KEY/);
    process.env.DEFAULT_LLM_API_KEY = 'test-key';
    expect(() => validateEnv()).not.toThrow();
  });

  it('accepts Gemini system defaults only with an API key', () => {
    process.env.NODE_ENV = 'development';
    Object.assign(process.env, REQUIRED_VARS());
    process.env.DEFAULT_LLM_PROVIDER = 'gemini';
    process.env.DEFAULT_LLM_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
    process.env.DEFAULT_LLM_MODEL = 'gemini-3.6-flash';
    delete process.env.DEFAULT_LLM_API_KEY;
    const { validateEnv } = require('./validateEnv');

    expect(() => validateEnv()).toThrow(/DEFAULT_LLM_API_KEY/);

    process.env.DEFAULT_LLM_API_KEY = 'gemini-key';
    expect(() => validateEnv()).not.toThrow();
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

  it('requires complete mail configuration in email mode', () => {
    process.env.NODE_ENV = 'production';
    Object.assign(process.env, REQUIRED_VARS());
    process.env.CORS_ORIGIN = 'https://app.example.com';
    process.env.PASSWORD_RESET_MODE = 'email';
    delete process.env.SMTP_HOST;
    const { validateEnv } = require('./validateEnv');

    expect(() => validateEnv()).toThrow(/SMTP_HOST/);
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
