/**
 * SSRF guard for user-supplied provider URLs (BYOK vision settings).
 *
 * The standalone product supports one cloud provider only (Gemini),
 * so every provider URL must resolve to an ordinary globally routable
 * address. The master stack's local-provider allowlist (lmstudio/ollama) was
 * deleted with the generation surface and stays deleted.
 */
import dns from 'dns';
import net from 'net';

export interface ValidatedProviderTarget {
  baseUrl: string;
  hostname: string;
  port: number;
  addresses: ReadonlyArray<{ address: string; family: 4 | 6 }>;
}

const META_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata',
  '169.254.169.254',
  'fd00:ec2::254',
]);

type AddressBytes = { family: 4 | 6; bytes: number[] };

function parseIPv4(address: string): number[] | null {
  if (!net.isIPv4(address)) return null;
  const bytes = address.split('.').map(Number);
  return bytes.length === 4 && bytes.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    ? bytes
    : null;
}

function parseIPv6(address: string): number[] | null {
  const withoutZone = address.split('%', 1)[0].toLowerCase();
  if (!net.isIPv6(withoutZone)) return null;

  let input = withoutZone;
  let embedded: number[] | null = null;
  const lastColon = input.lastIndexOf(':');
  const tail = input.slice(lastColon + 1);
  if (tail.includes('.')) {
    embedded = parseIPv4(tail);
    if (!embedded) return null;
    input = `${input.slice(0, lastColon)}:${((embedded[0] << 8) | embedded[1]).toString(16)}:${((embedded[2] << 8) | embedded[3]).toString(16)}`;
  }

  const halves = input.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array(missing).fill('0'), ...right].map(word => Number.parseInt(word, 16));
  if (words.length !== 8 || words.some(word => !Number.isInteger(word) || word < 0 || word > 0xffff)) return null;
  return words.flatMap(word => [word >>> 8, word & 0xff]);
}

function parseAddress(address: string): AddressBytes | null {
  const v4 = parseIPv4(address);
  if (v4) return { family: 4, bytes: v4 };
  const v6 = parseIPv6(address);
  return v6 ? { family: 6, bytes: v6 } : null;
}

function hasPrefix(bytes: number[], prefix: number[], bits: number): boolean {
  const wholeBytes = Math.floor(bits / 8);
  for (let i = 0; i < wholeBytes; i += 1) {
    if (bytes[i] !== prefix[i]) return false;
  }
  const remaining = bits % 8;
  if (remaining === 0) return true;
  const mask = 0xff << (8 - remaining);
  return (bytes[wholeBytes] & mask) === (prefix[wholeBytes] & mask);
}

function v4In(bytes: number[], prefix: number[], bits: number): boolean {
  return hasPrefix(bytes, prefix, bits);
}

/** True only for ordinary globally routable IPv4 addresses. */
function isGlobalIPv4(bytes: number[]): boolean {
  const special: Array<[number[], number]> = [
    [[0, 0, 0, 0], 8],            // this network / unspecified
    [[10, 0, 0, 0], 8],           // private
    [[100, 64, 0, 0], 10],        // carrier-grade NAT
    [[127, 0, 0, 0], 8],          // loopback
    [[169, 254, 0, 0], 16],       // link-local
    [[172, 16, 0, 0], 12],        // private
    [[192, 0, 0, 0], 24],         // IETF protocol assignments
    [[192, 0, 2, 0], 24],         // documentation
    [[192, 31, 196, 0], 24],      // AS112 special-purpose service
    [[192, 52, 193, 0], 24],      // Automatic Multicast Tunneling
    [[192, 88, 99, 0], 24],       // deprecated 6to4 relay
    [[192, 168, 0, 0], 16],       // private
    [[192, 175, 48, 0], 24],      // AS112 special-purpose service
    [[198, 18, 0, 0], 15],        // benchmarking
    [[198, 51, 100, 0], 24],      // documentation
    [[203, 0, 113, 0], 24],       // documentation
    [[224, 0, 0, 0], 4],          // multicast
    [[240, 0, 0, 0], 4],          // reserved / limited broadcast
  ];
  return !special.some(([prefix, bits]) => v4In(bytes, prefix, bits));
}

function mappedIPv4(bytes: number[]): number[] | null {
  const mappedPrefix = bytes.slice(0, 10).every(byte => byte === 0)
    && bytes[10] === 0xff && bytes[11] === 0xff;
  return mappedPrefix ? bytes.slice(12) : null;
}

/** True only for ordinary globally routable IPv6 unicast addresses. */
function isGlobalIPv6(bytes: number[]): boolean {
  const mapped = mappedIPv4(bytes);
  if (mapped) return isGlobalIPv4(mapped);

  // Global unicast currently occupies 2000::/3. Reject all other address
  // classes, including unspecified, loopback, ULA, link-local and multicast.
  if (!hasPrefix(bytes, [0x20], 3)) return false;

  const special: Array<[number[], number]> = [
    [[0x20, 0x01, 0x00], 23],       // IETF IPv6 special-purpose registry
    [[0x20, 0x01, 0x00, 0x00], 32], // Teredo
    [[0x20, 0x01, 0x00, 0x01], 32], // protocol/anycast assignments
    [[0x20, 0x01, 0x00, 0x02], 48], // benchmarking
    [[0x20, 0x01, 0x00, 0x03], 32], // AMT
    [[0x20, 0x01, 0x00, 0x04, 0x01, 0x12], 48], // AS112
    [[0x20, 0x01, 0x00, 0x10], 28], // ORCHID
    [[0x20, 0x01, 0x00, 0x20], 28], // ORCHIDv2
    [[0x20, 0x01, 0x0d, 0xb8], 32], // documentation
    [[0x20, 0x02], 16],             // deprecated 6to4
    [[0x26, 0x20, 0x00, 0x4f, 0x80, 0x00], 48], // AS112 special-purpose service
    [[0x3f, 0xff], 20],             // documentation
  ];
  return !special.some(([prefix, bits]) => hasPrefix(bytes, prefix, bits));
}

export function isGlobalAddress(address: string): boolean {
  const parsed = parseAddress(address);
  if (!parsed) return false;
  return parsed.family === 4 ? isGlobalIPv4(parsed.bytes) : isGlobalIPv6(parsed.bytes);
}

function isMetadataAddress(address: string): boolean {
  const parsed = parseAddress(address);
  if (!parsed) return false;
  if (parsed.family === 4) return parsed.bytes.join('.') === '169.254.169.254';
  const mapped = mappedIPv4(parsed.bytes);
  if (mapped?.join('.') === '169.254.169.254') return true;
  const ec2 = parseIPv6('fd00:ec2::254');
  return Boolean(ec2 && parsed.bytes.every((byte, index) => byte === ec2[index]));
}

function normalizeHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1).toLowerCase()
    : hostname.toLowerCase();
}

export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map(entry => entry.trim().toLowerCase()).filter(Boolean);
}

export async function validateProviderTarget(
  baseUrl: string,
  provider: string,
  allowlist: string[],
): Promise<ValidatedProviderTarget> {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('Invalid provider URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed');
  }
  if (parsed.username || parsed.password) throw new Error('URL must not contain embedded credentials');
  if (parsed.search || parsed.hash) throw new Error('Provider URL must not contain a query or fragment');

  const hostname = normalizeHostname(parsed.hostname);
  const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
  if (META_HOSTNAMES.has(hostname)) throw new Error('Metadata hostname is blocked');

  let resolved: dns.LookupAddress[];
  try {
    resolved = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`Cannot resolve host: ${hostname}`);
  }
  if (resolved.length === 0) throw new Error(`Cannot resolve host: ${hostname}`);

  const addresses = resolved.map(({ address }) => {
    const parsedAddress = parseAddress(address);
    if (!parsedAddress) throw new Error('URL resolved to an invalid address');
    return { address, family: parsedAddress.family };
  });
  if (addresses.some(({ address }) => isMetadataAddress(address))) {
    throw new Error('Metadata endpoint is blocked');
  }
  const hasNonGlobal = addresses.some(({ address }) => !isGlobalAddress(address));
  if (hasNonGlobal) {
    // Cloud-only product: no local-provider allowlist. The allowlist argument
    // stays in the signature for future policy but is always empty today.
    if (allowlist.length > 0) {
      throw new Error(`Provider URL "${baseUrl}" resolves to a non-global address and no local providers are supported`);
    }
    throw new Error(`URL resolves to a non-global/private/special address - not allowed for provider "${provider}"`);
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    hostname,
    port,
    addresses,
  };
}
