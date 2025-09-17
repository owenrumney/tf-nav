/**
 * In-memory cache for parsed Terraform files based on mtime and size
 */

import * as fs from 'fs';
import * as path from 'path';

import { Address, ParseResult } from '../types';

/**
 * Cache key based on file path, modification time, and size
 */
export interface CacheKey {
  path: string;
  mtimeMs: number;
  size: number;
}

/**
 * Cached parse result with metadata
 */
export interface CacheEntry {
  key: CacheKey;
  result: ParseResult;
  cachedAt: Date;
  hitCount: number;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  totalEntries: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  memoryUsageBytes: number;
  oldestEntry?: Date;
  newestEntry?: Date;
}

/**
 * Cache configuration options
 */
export interface CacheOptions {
  /** Maximum number of entries to keep in cache */
  maxEntries?: number;

  /** Maximum age of cache entries in milliseconds */
  maxAgeMs?: number;

  /** Whether to log cache activity */
  verbose?: boolean;
}

/**
 * In-memory cache for Terraform file parse results
 * Uses file path + mtime + size as cache key for reliable invalidation
 */
export class TerraformParseCache {
  private cache = new Map<string, CacheEntry>();
  private stats = {
    totalHits: 0,
    totalMisses: 0,
  };

  private readonly options: Required<CacheOptions>;

  constructor(options: CacheOptions = {}) {
    this.options = {
      maxEntries: 1000,
      maxAgeMs: 5 * 60 * 1000, // 5 minutes default
      verbose: false,
      ...options,
    };
  }

  /**
   * Get parse result from cache if valid
   */
  public async get(filePath: string): Promise<ParseResult | null> {
    try {
      const stats = await fs.promises.stat(filePath);
      const key = this.createKey(filePath, stats);
      const cacheKey = this.keyToString(key);

      const entry = this.cache.get(cacheKey);

      if (!entry) {
        this.stats.totalMisses++;
        this.log(`Cache miss: ${path.basename(filePath)}`);
        return null;
      }

      // Check if entry is expired
      if (this.isExpired(entry)) {
        this.cache.delete(cacheKey);
        this.stats.totalMisses++;
        this.log(`Cache expired: ${path.basename(filePath)}`);
        return null;
      }

      // Check if file has changed
      if (!this.isKeyValid(key, entry.key)) {
        this.cache.delete(cacheKey);
        this.stats.totalMisses++;
        this.log(`Cache invalid (file changed): ${path.basename(filePath)}`);
        return null;
      }

      // Cache hit!
      entry.hitCount++;
      this.stats.totalHits++;
      this.log(
        `Cache hit: ${path.basename(filePath)} (${entry.hitCount} hits)`
      );

      return entry.result;
    } catch (error) {
      // File doesn't exist or can't be accessed
      this.log(`Cache error for ${path.basename(filePath)}: ${error}`);
      return null;
    }
  }

  /**
   * Store parse result in cache
   */
  public async set(filePath: string, result: ParseResult): Promise<void> {
    try {
      const stats = await fs.promises.stat(filePath);
      const key = this.createKey(filePath, stats);
      const cacheKey = this.keyToString(key);

      const entry: CacheEntry = {
        key,
        result: this.deepCloneParseResult(result), // Clone to avoid mutations
        cachedAt: new Date(),
        hitCount: 0,
      };

      this.cache.set(cacheKey, entry);
      this.log(
        `Cached: ${path.basename(filePath)} (${result.blocks.length} blocks)`
      );

      // Enforce cache limits
      this.evictIfNeeded();
    } catch (error) {
      this.log(`Failed to cache ${path.basename(filePath)}: ${error}`);
    }
  }

  /**
   * Remove a specific file from cache
   */
  public evict(filePath: string): boolean {
    const keysToRemove: string[] = [];

    // Find all cache keys for this file path
    for (const [cacheKey, entry] of this.cache.entries()) {
      if (entry.key.path === filePath) {
        keysToRemove.push(cacheKey);
      }
    }

    // Remove found entries
    for (const key of keysToRemove) {
      this.cache.delete(key);
    }

    if (keysToRemove.length > 0) {
      this.log(
        `Evicted ${keysToRemove.length} entries for ${path.basename(filePath)}`
      );
      return true;
    }

    return false;
  }

  /**
   * Clear all cache entries
   */
  public clear(): void {
    const entryCount = this.cache.size;
    this.cache.clear();
    this.stats.totalHits = 0;
    this.stats.totalMisses = 0;
    this.log(`Cleared cache (${entryCount} entries)`);
  }

  /**
   * Get cache statistics
   */
  public getStats(): CacheStats {
    const entries = Array.from(this.cache.values());
    const totalRequests = this.stats.totalHits + this.stats.totalMisses;

    return {
      totalEntries: this.cache.size,
      totalHits: this.stats.totalHits,
      totalMisses: this.stats.totalMisses,
      hitRate: totalRequests > 0 ? this.stats.totalHits / totalRequests : 0,
      memoryUsageBytes: this.estimateMemoryUsage(),
      oldestEntry:
        entries.length > 0
          ? new Date(Math.min(...entries.map((e) => e.cachedAt.getTime())))
          : undefined,
      newestEntry:
        entries.length > 0
          ? new Date(Math.max(...entries.map((e) => e.cachedAt.getTime())))
          : undefined,
    };
  }

  /**
   * Create cache key from file path and stats
   */
  private createKey(filePath: string, stats: fs.Stats): CacheKey {
    return {
      path: path.resolve(filePath), // Normalize path
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    };
  }

  /**
   * Convert cache key to string for Map key
   */
  private keyToString(key: CacheKey): string {
    return `${key.path}:${key.mtimeMs}:${key.size}`;
  }

  /**
   * Check if two cache keys are the same (file hasn't changed)
   */
  private isKeyValid(current: CacheKey, cached: CacheKey): boolean {
    return (
      current.path === cached.path &&
      current.mtimeMs === cached.mtimeMs &&
      current.size === cached.size
    );
  }

  /**
   * Check if cache entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    const age = Date.now() - entry.cachedAt.getTime();
    return age > this.options.maxAgeMs;
  }

  /**
   * Evict old entries if cache is full
   */
  private evictIfNeeded(): void {
    // Remove expired entries first
    this.evictExpired();

    // If still over limit, remove least recently used entries
    if (this.cache.size > this.options.maxEntries) {
      const entries = Array.from(this.cache.entries());

      // Sort by last access time (oldest first)
      entries.sort(([, a], [, b]) => {
        // Use cachedAt as proxy for last access (could be improved with LRU tracking)
        return a.cachedAt.getTime() - b.cachedAt.getTime();
      });

      const toRemove = entries.length - this.options.maxEntries;
      for (let i = 0; i < toRemove; i++) {
        const [key] = entries[i];
        this.cache.delete(key);
      }

      this.log(`Evicted ${toRemove} entries due to size limit`);
    }
  }

  /**
   * Remove expired entries
   */
  private evictExpired(): void {
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.cache.delete(key);
    }

    if (expiredKeys.length > 0) {
      this.log(`Evicted ${expiredKeys.length} expired entries`);
    }
  }

  /**
   * Estimate memory usage of cache
   */
  private estimateMemoryUsage(): number {
    let totalBytes = 0;

    for (const entry of this.cache.values()) {
      // Rough estimation
      totalBytes += JSON.stringify(entry.result).length * 2; // UTF-16 chars
      totalBytes += entry.key.path.length * 2;
      totalBytes += 100; // Overhead for objects, dates, etc.
    }

    return totalBytes;
  }

  /**
   * Deep clone parse result to avoid mutations
   */
  private deepCloneParseResult(result: ParseResult): ParseResult {
    return {
      blocks: result.blocks.map((block) => ({ ...block })),
      errors: result.errors.map((error) => ({ ...error })),
    };
  }

  /**
   * Log message if verbose logging is enabled
   */
  private log(message: string): void {
    if (this.options.verbose) {
      console.log(`[TerraformCache] ${message}`);
    }
  }
}
