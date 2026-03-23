/**
 * Simple in-memory cache layer for reducing database operations
 *
 * Purpose: Cache frequently-accessed, rarely-changing data to avoid
 * hitting the database on every polling request.
 *
 * Each cached entry has:
 * - data: the cached value
 * - expiresAt: timestamp when the cache expires
 * - staleAt: timestamp when the data is considered stale (but still usable)
 *
 * Strategy: stale-while-revalidate
 * - If fresh: return cached data immediately
 * - If stale but not expired: return cached data, trigger background refresh
 * - If expired: fetch fresh data
 */

interface CacheEntry {
  data: unknown;
  staleAt: number;
  expiresAt: number;
  createdAt: number;
}

interface CacheResult {
  data: unknown;
  isStale: boolean;
}

interface CacheStats {
  total: number;
  fresh: number;
  stale: number;
}

class ServerCache {
  private store: Map<string, CacheEntry>;
  private _cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.store = new Map();

    // Cleanup expired entries every 5 minutes
    this._cleanupInterval = setInterval(() => this._cleanup(), 5 * 60 * 1000);
  }

  /**
   * Get a value from cache
   * @param key - Cache key
   * @returns {{ data: unknown, isStale: boolean } | null}
   */
  get(key: string): CacheResult | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    const now = Date.now();

    // Expired - remove and return null
    if (now > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    // Stale but not expired - return with stale flag
    if (now > entry.staleAt) {
      return { data: entry.data, isStale: true };
    }

    // Fresh
    return { data: entry.data, isStale: false };
  }

  /**
   * Set a value in cache
   * @param key - Cache key
   * @param data - Data to cache
   * @param freshMs - How long data stays fresh (milliseconds)
   * @param maxMs - Maximum cache lifetime (milliseconds)
   */
  set(key: string, data: unknown, freshMs: number = 30000, maxMs: number = 120000): void {
    const now = Date.now();
    this.store.set(key, {
      data,
      staleAt: now + freshMs,
      expiresAt: now + maxMs,
      createdAt: now
    });
  }

  /**
   * Delete a cache entry (use after mutations to invalidate)
   * @param key - Cache key
   */
  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * Delete all entries matching a prefix
   * @param prefix - Key prefix to match
   */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get cache stats for monitoring
   */
  stats(): CacheStats {
    const now = Date.now();
    let fresh = 0, stale = 0, total = 0;
    for (const entry of this.store.values()) {
      total++;
      if (now < entry.staleAt) fresh++;
      else stale++;
    }
    return { total, fresh, stale };
  }

  /**
   * Remove expired entries
   */
  _cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Helper: get-or-fetch pattern
   * Returns cached data if available, otherwise calls fetchFn and caches result
   *
   * @param key - Cache key
   * @param fetchFn - Async function to fetch fresh data
   * @param freshMs - How long data stays fresh
   * @param maxMs - Maximum cache lifetime
   * @returns The data (cached or fresh)
   */
  async getOrFetch(key: string, fetchFn: () => Promise<unknown>, freshMs: number = 30000, maxMs: number = 120000): Promise<unknown> {
    const cached = this.get(key);

    // Fresh cache hit - return immediately
    if (cached && !cached.isStale) {
      return cached.data;
    }

    // Stale cache - return stale data but refresh in background
    if (cached && cached.isStale) {
      // Fire-and-forget background refresh
      fetchFn().then(data => {
        this.set(key, data, freshMs, maxMs);
      }).catch((err: unknown) => {
        const e = err as Error;
        console.error(`[Cache] Background refresh failed for key=${key}:`, e.message);
      });
      return cached.data;
    }

    // No cache - fetch synchronously
    const data = await fetchFn();
    this.set(key, data, freshMs, maxMs);
    return data;
  }

  destroy(): void {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
    }
    this.store.clear();
  }
}

// Singleton instance
const cache = new ServerCache();

// Named exports keep CommonJS require('../cache') compatibility in server routes.
export const get = cache.get.bind(cache);
export const set = cache.set.bind(cache);
export const del = cache.delete.bind(cache);
export const deleteEntry = cache.delete.bind(cache);
export const invalidatePrefix = cache.invalidatePrefix.bind(cache);
export const clear = cache.clear.bind(cache);
export const stats = cache.stats.bind(cache);
export const getOrFetch = cache.getOrFetch.bind(cache);

export default cache;
