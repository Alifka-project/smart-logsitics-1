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

class ServerCache {
  constructor() {
    this.store = new Map();
    
    // Cleanup expired entries every 5 minutes
    this._cleanupInterval = setInterval(() => this._cleanup(), 5 * 60 * 1000);
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {{ data: any, isStale: boolean } | null}
   */
  get(key) {
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
   * @param {string} key - Cache key
   * @param {any} data - Data to cache
   * @param {number} freshMs - How long data stays fresh (milliseconds)
   * @param {number} maxMs - Maximum cache lifetime (milliseconds)
   */
  set(key, data, freshMs = 30000, maxMs = 120000) {
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
   * @param {string} key - Cache key
   */
  delete(key) {
    this.store.delete(key);
  }

  /**
   * Delete all entries matching a prefix
   * @param {string} prefix - Key prefix to match
   */
  invalidatePrefix(prefix) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.store.clear();
  }

  /**
   * Get cache stats for monitoring
   */
  stats() {
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
  _cleanup() {
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
   * @param {string} key - Cache key
   * @param {Function} fetchFn - Async function to fetch fresh data
   * @param {number} freshMs - How long data stays fresh
   * @param {number} maxMs - Maximum cache lifetime
   * @returns {Promise<any>} The data (cached or fresh)
   */
  async getOrFetch(key, fetchFn, freshMs = 30000, maxMs = 120000) {
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
      }).catch(err => {
        console.error(`[Cache] Background refresh failed for key=${key}:`, err.message);
      });
      return cached.data;
    }

    // No cache - fetch synchronously
    const data = await fetchFn();
    this.set(key, data, freshMs, maxMs);
    return data;
  }

  destroy() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
    }
    this.store.clear();
  }
}

// Singleton instance
const cache = new ServerCache();

module.exports = cache;
