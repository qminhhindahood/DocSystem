import { getCloudRunAuthorization } from './cloud-run-auth';

const BACKEND_URL = (process.env.BACKEND_API_URL || 'http://localhost:3001').replace(/\/+$/, '');

export function backendUrl(): string {
  return BACKEND_URL;
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
  const target = `${BACKEND_URL}${path}`;
  const headers: Record<string, string> = {
    ...options.headers,
    ...(await getCloudRunAuthorization(target)),
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
    throw new Error(`Backend unreachable: ${message}`);
  }
}
