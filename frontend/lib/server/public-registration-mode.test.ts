import { describe, expect, it } from 'vitest';
import { isPublicRegistrationEnabled } from './public-registration-mode';

describe('isPublicRegistrationEnabled', () => {
  it.each([
    [{ NODE_ENV: 'development' }, true],
    [{ NODE_ENV: 'development', DISABLE_PUBLIC_REGISTER: 'true' }, false],
    [{ NODE_ENV: 'development', DISABLE_PUBLIC_REGISTER: 'false' }, true],
    [{ NODE_ENV: 'production' }, false],
    [{ NODE_ENV: 'production', DISABLE_PUBLIC_REGISTER: 'false' }, true],
  ])('matches backend registration semantics for %o', (env, expected) => {
    expect(isPublicRegistrationEnabled(env as NodeJS.ProcessEnv)).toBe(expected);
  });
});
