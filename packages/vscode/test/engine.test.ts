import { APICallError } from '@ai-sdk/provider';
import { type CheckInput, type CheckResult, lruCache, type MarginModel, type Suggestion } from '@margin/core';
import { describe, expect, it, vi } from 'vitest';
import { explainError as explain } from '@margin/core';
import { Engine, type EngineHost, type EngineSettings, type Status } from '../src/engine.js';
import { shiftSuggestions } from '../src/shift.js';

const model: MarginModel = { id: 'mock:m', model: {} as MarginModel['model'], foldSystem: false, structured: true, tested: true, parallel: 1, provider: 'local' as const, modelId: 'mock' };

function suggestion(start: number, end: number, sentence = { start: 0, end: 20 }): Suggestion {
  return {
    range: { start, end },
    replacement: 'x',
    sentence: { ...sentence, original: 'o', fixed: 'f' },
    kind: 'grammar',
    why: '',
    model: 'mock:m',
  };
}

function setup(overrides: Partial<EngineHost> = {}, settings: Partial<EngineSettings> = {}) {
  const docs = new Map([['a', { text: 'They was late.', version: 1, language: 'markdown' as const }]]);
  const published: { key: string; version: number; n: number }[] = [];
  const statuses: Status[] = [];
  const logs: string[] = [];
  const host: EngineHost = {
    snapshot: (k) => docs.get(k),
    harperRanges: () => [],
    model: () => ({ ok: true, model }),
    dialect: () => 'American',
    excluded: () => false,
    publish: (key, version, s) => published.push({ key, version, n: s.length }),
    status: (s) => statuses.push(s),
    log: (l) => logs.push(l),
    ...overrides,
  };
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const calls: CheckInput[] = [];
  let impl: (input: CheckInput) => Promise<CheckResult> = async () => ({ suggestions: [suggestion(5, 8)], rejected: [], sentences: 1, modelCalls: 1, cacheHits: 0 });
  const engine = new Engine({
    host,
    settings: () => ({ trigger: 'idle', idleDelayMs: 2000, ...settings }),
    cache: lruCache(),
    ignored: () => new Set(),
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      if (t) (t as { cleared: boolean }).cleared = true;
    },
    run: (input) => {
      calls.push(input);
      return impl(input);
    },
  });
  const fire = async () => {
    const live = timers.filter((t) => !t.cleared);
    for (const t of live) t.cleared = true;
    for (const t of live) t.fn();
    await vi.waitFor(() => {}); // let the async check settle
    await new Promise((r) => setTimeout(r, 0));
  };
  return { engine, docs, published, statuses, logs, timers, calls, fire, setImpl: (f: typeof impl) => (impl = f) };
}

describe('Engine', () => {
  it('debounces edits into one check after the idle delay', async () => {
    const t = setup();
    t.engine.onEdit('a');
    t.engine.onEdit('a');
    t.engine.onEdit('a');
    expect(t.timers.filter((x) => !x.cleared)).toHaveLength(1);
    expect(t.timers.at(-1)!.ms).toBe(2000);
    await t.fire();
    expect(t.calls).toHaveLength(1);
    expect(t.published).toEqual([{ key: 'a', version: 1, n: 1 }]);
    expect(t.statuses.at(-1)).toEqual({ state: 'ready', model: 'mock:m', tested: true });
  });

  it('an edit aborts the running check, and its stale result is never published', async () => {
    const t = setup();
    let release!: () => void;
    t.setImpl(
      (input) =>
        new Promise((resolve, reject) => {
          input.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          release = () => resolve({ suggestions: [], rejected: [], sentences: 1, modelCalls: 1, cacheHits: 0 });
        }),
    );
    const running = t.engine.checkNow('a');
    await new Promise((r) => setTimeout(r, 0));
    t.engine.onEdit('a');
    expect(t.calls[0]!.signal!.aborted).toBe(true);
    await running;
    expect(t.published).toEqual([]);
    void release;
  });

  it('drops a result when the document changed while it was being checked', async () => {
    const t = setup();
    t.setImpl(async () => {
      t.docs.get('a')!.version = 2; // the user typed; no abort reached us
      return { suggestions: [suggestion(5, 8)], rejected: [], sentences: 1, modelCalls: 1, cacheHits: 0 };
    });
    await t.engine.checkNow('a');
    expect(t.published).toEqual([]);
  });

  it('waits and retries when the provider is busy (429 / 503 / high demand)', async () => {
    const t = setup();
    t.setImpl(async () => {
      throw new APICallError({ message: 'This model is currently experiencing high demand.', url: 'x', requestBodyValues: {}, statusCode: 503 });
    });
    await t.engine.checkNow('a');
    expect(t.statuses.at(-1)).toEqual({ state: 'busy', model: 'mock:m', retryInMs: 30_000 });
    expect(t.timers.at(-1)).toMatchObject({ ms: 30_000, cleared: false });
  });

  it('reports other errors without retrying', async () => {
    const t = setup();
    t.setImpl(async () => {
      throw new Error('bad request');
    });
    await t.engine.checkNow('a');
    expect(t.statuses.at(-1)).toEqual({ state: 'error', message: 'Error: bad request' });
    expect(t.timers.filter((x) => !x.cleared)).toHaveLength(0);
  });

  it('sends nothing when not set up, missing a key, or excluded', async () => {
    for (const reason of ['needs-setup', 'no-key', 'off'] as const) {
      const t = setup({ model: () => ({ ok: false, reason }) });
      await t.engine.checkNow('a');
      expect(t.calls).toHaveLength(0);
      expect(t.statuses.at(-1)).toEqual({ state: reason });
    }
    const t = setup({ excluded: () => true });
    await t.engine.checkNow('a');
    expect(t.calls).toHaveLength(0);
  });

  it('follows the trigger setting', async () => {
    const save = setup({}, { trigger: 'save' });
    save.engine.onEdit('a');
    expect(save.timers).toHaveLength(0);
    save.engine.onSave('a');
    await new Promise((r) => setTimeout(r, 0));
    expect(save.calls).toHaveLength(1);

    const manual = setup({}, { trigger: 'manual' });
    manual.engine.onEdit('a');
    manual.engine.onOpen('a');
    manual.engine.onSave('a');
    expect(manual.timers).toHaveLength(0);
    expect(manual.calls).toHaveLength(0);
  });

  it('runs at most two checks at once across documents', async () => {
    const t = setup();
    for (const k of ['b', 'c', 'd']) t.docs.set(k, { text: 'x', version: 1, language: 'markdown' });
    let active = 0;
    let peak = 0;
    t.setImpl(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { suggestions: [], rejected: [], sentences: 1, modelCalls: 1, cacheHits: 0 };
    });
    await Promise.all(['a', 'b', 'c', 'd'].map((k) => t.engine.checkNow(k)));
    expect(t.calls).toHaveLength(4);
    expect(peak).toBe(2);
  });

  it('never logs document text', async () => {
    const t = setup();
    await t.engine.checkNow('a');
    expect(t.logs.join('\n')).not.toContain('They was late');
  });
});

describe('explain', () => {
  const local: MarginModel = { ...model, id: 'local:gemma4:26b-a4b-it-qat', provider: 'local', modelId: 'gemma4:26b-a4b-it-qat' };
  it('says when the local server is down or lacks the model', () => {
    expect(explain(new APICallError({ message: 'Cannot connect to API: fetch failed', url: 'x', requestBodyValues: {} }), local)).toContain('Is Ollama or LM Studio running');
    expect(explain(new APICallError({ message: 'model not found', url: 'x', requestBodyValues: {}, statusCode: 404 }), local)).toContain('ollama pull gemma4:26b-a4b-it-qat');
  });
  it('says when a key is rejected', () => {
    expect(explain(new APICallError({ message: 'API key not valid', url: 'x', requestBodyValues: {}, statusCode: 400 }), model)).toContain('rejected the API key');
  });
});

describe('shiftSuggestions', () => {
  const s = suggestion(25, 28, { start: 20, end: 40 });
  it('moves suggestions after an edit before their sentence', () => {
    const [moved] = shiftSuggestions([s], [{ offset: 0, length: 0, inserted: 5 }]);
    expect(moved!.range).toEqual({ start: 30, end: 33 });
    expect(moved!.sentence).toMatchObject({ start: 25, end: 45 });
  });
  it('leaves suggestions alone for an edit after their sentence', () => {
    expect(shiftSuggestions([s], [{ offset: 50, length: 3, inserted: 0 }])[0]).toBe(s);
  });
  it('drops suggestions whose sentence was edited', () => {
    expect(shiftSuggestions([s], [{ offset: 30, length: 1, inserted: 2 }])).toEqual([]);
  });
});
