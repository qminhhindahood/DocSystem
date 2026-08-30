/** Redis connection lifecycle and the rate-limit client seam. */
import { createClient, RedisClientType } from 'redis';

type EvalOptions = {
  keys: string[];
  arguments?: string[];
};

/** Local adapter used only when startup cannot reach Redis. */
class InMemoryRateLimitClient {
  private readonly counters = new Map<string, number>();
  private readonly ttls = new Map<string, NodeJS.Timeout>();

  async eval(script: string, options: EvalOptions): Promise<number> {
    if (!script.includes('INCR') || !script.includes('EXPIRE')) {
      throw new Error('Unsupported in-memory Redis operation');
    }
    const key = options.keys[0];
    const ttlSeconds = Number.parseInt(options.arguments?.[0] ?? '', 10);
    if (!key || !Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error('Invalid rate-limit script arguments');
    }

    const count = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, count);
    if (count === 1) this.setExpiry(key, ttlSeconds);
    return count;
  }

  private setExpiry(key: string, ttlSeconds: number): void {
    const existing = this.ttls.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.counters.delete(key);
      this.ttls.delete(key);
    }, ttlSeconds * 1_000);
    timer.unref?.();
    this.ttls.set(key, timer);
  }

  close(): void {
    for (const timer of this.ttls.values()) clearTimeout(timer);
    this.ttls.clear();
    this.counters.clear();
  }
}

class RedisClient {
  private readonly client: RedisClientType;
  private readonly fallbackClient = new InMemoryRateLimitClient();
  private initialized = false;
  private useFallback = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.client = createClient({
      url: redisUrl,
      disableOfflineQueue: true,
      socket: {
        reconnectStrategy: (retries: number) => {
          if (retries > 3) {
            console.error('[RedisClient] Max reconnection attempts reached. Switching to in-memory fallback.');
            this.useFallback = true;
            return false;
          }
          const delay = Math.min((2 ** retries) * 50 + Math.random() * 100, 1_000);
          console.warn(`[RedisClient] Connection lost. Reconnecting in ${Math.round(delay)}ms... (attempt ${retries})`);
          return delay;
        },
      },
    });

    this.client.on('error', (error) => {
      if (!this.useFallback) console.error('Redis Client Error:', error);
    });
    this.client.on('connect', () => console.log('Redis client connected'));
    this.client.on('ready', () => console.log('Redis client ready'));
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.client.connect();
      console.log('Redis initialized successfully');
    } catch {
      console.error('Failed to initialize Redis. Switching to in-memory fallback.');
      this.useFallback = true;
    } finally {
      this.initialized = true;
    }
  }

  async isConnected(): Promise<boolean> {
    if (this.useFallback) return false;
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  get isFallback(): boolean {
    return this.useFallback;
  }

  /** Raw client used by the rate-limit middleware's one atomic Lua script. */
  getClient(): any {
    return this.useFallback ? this.fallbackClient : this.client;
  }

  async close(timeoutMs = 5_000): Promise<void> {
    this.fallbackClient.close();
    try {
      if (!this.client.isOpen) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.client.quit(),
          new Promise<void>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Redis quit timed out')), timeoutMs);
          }),
        ]);
      } catch {
        if (this.client.isOpen) await this.client.disconnect();
      } finally {
        if (timer) clearTimeout(timer);
      }
    } finally {
      this.initialized = false;
    }
  }
}

export const redisClient = new RedisClient();
