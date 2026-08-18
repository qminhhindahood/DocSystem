import { useEffect, useState } from 'react';

/**
 * Delays propagating a value until it has stopped changing for `delayMs`.
 *
 * Use for search input so keystrokes stay immediate in the field while only the
 * settled value enters a query key and reaches the network.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
