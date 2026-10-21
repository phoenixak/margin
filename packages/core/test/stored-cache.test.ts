import { describe, expect, it } from 'vitest';
import { storedCache } from '../src/index.js';

function memoryStorage(initial?: string) {
  const s = { data: initial, writes: 0 };
  return {
    s,
    storage: {
      read: async () => s.data,
      write: async (d: string) => {
        s.data = d;
        s.writes++;
      },
    },
  };
}

describe('storedCache', () => {
  it('persists "no change" results across restarts, but never fixes (no text on disk)', async () => {
    const { s, storage } = memoryStorage();
    const a = await storedCache(storage, { saveDelayMs: 10_000 });
    a.set('clean', { fixed: null });
    a.set('fixed', { fixed: 'They were late.', kind: 'grammar', why: 'Agreement.' });
    expect(a.get('fixed')).toMatchObject({ fixed: 'They were late.' }); // in memory this session
    await a.flush();
    expect(s.data).not.toContain('They were late');

    const b = await storedCache(storage);
    expect(b.get('clean')).toEqual({ fixed: null });
    expect(b.get('fixed')).toBeUndefined();
  });

  it('expires entries after the TTL', async () => {
    let t = 1_000;
    const { storage } = memoryStorage();
    const a = await storedCache(storage, { ttlMs: 100, now: () => t });
    a.set('k', { fixed: null });
    await a.flush();
    t = 1_200;
    const b = await storedCache(storage, { ttlMs: 100, now: () => t });
    expect(b.get('k')).toBeUndefined();
  });

  it('keeps only the newest entries up to capacity', async () => {
    let t = 0;
    const { storage } = memoryStorage();
    const a = await storedCache(storage, { capacity: 2, now: () => ++t });
    for (const k of ['a', 'b', 'c']) a.set(k, { fixed: null });
    await a.flush();
    const b = await storedCache(storage, { capacity: 2, now: () => t });
    expect(['a', 'b', 'c'].map((k) => b.get(k) !== undefined)).toEqual([false, true, true]);
  });

  it('starts empty on corrupt or foreign data, and clear() wipes storage', async () => {
    const { s, storage } = memoryStorage('{not json');
    const a = await storedCache(storage);
    expect(a.size()).toBe(0);
    a.set('k', { fixed: null });
    await a.clear();
    expect(JSON.parse(s.data!)).toEqual({ v: 1, entries: [] });
  });

  it('a later fix replaces a stored "no change" (e.g. after a prompt or model change)', async () => {
    const { storage } = memoryStorage();
    const a = await storedCache(storage);
    a.set('k', { fixed: null });
    a.set('k', { fixed: 'Fixed.' });
    await a.flush();
    expect((await storedCache(storage)).get('k')).toBeUndefined();
  });
});
