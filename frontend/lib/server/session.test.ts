import { describe, expect, it } from 'vitest';
import { sessionCookieSecure } from './session';

describe('sessionCookieSecure', () => {
  it.each([
    [{ NODE_ENV: 'production' }, true],
    [{ NODE_ENV: 'development' }, false],
    [{ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' }, false],
    [{ NODE_ENV: 'development', SESSION_COOKIE_SECURE: 'true' }, true],
    [{ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'unexpected' }, true],
  ])('resolves the deployment cookie policy', (env, expected) => {
    expect(sessionCookieSecure(env as NodeJS.ProcessEnv)).toBe(expected);
  });
});
