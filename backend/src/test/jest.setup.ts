/**
 * Test global setup — runs before each test file.
 *
 * These mirror the app's "development" dev-auth bypass so that contract tests
 * mounting sub-routers (without a full index.ts bootstrap) authenticate as a
 * dev user instead of 401-ing on a missing Bearer token. The bypass is
 * HARD-GATED in production by validateEnv/requireAdminAuth, so setting these
 * in NODE_ENV=test does not weaken the security boundary.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters-long-xx';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/docai_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.CONVERSION_SERVICE_URL = process.env.CONVERSION_SERVICE_URL || 'http://localhost:8004';
