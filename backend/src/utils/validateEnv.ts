import { isLLMProvider, providerRequiresApiKey } from '../constants/llm-providers';
import { getPasswordResetMode } from './password_reset_mode';

const REQUIRED = [
  'DATABASE_URL', 'REDIS_URL',
  'DOCLING_URL', 'EMBEDDINGS_URL', 'JWT_SECRET', 'LLM_CONFIG_ENCRYPTION_KEY',
  'DOCUMENT_RENDERER_URL', 'RENDERER_INTERNAL_TOKEN',
] as const;

const DEV_DEFAULTS = new Set([
  'dev-jwt-secret-do-not-use-in-production',
  'dev-jwt-secret-change-in-production',
  'change-me-to-a-strong-jwt-secret-at-least-32-chars',
  'change-me-to-a-strong-token',
  'test-renderer-token',
]);

const BOOLEAN_VARS = [
  'ALLOW_STACK_TRACES', 'DISABLE_PUBLIC_REGISTER', 'ENABLE_QUERY_REWRITER',
  'ENABLE_SUMMARY_CHUNKS', 'ENABLE_RERANK_FILTER', 'ENABLE_SELF_CORRECT',
  'RAG_OBSERVABILITY', 'EVAL_GENERATE',
] as const;

const NUMERIC_VARS: Record<string, { min: number; max: number; integer?: boolean }> = {
  PORT: { min: 1, max: 65535, integer: true },
  TRUST_PROXY_HOPS: { min: 0, max: 10, integer: true },
  RATE_LIMIT_WINDOW_MS: { min: 1_000, max: 86_400_000, integer: true },
  RATE_LIMIT_MAX: { min: 1, max: 100_000, integer: true },
  DB_CONNECTION_LIMIT: { min: 1, max: 200, integer: true },
  INGESTION_WORKER_LEASE_MS: { min: 10_000, max: 3_600_000, integer: true },
  INGESTION_WORKER_HEARTBEAT_MS: { min: 1_000, max: 600_000, integer: true },
  INGESTION_WORKER_POLL_MS: { min: 50, max: 60_000, integer: true },
  TEMPLATE_WORKER_POLL_MS: { min: 100, max: 60_000, integer: true },
  MAX_TEMPLATES_PER_USER: { min: 1, max: 10_000, integer: true },
  MAX_PENDING_TEMPLATES_PER_USER: { min: 1, max: 100, integer: true },
  SHUTDOWN_GRACE_MS: { min: 1_000, max: 300_000, integer: true },
  RAG_MAX_RETRIES: { min: 0, max: 1, integer: true },
  RAG_RETRIEVAL_CANDIDATES: { min: 1, max: 100, integer: true },
  RAG_MAX_QUERY_VARIANTS: { min: 1, max: 10, integer: true },
  RAG_CONTEXT_MAX_CHARS: { min: 1_000, max: 100_000, integer: true },
  RAG_QUERY_EMBED_CACHE_TTL_SECONDS: { min: 1, max: 86_400, integer: true },
  RAG_RERANK_CHUNK_CHARS: { min: 200, max: 4_000, integer: true },
  RAG_RERANK_MAX_CHARS: { min: 2_000, max: 40_000, integer: true },
  EMBEDDINGS_BATCH_TIMEOUT_MS: { min: 5_000, max: 900_000, integer: true },
  RAG_RRF_K: { min: 1, max: 1_000 },
  RAG_OVERFETCH_MULTIPLIER: { min: 1, max: 20 },
  RAG_FAITHFULNESS_MIN: { min: 0, max: 1 },
  RAG_ANSWERABILITY_MIN: { min: 0, max: 1 },
};

function validateUrl(name: string, protocols: string[], allowCredentials = false): void {
  const raw = process.env[name]!;
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`${name} must be a valid URL`); }
  if (!protocols.includes(url.protocol)) throw new Error(`${name} must use ${protocols.join(' or ')}`);
  if (!allowCredentials && (url.username || url.password)) throw new Error(`${name} must not contain credentials`);
  if (!allowCredentials && (url.search || url.hash)) throw new Error(`${name} must not contain a query or fragment`);
}

export function isPublicRegistrationDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISABLE_PUBLIC_REGISTER === 'true'
    || (env.NODE_ENV === 'production' && env.DISABLE_PUBLIC_REGISTER !== 'false');
}

export interface AccountCredentials {
  username: string;
  email: string;
  password: string;
}

export function normalizeUsername(raw: string): string {
  const username = raw.trim();
  if (username.length < 3 || username.length > 50) {
    throw new Error('Username must contain between 3 and 50 characters');
  }
  return username;
}

export function validateAccountPassword(password: string): string {
  if (password.length < 8 || password.length > 100) {
    throw new Error('Password must contain between 8 and 100 characters');
  }
  return password;
}

/** Normalize and validate credentials shared by registration and operator bootstrap. */
export function normalizeAccountCredentials(input: AccountCredentials): AccountCredentials {
  const username = normalizeUsername(input.username);
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Email must be a valid address');
  }
  const password = validateAccountPassword(input.password);
  return { username, email, password };
}

export function validateEnv(): void {
  const missing = REQUIRED.filter(key => !process.env[key]?.trim());
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);

  const isProd = process.env.NODE_ENV === 'production';
  if (process.env.NODE_ENV && !['development', 'test', 'production'].includes(process.env.NODE_ENV)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  const resetMode = getPasswordResetMode();
  if (isProd && !isPublicRegistrationDisabled()) {
    if (!process.env.TURNSTILE_SECRET_KEY?.trim()) {
      throw new Error('TURNSTILE_SECRET_KEY is required when public registration is enabled');
    }
    const hostnames = (process.env.TURNSTILE_EXPECTED_HOSTNAMES ?? '')
      .split(',').map(value => value.trim()).filter(Boolean);
    if (!hostnames.length) {
      throw new Error('TURNSTILE_EXPECTED_HOSTNAMES is required when public registration is enabled');
    }
    for (const hostname of hostnames) {
      if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostname)) {
        throw new Error(`Invalid TURNSTILE_EXPECTED_HOSTNAMES value: "${hostname}"`);
      }
    }
  }
  const jwtSecret = process.env.JWT_SECRET!;
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  if (isProd && DEV_DEFAULTS.has(jwtSecret)) throw new Error('JWT_SECRET is a known dev default');
  const encryptionKey = process.env.LLM_CONFIG_ENCRYPTION_KEY!;
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) {
    throw new Error('LLM_CONFIG_ENCRYPTION_KEY must be 64 hex characters (AES-256-GCM)');
  }
  const rendererToken = process.env.RENDERER_INTERNAL_TOKEN!;
  if (rendererToken.length < 32 || rendererToken.trim() !== rendererToken
    || new Set(rendererToken).size < 10 || DEV_DEFAULTS.has(rendererToken)) {
    throw new Error('RENDERER_INTERNAL_TOKEN must be a strong value of at least 32 characters');
  }

  validateUrl('DATABASE_URL', ['postgres:', 'postgresql:'], true);
  validateUrl('REDIS_URL', ['redis:', 'rediss:'], true);
  for (const name of ['DOCLING_URL', 'EMBEDDINGS_URL', 'DOCUMENT_RENDERER_URL']) {
    validateUrl(name, ['http:', 'https:']);
  }

  if (resetMode === 'email') {
    if (Boolean(process.env.SMTP_USER?.trim()) !== Boolean(process.env.SMTP_PASS?.trim())) {
      throw new Error('SMTP_USER and SMTP_PASS must be configured together');
    }
    if (isProd) {
      const mailRequired = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'PASSWORD_RESET_BASE_URL'];
      const missingMail = mailRequired.filter(name => !process.env[name]?.trim());
      if (missingMail.length) throw new Error(`Missing required password-reset env vars: ${missingMail.join(', ')}`);
      if (!/^[^\s/:]+(?:\.[^\s/:]+)*$/.test(process.env.SMTP_HOST!)) {
        throw new Error('SMTP_HOST must be a hostname without a scheme or port');
      }
      const smtpPort = Number(process.env.SMTP_PORT);
      if (!Number.isSafeInteger(smtpPort) || smtpPort < 1 || smtpPort > 65_535) {
        throw new Error('SMTP_PORT must be an integer between 1 and 65535');
      }
      const fromAddress = process.env.SMTP_FROM!.match(/<([^<>]+)>$/)?.[1] ?? process.env.SMTP_FROM!;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress.trim())) {
        throw new Error('SMTP_FROM must contain a valid email address');
      }
      let resetBaseUrl: URL;
      try { resetBaseUrl = new URL(process.env.PASSWORD_RESET_BASE_URL!); }
      catch { throw new Error('PASSWORD_RESET_BASE_URL must be a valid HTTPS URL'); }
      if (resetBaseUrl.protocol !== 'https:') {
        throw new Error('PASSWORD_RESET_BASE_URL must use HTTPS in production');
      }
      validateUrl('PASSWORD_RESET_BASE_URL', ['https:']);
    }
  }

  const defaultLlmValues = [
    process.env.DEFAULT_LLM_PROVIDER,
    process.env.DEFAULT_LLM_BASE_URL,
    process.env.DEFAULT_LLM_MODEL,
    process.env.DEFAULT_LLM_API_KEY,
  ];
  if (defaultLlmValues.some(value => value?.trim())) {
    const provider = process.env.DEFAULT_LLM_PROVIDER;
    if (!provider || !isLLMProvider(provider)) {
      throw new Error('DEFAULT_LLM_PROVIDER must be openai, openrouter, gemini, lmstudio, ollama, or custom');
    }
    if (!process.env.DEFAULT_LLM_BASE_URL?.trim() || !process.env.DEFAULT_LLM_MODEL?.trim()) {
      throw new Error('DEFAULT_LLM_BASE_URL and DEFAULT_LLM_MODEL are required when a system LLM default is configured');
    }
    validateUrl('DEFAULT_LLM_BASE_URL', ['http:', 'https:']);
    if (providerRequiresApiKey(provider) && !process.env.DEFAULT_LLM_API_KEY?.trim()) {
      throw new Error('DEFAULT_LLM_API_KEY is required for cloud system defaults');
    }
  }

  for (const name of BOOLEAN_VARS) {
    const value = process.env[name];
    if (value !== undefined && value !== 'true' && value !== 'false') {
      throw new Error(`${name} must be exactly "true" or "false"`);
    }
  }
  for (const [name, limits] of Object.entries(NUMERIC_VARS)) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || (limits.integer && !Number.isSafeInteger(value))
      || value < limits.min || value > limits.max) {
      throw new Error(`${name} must be ${limits.integer ? 'an integer' : 'a number'} between ${limits.min} and ${limits.max}`);
    }
  }
  const lease = Number(process.env.INGESTION_WORKER_LEASE_MS || 15 * 60_000);
  const heartbeat = Number(process.env.INGESTION_WORKER_HEARTBEAT_MS || 30_000);
  if (heartbeat >= lease) throw new Error('INGESTION_WORKER_HEARTBEAT_MS must be less than INGESTION_WORKER_LEASE_MS');
  const maxTemplates = Number(process.env.MAX_TEMPLATES_PER_USER || 100);
  const maxPendingTemplates = Number(process.env.MAX_PENDING_TEMPLATES_PER_USER || 5);
  if (maxPendingTemplates > maxTemplates) {
    throw new Error('MAX_PENDING_TEMPLATES_PER_USER must not exceed MAX_TEMPLATES_PER_USER');
  }

  const localAllowlist = process.env.LOCAL_LLM_HOST_ALLOWLIST;
  if (localAllowlist) {
    for (const entry of localAllowlist.split(',').map(value => value.trim()).filter(Boolean)) {
      let parsed: URL;
      try { parsed = new URL(`http://${entry}`); } catch { throw new Error(`Invalid LOCAL_LLM_HOST_ALLOWLIST entry: "${entry}"`); }
      if (!parsed.hostname || !parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) {
        throw new Error(`Invalid LOCAL_LLM_HOST_ALLOWLIST entry: "${entry}"; expected host:port`);
      }
    }
  }

  const rawCors = process.env.CORS_ORIGIN;
  if (isProd && !rawCors) throw new Error('CORS_ORIGIN is required in production');
  if (rawCors) {
    const origins = rawCors.split(',').map(origin => origin.trim()).filter(Boolean);
    if (!origins.length || origins.includes('*')) throw new Error('CORS_ORIGIN cannot contain * when credentials are enabled');
    for (const origin of origins) {
      let parsed: URL;
      try { parsed = new URL(origin); } catch { throw new Error(`Invalid CORS_ORIGIN value: "${origin}"`); }
      if (parsed.origin !== origin.replace(/\/$/, '') || !['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`Invalid CORS_ORIGIN value: "${origin}"; expected an origin without a path`);
      }
      if (isProd && parsed.protocol !== 'https:') throw new Error('CORS_ORIGIN must use HTTPS in production');
    }
  }
}
