import { qaLimiter, signupLimiter } from './ratelimit';

describe('security regression contracts', () => {
  it('exports a dedicated QA limiter', () => {
    expect(typeof qaLimiter).toBe('function');
  });

  it('exports a dedicated signup limiter', () => {
    expect(typeof signupLimiter).toBe('function');
  });
});
