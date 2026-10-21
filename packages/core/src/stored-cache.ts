import { type CachedResult, type CheckCache, lruCache } from './cache.js';

/** Where a stored cache lives (a file in VS Code's global storage, browser storage, …). */
export interface CacheStorage {
  read(): Promise<string | undefined>;
  write(data: string): Promise<void>;
}

export interface StoredCacheOptions {
  /** Entries older than this are dropped. Default 30 days. */
  ttlMs?: number;
  /** Most entries kept on disk. Default 20 000. */
  capacity?: number;
  /** Writes are batched this long after a change. Default 2 s. */
  saveDelayMs?: number;
  now?: () => number;
}

export interface StoredCache extends CheckCache {
  /** Writes pending changes now (call on shutdown). */
  flush(): Promise<void>;
  clear(): Promise<void>;
  size(): number;
}

const FORMAT = 1;

/**
 * A cache that survives restarts. Only "no change" results are written to storage:
 * they're a sentence hash and a timestamp, with no text. Fixes (which contain the
 * corrected sentence) stay in memory. Most sentences are correct, so this keeps most
 * of the saving without putting document text on disk.
 */
export async function storedCache(storage: CacheStorage, options: StoredCacheOptions = {}): Promise<StoredCache> {
  const ttlMs = options.ttlMs ?? 30 * 86_400_000;
  const capacity = options.capacity ?? 20_000;
  const saveDelayMs = options.saveDelayMs ?? 2_000;
  const now = options.now ?? Date.now;
  const memory = lruCache();
  const clean = new Map<string, number>(); // key → when it was answered "no change"
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const data = JSON.parse((await storage.read()) ?? 'null') as { v?: number; entries?: [string, number][] } | null;
    if (data?.v === FORMAT && Array.isArray(data.entries)) {
      const cutoff = now() - ttlMs;
      for (const [key, t] of data.entries) if (typeof key === 'string' && typeof t === 'number' && t > cutoff) clean.set(key, t);
    }
  } catch {
    // unreadable or missing: start empty
  }

  async function flush() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const entries = [...clean.entries()].sort((a, b) => b[1] - a[1]).slice(0, capacity);
    await storage.write(JSON.stringify({ v: FORMAT, entries }));
  }

  const scheduleSave = () => {
    timer ??= setTimeout(() => void flush().catch(() => {}), saveDelayMs);
  };

  return {
    get(key): CachedResult | undefined {
      const hit = memory.get(key);
      if (hit !== undefined) return hit as CachedResult;
      const t = clean.get(key);
      if (t === undefined) return undefined;
      if (t <= now() - ttlMs) {
        clean.delete(key);
        return undefined;
      }
      return { fixed: null };
    },
    set(key, value) {
      memory.set(key, value);
      if (value.fixed === null) {
        clean.set(key, now());
        scheduleSave();
      } else if (clean.delete(key)) {
        scheduleSave();
      }
    },
    flush,
    async clear() {
      memory.clear();
      clean.clear();
      await flush();
    },
    size: () => clean.size,
  };
}
