/**
 * Exponential-backoff retry utility for external service calls.
 *
 * Usage:
 * const data = await withRetry(() => axios.get(url), { maxRetries: 3, baseDelay: 1000 });
 */

export interface RetryOptions {
  maxRetries?: number; // default 3
  baseDelay?: number; // ms, default 1000
  maxDelay?: number; // ms, default 30000
  retryable?: (err: unknown) => boolean; // which errors to retry
  retryContext?: string; // label for log messages
  signal?: AbortSignal; // abort signal to cancel retries
}

const DEFAULT_RETRYABLE = (err: unknown): boolean => {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as any).code;
    return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code);
  }
  // Retry on HTTP 5xx or 429 (rate limit)
  if (err && typeof err === 'object' && 'response' in err) {
    const status = (err as any).response?.status;
    return (status >= 500 && status < 600) || status === 429;
  }
  // Retry on timeout errors
  if (err instanceof Error && /timeout/i.test(err.message)) return true;
  return false;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    retryable = DEFAULT_RETRYABLE,
    retryContext = "",
    signal,
  } = opts;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      // H20: preserve the original error as `cause` and attach abort metadata
      // so callers can distinguish a genuine client disconnect from an internal
      // timeout abort. The previous bare DOMException discarded any upstream
      // response status / message that fn() may have already populated.
      // H20: preserve the original error as `cause` and tag the abort source
      // so callers can distinguish a genuine client disconnect from an internal
      // timeout abort. The previous bare DOMException discarded any upstream
      // response status / message that fn() may have already populated.
      const abortErr = new DOMException('Aborted by client', 'AbortError');
      (abortErr as any).cause = lastError;
      (abortErr as any).abortedBy = (signal as any).abortedBy ?? 'client';
      throw abortErr;
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // If fn() itself threw an AbortError (e.g. its own AbortController fired),
      // surface it with the original error preserved as cause and abort source
      // tagged so callers can distinguish a genuine client disconnect from an
      // internal timeout abort — same metadata contract as the signal-branch.
      if (err instanceof DOMException && err.name === 'AbortError') {
        (err as any).cause = (err as any).cause ?? lastError;
        (err as any).abortedBy = (err as any).abortedBy ?? (signal as any).abortedBy ?? 'client';
        throw err;
      }

      if (attempt >= maxRetries || !retryable(err)) {
        throw err;
      }
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const jitter = delay * (0.5 + Math.random() * 0.5); // 50-100% of delay
      const waitMs = Math.round(jitter);

      console.warn(
        `[withRetry] ${retryContext ? retryContext + ' - ' : ''}Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${waitMs}ms:`,
        err instanceof Error ? err.message : err,
      );

      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  throw lastError;
}
