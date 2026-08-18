/**
 * Redis Client for State Persistence
 *
 * Provides session state management for the agent workflow using Redis.
 * Supports TTL-based expiration for automatic cleanup.
 * Falls back to an in-memory storage if Redis is not running/available.
 */

import { createClient, RedisClientType } from 'redis';

export interface RedisState {
  sessionId: string;
  userPrompt: string;
  docType?: string;
  documentOutline?: string;
  researchResults?: any[];
  draftContent?: string;
  finalContent?: string;
  intent?: string;
  entities?: Record<string, any>;
  templateId?: string;
  formatResult?: string;
  /** Error message stored when status === 'error' — does not clobber draftContent */
  errorMessage?: string;
  status: 'parsing' | 'extracting' | 'retrieving' | 'building' | 'outlining' | 'writing' | 'validating' | 'formatting' | 'complete' | 'error';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * In-Memory Fallback Client when Redis is not available
 */
class InMemoryRedisClient {
  private store = new Map<string, string>();
  private lists = new Map<string, string[]>();
  private ttls = new Map<string, NodeJS.Timeout>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, options?: { EX?: number; NX?: boolean }): Promise<string | null> {
    if (options?.NX && this.store.has(key)) {
      return null;
    }
    this.store.set(key, value);
    if (options?.EX) {
      this.setExpiry(key, options.EX);
    }
    return 'OK';
  }

  async setEx(key: string, ttlSeconds: number, value: string): Promise<string> {
    this.store.set(key, value);
    this.setExpiry(key, ttlSeconds);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.store.has(key) || this.lists.has(key);
    this.store.delete(key);
    this.lists.delete(key);
    const timeout = this.ttls.get(key);
    if (timeout) {
      clearTimeout(timeout);
      this.ttls.delete(key);
    }
    return existed ? 1 : 0;
  }

  async lPush(key: string, value: string): Promise<number> {
    if (!this.lists.has(key)) {
      this.lists.set(key, []);
    }
    const list = this.lists.get(key)!;
    list.unshift(value); // Left push
    return list.length;
  }

  async rPop(key: string): Promise<string | null> {
    const list = this.lists.get(key);
    if (!list || list.length === 0) return null;
    return list.pop() ?? null; // Right pop
  }

  async rPopLPush(source: string, destination: string): Promise<string | null> {
    const value = await this.rPop(source);
    if (value !== null) await this.lPush(destination, value);
    return value;
  }

  async lRem(key: string, count: number, value: string): Promise<number> {
    const list = this.lists.get(key) || [];
    const kept: string[] = [];
    let removed = 0;
    for (const entry of list) {
      if (entry === value && (count === 0 || removed < Math.abs(count))) removed++;
      else kept.push(entry);
    }
    this.lists.set(key, kept);
    return removed;
  }

  async incr(key: string): Promise<number> {
    const val = this.store.get(key);
    const num = val ? parseInt(val, 10) : 0;
    if (isNaN(num)) throw new Error('Value is not an integer');
    const newVal = num + 1;
    this.store.set(key, String(newVal));
    return newVal;
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    if (!this.store.has(key) && !this.lists.has(key)) return 0;
    this.setExpiry(key, ttlSeconds);
    return 1;
  }

  private setExpiry(key: string, ttlSeconds: number) {
    const existing = this.ttls.get(key);
    if (existing) clearTimeout(existing);

    const timeout = setTimeout(() => {
      this.store.delete(key);
      this.lists.delete(key);
      this.ttls.delete(key);
    }, ttlSeconds * 1000);
    
    // Unref the timer so it doesn't keep the Node process alive
    if (timeout.unref) {
      timeout.unref();
    }
    this.ttls.set(key, timeout);
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async eval(script: string, options: { keys: string[]; arguments?: string[] }): Promise<any> {
    const key = options.keys[0];
    const args = options.arguments || [];
    if (script.includes('INCR') && script.includes('EXPIRE')) {
      // Rate limiter script
      const count = await this.incr(key);
      if (count === 1) {
        const ttl = parseInt(args[0], 10);
        await this.expire(key, ttl);
      }
      return count;
    } else if (script.includes('LRANGE') && script.includes('cjson.decode')) {
      // removeFromQueue script
      const target = args[0];
      const list = this.lists.get(key) || [];
      const kept: string[] = [];
      let removed = 0;
      for (const entry of list) {
        try {
          const parsed = JSON.parse(entry);
          if (parsed && parsed.jobId === target) {
            removed++;
          } else {
            kept.push(entry);
          }
        } catch {
          kept.push(entry);
        }
      }
      if (removed > 0) {
        this.lists.set(key, kept);
      }
      return removed;
    } else if (script.includes('GET') && script.includes('DEL')) {
      // Compare-and-delete lock release script:
      // "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end"
      const currentValue = this.store.get(key);
      if (currentValue === args[0]) {
        this.store.delete(key);
        const timeout = this.ttls.get(key);
        if (timeout) {
          clearTimeout(timeout);
          this.ttls.delete(key);
        }
        return 1;
      }
      return 0;
    }
    // Graceful degradation: log and return a safe default instead of crashing.
    console.warn('[InMemoryRedisClient] Unsupported Lua script, returning 0:', script.slice(0, 80));
    return 0;
  }

  close(): void {
    for (const timer of this.ttls.values()) clearTimeout(timer);
    this.ttls.clear();
    this.store.clear();
    this.lists.clear();
  }
}

class RedisClient {
  private client: RedisClientType;
  private initialized: boolean = false;
  private readonly DEFAULT_TTL = 3600; // 1 hour
  private useFallback: boolean = false;
  private fallbackClient = new InMemoryRedisClient();

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.client = createClient({
      url: redisUrl,
      disableOfflineQueue: true, // Throw error if Redis is down
      socket: {
        reconnectStrategy: (retries: number) => {
          if (retries > 3) {
            console.error('[RedisClient] Max reconnection attempts reached. Switching to in-memory fallback.');
            this.useFallback = true;
            return false; // Stop reconnecting
          }
          // Exponential backoff capped at 1s
          const delay = Math.min(Math.pow(2, retries) * 50 + Math.random() * 100, 1000);
          console.warn(`[RedisClient] Connection lost. Reconnecting in ${Math.round(delay)}ms... (attempt ${retries})`);
          return delay;
        },
      },
    });

    this.client.on('error', (err) => {
      // Only log errors if we're not using fallback
      if (!this.useFallback) {
        console.error('Redis Client Error:', err);
      }
    });

    this.client.on('connect', () => {
      console.log('Redis client connected');
    });

    this.client.on('ready', () => {
      console.log('Redis client ready');
    });
  }

  /**
   * Initialize Redis connection
   */
  async initialize(): Promise<void> {
    if (!this.initialized) {
      try {
        await this.client.connect();
        this.initialized = true;
        console.log('Redis initialized successfully');
      } catch (error) {
        console.error('Failed to initialize Redis. Switching to in-memory fallback.');
        this.useFallback = true;
        this.initialized = true;
      }
    }
  }

  /**
   * Check if Redis is connected
   */
  async isConnected(): Promise<boolean> {
    if (this.useFallback) {
      return false;
    }
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if the Redis layer is operational (either real Redis or in-memory fallback).
   * Use this when you need to know if the service can function, not whether Redis itself is up.
   */
  async isOperational(): Promise<boolean> {
    if (this.useFallback) {
      return true;
    }
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Whether the client is currently using the in-memory fallback.
   */
  get isFallback(): boolean {
    return this.useFallback;
  }

  /**
   * Get Redis client instance
   */
  getClient(): any {
    return this.useFallback ? this.fallbackClient : this.client;
  }

  async close(timeoutMs = 5_000): Promise<void> {
    this.fallbackClient.close();
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
      this.initialized = false;
    }
  }

  // ========================================================================
  // Session State Methods
  // ========================================================================

  /**
   * Initialize a new agent session
   */
  async initializeSession(
    sessionId: string,
    initialData: Partial<RedisState>,
    ttlSeconds: number = this.DEFAULT_TTL
  ): Promise<void> {
    const state: RedisState = {
      sessionId,
      userPrompt: initialData.userPrompt || '',
      docType: initialData.docType,
      documentOutline: initialData.documentOutline,
      researchResults: initialData.researchResults,
      draftContent: initialData.draftContent,
      finalContent: initialData.finalContent,
      status: initialData.status || 'parsing',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.setEx(`agent:session:${sessionId}`, ttlSeconds, state);
  }

  /**
   * Get agent session state
   */
  async getSession(sessionId: string): Promise<RedisState | null> {
    const data = await this.getClient().get(`agent:session:${sessionId}`);
    if (!data) return null;

    try {
      const parsed = JSON.parse(data);
      // Convert ISO strings back to Date objects
      return {
        ...parsed,
        createdAt: new Date(parsed.createdAt),
        updatedAt: new Date(parsed.updatedAt),
      };
    } catch (error) {
      console.error(`Failed to parse Redis session data for ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Update agent session state (preserves TTL)
   */
  async updateSession(
    sessionId: string,
    updates: Partial<RedisState>,
    ttlSeconds: number = this.DEFAULT_TTL
  ): Promise<void> {
    const existing = await this.getSession(sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const updated: RedisState = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };

    await this.setEx(`agent:session:${sessionId}`, ttlSeconds, updated);
  }

  /**
   * Delete agent session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.getClient().del(`agent:session:${sessionId}`);
  }

  /**
   * Set key with expiration
   */
  private async setEx<T>(key: string, ttlSeconds: number, value: T): Promise<void> {
    await this.getClient().setEx(key, ttlSeconds, JSON.stringify(value));
  }

  /**
   * Set a simple string key (for feedback loop rate limiting)
   */
  async set(key: string, value: string, options?: { EX?: number }): Promise<void> {
    if (options?.EX) {
      await this.getClient().setEx(key, options.EX, value);
    } else {
      await this.getClient().set(key, value);
    }
  }

  /**
   * Get a simple string value (for feedback loop rate limiting)
   */
  async get(key: string): Promise<string | null> {
    return this.getClient().get(key);
  }

  /**
   * Delete a key (for feedback loop export locks)
   */
  async del(key: string): Promise<number> {
    return this.getClient().del(key);
  }

  /**
   * Left push to a list (for RAG promotion queue)
   */
  async lPush(key: string, value: string): Promise<number> {
    return this.getClient().lPush(key, value);
  }

  /**
   * Right pop from a list (for RAG promotion queue)
   */
  async rPop(key: string): Promise<string | null> {
    return this.getClient().rPop(key);
  }

  async rPopLPush(source: string, destination: string): Promise<string | null> {
    return this.getClient().rPopLPush(source, destination);
  }

  async lRem(key: string, count: number, value: string): Promise<number> {
    return this.getClient().lRem(key, count, value);
  }

  /**
   * Check if a key exists and set atomic lock (for export serialization)
   */
  async setNx(key: string, value: string, options?: { EX?: number }): Promise<boolean> {
    const result = await this.getClient().set(key, value, {
      NX: true,
      EX: options?.EX,
    });
    return result === 'OK';
  }

  // ========================================================================
  // Agent State Convenience Methods
  // ========================================================================

  /**
   * Set planning stage state
   */
  async setPlanningState(
    sessionId: string,
    outline: string
  ): Promise<void> {
    await this.updateSession(sessionId, {
      status: 'outlining' as any,
      documentOutline: outline,
    });
  }

  /**
   * Set researching stage state
   */
  async setResearchingState(
    sessionId: string,
    results: any[]
  ): Promise<void> {
    await this.updateSession(sessionId, {
      status: 'retrieving' as any,
      researchResults: results,
    });
  }

  /**
   * Set writing stage state
   */
  async setWritingState(
    sessionId: string,
    draftContent: string
  ): Promise<void> {
    await this.updateSession(sessionId, {
      status: 'writing',
      draftContent,
    });
  }

  /**
   * Mark session complete
   */
  async markComplete(
    sessionId: string,
    finalContent: string
  ): Promise<void> {
    await this.updateSession(sessionId, {
      status: 'complete',
      finalContent,
    });
  }

  /**
   * Mark session with error. Stores the error in a dedicated field so it
   * does not clobber any previously written draftContent.
   */
  async markError(
    sessionId: string,
    errorMessage: string
  ): Promise<void> {
    await this.updateSession(sessionId, {
      status: 'error',
      errorMessage,
    });
  }

  /**
   * Increment a key (for rate limiting)
   */
  async increment(key: string): Promise<number> {
    return this.getClient().incr(key);
  }

  /**
   * Set expiration on a key (for rate limiting)
   */
  async expire(key: string, ttlSeconds: number): Promise<boolean | number> {
    return this.getClient().expire(key, ttlSeconds) as Promise<boolean | number>;
  }
}

// Export singleton instance
export const redisClient = new RedisClient();
