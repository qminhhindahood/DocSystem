/**
 * Utility Functions for Feedback Loop
 *
 * Shared utilities for timeout handling, validation, and common operations.
 */

/**
 * Execute a function with a timeout limit
 *
 * @param fn - Async function to execute
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns Promise resolving to function result
 * @throws Error if timeout exceeded
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = 30000
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Validate feedback content length
 *
 * @param originalContent - Original document content
 * @param editedContent - Edited document content
 * @param minLength - Minimum acceptable length (default: 10)
 * @throws Error if content is too short
 */
export function validateContentLength(
  originalContent: string,
  editedContent: string,
  minLength: number = 10
): void {
  if (originalContent.length < minLength) {
    throw new Error(
      `Original content too short (length: ${originalContent.length}, minimum: ${minLength})`
    );
  }

  if (editedContent.length < minLength) {
    throw new Error(
      `Edited content too short (length: ${editedContent.length}, minimum: ${minLength})`
    );
  }
}

/**
 * Check if two texts are identical
 *
 * @param original - Original text
 * @param edited - Edited text
 * @returns true if texts are exactly the same
 */
export function areContentsIdentical(original: string, edited: string): boolean {
  return original.trim() === edited.trim();
}

/**
 * Normalize Vietnamese text for comparison
 *
 * @param text - Text to normalize
 * @returns Normalized text with diacritics removed
 */
export function normalizeVietnamese(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate Levenshtein distance between two strings
 *
 * @param a - First string
 * @param b - Second string
 * @returns Edit distance (number of operations)
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Tokenize text by normalizing Vietnamese and splitting into words
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Remove diacritics
    .split(/\s+/)
    .filter(w => w.length > 0);
}

/**
 * Calculate Jaccard similarity between two strings
 * Uses token-set based comparison (not character-level).
 *
 * @param a - First string
 * @param b - Second string
 * @returns Similarity score (0.0 to 1.0)
 */
export function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(tokenize(a));
  const wordsB = new Set(tokenize(b));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 1 : intersection / union;
}

/**
 * Acquire a distributed lock in Redis
 *
 * @param redisClient - Redis client instance
 * @param lockKey - Lock key name
 * @param lockValue - Unique lock value (e.g., timestamp)
 * @param ttlSeconds - Lock TTL in seconds
 * @returns true if lock acquired, false if already locked
 */
export async function acquireLock(
  redisClient: any,
  lockKey: string,
  lockValue: string,
  ttlSeconds: number = 3600
): Promise<boolean> {
  const result = await redisClient.setNx(lockKey, lockValue, { EX: ttlSeconds });
  return result;
}

/**
 * Release a distributed lock using Lua compare-and-delete.
 * H16: simple `del` without comparing the value would let any caller
 * release someone else's lock (e.g., after a long GC pause that expired
 * the original lock). The Lua script atomically checks the value first:
 * "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end"
 */
export async function releaseLock(redisClient: any, lockKey: string, lockValue?: string): Promise<void> {
  if (!lockValue) {
    // Legacy path — no fencing token. Delete unconditionally (less safe but
    // preserves backward compat for callers that don't track the token).
    await redisClient.del(lockKey);
    return;
  }
  // Atomically: DEL only if the value matches (fencing token).
  const script = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;
  await redisClient.eval(script, { keys: [lockKey], arguments: [lockValue] });
}

/**
 * Execute function with distributed lock
 *
 * @param redisClient - Redis client instance
 * @param lockKey - Lock key name
 * @param fn - Function to execute while locked
 * @param ttlSeconds - Lock TTL in seconds
 * @returns Function result
 * @throws Error if lock cannot be acquired
 */
export async function withLock<T>(
  redisClient: any,
  lockKey: string,
  fn: () => Promise<T>,
  ttlSeconds: number = 3600
): Promise<T> {
  // H16: fencing token = timestamp + random jitter so value is globally unique.
  const lockValue = `lock:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const acquired = await acquireLock(redisClient, lockKey, lockValue, ttlSeconds);

  if (!acquired) {
    throw new Error(`Could not acquire lock: ${lockKey}`);
  }

  try {
    return await fn();
  } finally {
    // H16: pass the fencing token so releaseLock uses compare-and-delete.
    await releaseLock(redisClient, lockKey, lockValue);
  }
}