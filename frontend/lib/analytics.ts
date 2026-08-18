'use client';

// Thin client wrapper — analytics.ts is isomorphic-safe.
// No global listeners here; individual pages call track() on user actions.

const ANALYTICS_ENDPOINT = '/api/analytics/track';

interface TrackPayload {
  event: string;
  timestamp?: number;
  category?: string;
  label?: string;
  value?: number;
  metadata?: Record<string, string | number | boolean>;
}

const queue: TrackPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL = 5000; // 5s batching
const MAX_QUEUE = 50;

function flush() {
  if (queue.length === 0) return;
  const batch = queue.splice(0);
  if (navigator.sendBeacon) {
    navigator.sendBeacon(ANALYTICS_ENDPOINT, JSON.stringify({ events: batch }));
  } else {
    void fetch(ANALYTICS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      }).catch(() => {});
  }
}

export function track(
  event: string,
  options?: Omit<TrackPayload, 'event'>,
) {
  if (typeof window === 'undefined') return;

  const payload: TrackPayload = {
    event,
    timestamp: Date.now(),
    ...options,
  };

  queue.push(payload);

  if (queue.length >= MAX_QUEUE) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flush();
    return;
  }

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, FLUSH_INTERVAL);
  }
}

/**
 * Track page view — call once in layout or page useEffect.
 */
export function trackPageView(page: string) {
  track('page_view', { category: 'navigation', label: page });
}
