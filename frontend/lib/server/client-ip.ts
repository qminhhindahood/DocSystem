import { isIP } from 'node:net';
import { NextRequest } from 'next/server';

function trustedProxyHops(): number {
  const raw = process.env.FRONTEND_TRUST_PROXY_HOPS ?? process.env.TRUST_PROXY_HOPS ?? '0';
  const hops = Number.parseInt(raw, 10);
  return Number.isSafeInteger(hops) && hops > 0 ? hops : 0;
}

export function deriveClientIp(request: NextRequest): string | undefined {
  const hops = trustedProxyHops();
  if (!hops) return undefined;
  const chain = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const candidate = chain[chain.length - hops];
  return candidate && isIP(candidate) ? candidate : undefined;
}
