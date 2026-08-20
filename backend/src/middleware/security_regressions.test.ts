import { signupLimiter, uploadLimiter } from './ratelimit';

describe('security regression contracts', () => {
  it('exports a dedicated upload limiter', () => {
    expect(typeof uploadLimiter).toBe('function');
  });

  it('exports a dedicated signup limiter', () => {
    expect(typeof signupLimiter).toBe('function');
  });
});
