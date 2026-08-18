type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
private state: CircuitState = 'closed';
private failureCount = 0;
private successCount = 0;
private readonly threshold: number;
private readonly resetTimeout: number;
private lastFailureTime = 0;
// m6: track in-flight half-open probe — only one at a time.
private halfOpenInflight = false;
// When provided, only failures matching this predicate count toward opening the circuit.
private readonly isFailureCountable?: (error: unknown) => boolean;

constructor(opts: { threshold?: number; resetTimeoutMs?: number; isFailureCountable?: (error: unknown) => boolean } = {}) {
this.threshold = opts.threshold ?? 5;
this.resetTimeout = opts.resetTimeoutMs ?? 30_000;
this.isFailureCountable = opts.isFailureCountable;
}

async execute<T>(fn: () => Promise<T>): Promise<T> {
if (this.state === 'open') {
if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
this.state = 'half-open';
} else {
throw new Error('Circuit breaker is open — service temporarily unavailable');
}
}

// m6: half-open concurrency guard — only allow one probe call at a time.
if (this.state === 'half-open') {
if (this.halfOpenInflight) {
throw new Error('Circuit breaker is half-open — probe already in flight');
}
this.halfOpenInflight = true;
}

try {
const result = await fn();
this.onSuccess();
return result;
} catch (error) {
// m6: in half-open, a failure means "still broken" but should NOT
// accelerate failureCount toward re-opening (it would re-open instantly
// under load and never recover). Only count failures in closed state.
this.onFailure(error);
throw error;
}
}

private onSuccess(): void {
this.failureCount = 0;
this.halfOpenInflight = false;
if (this.state === 'half-open') {
this.state = 'closed';
this.successCount = 0;
}
}

private onFailure(error?: unknown): void {
this.lastFailureTime = Date.now();
this.halfOpenInflight = false;
// Don't count if this error type shouldn't contribute to opening the circuit
if (this.isFailureCountable && !this.isFailureCountable(error)) {
return;
}
if (this.state === 'closed') {
this.failureCount++;
if (this.failureCount >= this.threshold) {
this.state = 'open';
}
}
// In half-open: a single failure means the service is still down, go back to open.
// Do NOT increment failureCount — that would inflate the count on every probe.
if (this.state === 'half-open') {
this.state = 'open';
}
}
}

export const lmStudioBreaker = new CircuitBreaker({ threshold: 5, resetTimeoutMs: 30_000 });
export const doclingBreaker = new CircuitBreaker({ threshold: 3, resetTimeoutMs: 60_000 });
export const embeddingsBreaker = new CircuitBreaker({ threshold: 3, resetTimeoutMs: 60_000 });
export const conversionBreaker = new CircuitBreaker({
  threshold: 3,
  resetTimeoutMs: 60_000,
  // 4xx are expected user-error responses (password-protected PDF -> 422,
  // quota exceeded -> 429, invalid upload -> 400). They must NOT open the
  // circuit — only server-side failures (5xx, timeouts, network drops) count.
  isFailureCountable: (error) => {
    const status = (error as any)?.response?.status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return false; // client error — caller surfaces it, not a service outage
    }
    return true;
  },
});
