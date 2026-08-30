import { NextRequest, NextResponse } from 'next/server';
import { enforceMutationOrigin } from '@/lib/server/request-security';
import { backendUrl, forwardToBackend } from '@/lib/server/backend';

const HOP_BY_HOP = new Set([
  'host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authorization', 'proxy-authenticate', 'forwarded',
  'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip',
]);

const FORWARD_HEADERS = new Set([
  'content-type', 'content-disposition', 'cache-control',
  'x-request-id', 'x-correlation-id',
  'x-ratelimit-remaining', 'x-ratelimit-limit', 'x-ratelimit-reset',
]);

const SEGMENT = '[A-Za-z0-9_-]+';
const PROXY_RULES: ReadonlyArray<{ pattern: RegExp; methods: ReadonlySet<string> }> = [
  { pattern: /^health$/, methods: new Set(['GET']) },
  { pattern: /^convert$/, methods: new Set(['POST']) },
  { pattern: /^convert\/bulk$/, methods: new Set(['POST']) },
  { pattern: new RegExp(`^convert\\/${SEGMENT}$`), methods: new Set(['GET']) },
  { pattern: new RegExp(`^convert\\/${SEGMENT}\\/report$`), methods: new Set(['GET']) },
  { pattern: new RegExp(`^convert\\/${SEGMENT}\\/result$`), methods: new Set(['GET']) },
  // BYOK vision provider settings (backend /api/settings/llm)
  { pattern: /^settings\/llm$/, methods: new Set(['GET', 'POST', 'DELETE']) },
  { pattern: /^settings\/llm\/test$/, methods: new Set(['POST']) },
];

export function proxyRequestStatus(path: string, method: string): 200 | 404 | 405 {
  const rule = PROXY_RULES.find(candidate => candidate.pattern.test(path));
  if (!rule) return 404;
  return rule.methods.has(method.toUpperCase()) ? 200 : 405;
}

async function handler(req: NextRequest) {
  const pathSegments = req.nextUrl.pathname
    .replace(/^\/api\/proxy\/?/, '')
    .replace(/\/+$/, '');
  const policyStatus = proxyRequestStatus(pathSegments, req.method);
  if (policyStatus !== 200) {
    return NextResponse.json(
      { error: policyStatus === 404 ? 'Proxy path not allowed' : 'Method not allowed' },
      { status: policyStatus },
    );
  }

  const originError = enforceMutationOrigin(req);
  if (originError) return originError;

  const search = req.nextUrl.search;
  const target = `${backendUrl()}/api/${pathSegments}${search}`;

  const sessionToken = req.cookies.get('docai_session')?.value;

  const forwardedHeaders = new Headers();
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'cookie' || lower === 'authorization') return;
    forwardedHeaders.set(key, value);
  });

  if (sessionToken) {
    forwardedHeaders.set('Authorization', `Bearer ${sessionToken}`);
  }

  // Forward the client's AbortSignal so cancellation propagates end-to-end.
  // NextRequest.signal is available in Next.js 14+.
  const signal = req.signal;

  try {
    const backendRes = await forwardToBackend(req.method, `/api/${pathSegments}${search}`, {
      headers: Object.fromEntries(forwardedHeaders.entries()),
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : null,
      signal,
      streaming: true,
    });

    const responseHeaders = new Headers();
    backendRes.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP.has(lower) || lower === 'set-cookie') return;
      if (FORWARD_HEADERS.has(lower)) {
        responseHeaders.set(key, value);
      }
    });

    if (backendRes.body) {
      return new NextResponse(backendRes.body, {
        status: backendRes.status,
        statusText: backendRes.statusText,
        headers: responseHeaders,
      });
    }

    const resBody = await backendRes.arrayBuffer();
    return new NextResponse(resBody, {
      status: backendRes.status,
      statusText: backendRes.statusText,
      headers: responseHeaders,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return new NextResponse(null, { status: 499 });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[proxy] Backend unreachable at ${target}:`, message);
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
