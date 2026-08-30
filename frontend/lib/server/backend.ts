const FALLBACK_BACKEND_URL = 'http://localhost:3001';

/**
 * Resolve the backend origin per call, not at module load.
 *
 * On Cloudflare Workers (Pages via @opennextjs/cloudflare) the platform env
 * vars are copied into process.env at REQUEST time by the adapter's init
 * (populateProcessEnv) — after worker startup. A module-load-time const would
 * freeze to the localhost fallback and every proxied request would fail in
 * production. Reading per call is the compatible shape for both the Node
 * dev/standalone server and the worker runtime.
 */
export function backendUrl(): string {
  return (process.env.BACKEND_API_URL || FALLBACK_BACKEND_URL).replace(/\/+$/, '');
}

export async function forwardToBackend(
  method: string,
  path: string,
  options: {
    body?: BodyInit | null;
    headers?: Record<string, string>;
    streaming?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<Response> {
  const target = `${'$'}{backendUrl()}${'$'}{path}`;
  const headers: Record<string, string> = {
    ...options.headers,
  };
  const init: RequestInit & { duplex?: string } = { method, headers, signal: options.signal };

  if (options.body) {
    init.body = options.body;
    init.duplex = 'half';
  }

  try {
    const backendRes = await fetch(target, init);
    return backendRes;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Backend unreachable: ${'$'}{message}`);
  }
}
