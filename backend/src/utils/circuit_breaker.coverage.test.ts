import { CircuitBreaker } from '../utils/circuit_breaker';

describe('conversion breaker 4xx handling', () => {
  const makeBreaker = () =>
    new CircuitBreaker({
      threshold: 3,
      resetTimeoutMs: 60_000,
      isFailureCountable: (error) => {
        const status = (error as any)?.response?.status;
        if (typeof status === 'number' && status >= 400 && status < 500) return false;
        return true;
      },
    });

  it('does NOT open the circuit on repeated 4xx user errors', async () => {
    const breaker = makeBreaker();
    const fourxx = () => {
      throw Object.assign(new Error('user error'), { response: { status: 422 } });
    };
    // Three 422 failures in a row (would normally trip a threshold=3 breaker).
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fourxx)).rejects.toThrow('user error');
    }
    // Circuit must stay closed — a valid call now succeeds.
    const result = await breaker.execute(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('DOES open the circuit on repeated 5xx server errors', async () => {
    const breaker = makeBreaker();
    const five = () => {
      throw Object.assign(new Error('boom'), { response: { status: 503 } });
    };
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(five)).rejects.toThrow('boom');
    }
    // Now open — even a valid call is short-circuited.
    await expect(breaker.execute(async () => 'ok')).rejects.toThrow('Circuit breaker is open');
  });
});
