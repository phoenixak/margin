/** What the model said about one masked sentence: its corrected text, or null for "no change". */
export interface CachedResult {
  fixed: string | null;
  kind?: string;
  why?: string;
}

export interface CheckCache {
  get(key: string): Promise<CachedResult | undefined> | CachedResult | undefined;
  set(key: string, value: CachedResult): Promise<void> | void;
}

/** In-memory LRU cache. Adapters can persist it (Phase 3). */
export function lruCache(capacity = 5_000): CheckCache & { size(): number; clear(): void } {
  const map = new Map<string, CachedResult>();
  return {
    get(key) {
      const v = map.get(key);
      if (v !== undefined) {
        map.delete(key);
        map.set(key, v);
      }
      return v;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      while (map.size > capacity) map.delete(map.keys().next().value!);
    },
    size: () => map.size,
    clear: () => map.clear(),
  };
}

export async function sha256(text: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
