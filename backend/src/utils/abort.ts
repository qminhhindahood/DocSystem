/**
 * Linked timeout/parent-signal abort helper.
 * Creates an AbortController that fires when either:
 *  - The timeout elapses (TimeoutError), or
 *  - The parent signal aborts (forwards parent's reason).
 *
 * Races `run` against the abort signal so the returned promise rejects
 * immediately when the signal fires, even if `run` never checks it.
 * Cleaned up in `finally` — no dangling timers or listeners.
 */
export async function withAbortTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error('Operation timed out')),
    timeoutMs,
  );
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<T>((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(controller.signal.reason || new Error('Aborted')),
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onParentAbort);
  }
}
