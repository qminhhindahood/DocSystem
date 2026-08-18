export function normalizeClientReturnTo(value: string | null): string {
  if (typeof value !== 'string') return '/';
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return '/'; }
  return decoded.startsWith('/') && !decoded.startsWith('//') && !decoded.includes('\\') ? value : '/';
}
