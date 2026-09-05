import { config } from '../../config/env.ts';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class SearchCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private defaultTtlMs: number = 60 * 1000; // 60 seconds TTL
  private stats = {
    hits: 0,
    misses: 0
  };

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry.data as T;
  }

  async set<T>(key: string, data: T, ttlMs?: number): Promise<void> {
    const ttl = ttlMs || this.defaultTtlMs;
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl
    });
  }

  async invalidatePrefix(prefix: string): Promise<number> {
    let deletedCount = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        deletedCount++;
      }
    }
    return deletedCount;
  }

  async flush(): Promise<void> {
    this.cache.clear();
  }

  getMetrics() {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRatio = totalRequests > 0 ? (this.stats.hits / totalRequests) : 0;
    return {
      keysCount: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRatio: Math.round(hitRatio * 100) / 100
    };
  }
}

export const searchCache = new SearchCache();
