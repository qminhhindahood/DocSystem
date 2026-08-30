import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function trustedProxyHops(): number {
  const value = process.env.FRONTEND_TRUST_PROXY_HOPS ?? process.env.TRUST_PROXY_HOPS ?? '0';
  const hops = Number.parseInt(value, 10);
  return Number.isFinite(hops) && hops > 0 ? hops : 0;
}

function forwardedValue(value: string | null, hops: number): string | null {
  if (!value) return null;
  const values = value.split(',').map(part => part.trim()).filter(Boolean);
  const index = values.length - hops;
  return index >= 0 ? values[index] ?? null : null;
}

function trustedForwardedOrigin(request: NextRequest): string | null {
  const hops = trustedProxyHops();
  if (!hops) return null;

  const host = forwardedValue(request.headers.get('x-forwarded-host'), hops);
  const protocol = forwardedValue(request.headers.get('x-forwarded-proto'), hops);
  if (!host || (protocol !== 'http' && protocol !== 'https')) return null;

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

function directRequestOrigin(request: NextRequest): string | null {
  const host = request.headers.get('host')?.trim();
  const protocol = request.nextUrl.protocol;
  if (!host || !['http:', 'https:'].includes(protocol) || /[\s,/@\\]/.test(host)) {
    return null;
  }
  try {
    return new URL(`${protocol}//${host}`).origin;
  } catch {
    return null;
  }
}

function hasInternalAuthentication(request: NextRequest): boolean {
  const expected = process.env.FRONTEND_INTERNAL_API_TOKEN;
  const authorization = request.headers.get('authorization');
  if (!expected || !authorization?.startsWith('Bearer ')) return false;

  const supplied = authorization.slice('Bearer '.length);
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

/** Enforce same-origin browser mutations while permitting explicitly authenticated internal calls. */
export function enforceMutationOrigin(request: NextRequest): NextResponse | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;

  const originHeader = request.headers.get('origin');
  if (!originHeader) {
    return hasInternalAuthentication(request)
      ? null
      : NextResponse.json({ error: 'Origin header required' }, { status: 403 });
  }

  let suppliedOrigin: string;
  try {
    const parsed = new URL(originHeader);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Invalid protocol');
    suppliedOrigin = parsed.origin;
  } catch {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }

  const allowedOrigins = new Set([request.nextUrl.origin]);
  const directOrigin = directRequestOrigin(request);
  if (directOrigin) allowedOrigins.add(directOrigin);
  const forwardedOrigin = trustedForwardedOrigin(request);
  if (forwardedOrigin) allowedOrigins.add(forwardedOrigin);

  return allowedOrigins.has(suppliedOrigin)
    ? null
    : NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
}
