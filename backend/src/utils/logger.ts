import { createHash, randomBytes } from 'node:crypto';
import pino, { type DestinationStream, type Logger } from 'pino';

const REDACTED = '[Redacted]';
const userHashSalt = randomBytes(32);
const sensitiveKey = /^(?:authorization|cookie|set-cookie|password|passwordconfirmation|token|resettoken|apikey|smtppass|body|documentbody|payload|raw)$/i;

function sanitizeString(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,"'}]+/gi, `Bearer ${REDACTED}`)
    .replace(/((?:password|token|api[_-]?key|cookie|authorization)\s*[=:]\s*)[^\s,;"'}]+/gi, `$1${REDACTED}`);
}

function sanitizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return sanitizeString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (value instanceof Error) {
    return { name: value.name, message: sanitizeString(value.message) };
  }
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item, seen));

  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    sensitiveKey.test(key) ? REDACTED : sanitizeValue(nested, seen),
  ]));
}

export function hashUserId(userId: string): string {
  return createHash('sha256').update(userHashSalt).update(userId).digest('hex');
}

export function createLogger(
  destination?: DestinationStream,
  identity: { service?: string; revision?: string } = {},
): Logger {
  return pino({
    base: {
      service: identity.service || process.env.K_SERVICE || 'docai-backend',
      revision: identity.revision || process.env.K_REVISION || 'local',
    },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
      level: label => ({ severity: label.toUpperCase() }),
    },
    hooks: {
      logMethod(args, method) {
        method.apply(this, args.map(value => sanitizeValue(value)) as Parameters<typeof method>);
      },
    },
  }, destination);
}

export const logger = createLogger();
