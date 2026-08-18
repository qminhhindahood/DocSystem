/**
 * Lightweight HTML sanitizer for stored content.
 * Strips <script> tags, event handlers (on*), and javascript: URLs.
 * Used on feedback/document content before persisting to prevent stored XSS.
 */

// Match <script>…</script> (case-insensitive, multiline)
const SCRIPT_TAG_RE = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
// Match event handlers: on\w+\s*=\s*["'][^"']*["']
const EVENT_HANDLER_RE = /\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
// Match javascript: or data: URLs in href/src attributes
const JS_URL_RE = /(href|src)\s*=\s*("|')\s*(javascript|vbscript|data)\s*:/gi;

export function sanitizeHtml(input: string): string {
  return input
    .replace(SCRIPT_TAG_RE, '')
    .replace(EVENT_HANDLER_RE, '')
    .replace(JS_URL_RE, '$1=$2#');
}

export function sanitizeHtmlFields<T extends Record<string, unknown>>(
  data: T,
  fields: (keyof T)[],
): T {
  const sanitized = { ...data };
  for (const field of fields) {
    if (typeof sanitized[field] === 'string') {
      sanitized[field] = sanitizeHtml(sanitized[field] as string) as T[keyof T];
    }
  }
  return sanitized;
}
