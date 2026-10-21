import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { check, ignoreKey, lruCache, type MarginModel, rewrite } from '../src/index.js';

function promptText(options: LanguageModelV4CallOptions): string {
  return options.prompt
    .flatMap((m) => (typeof m.content === 'string' ? [m.content] : m.content.flatMap((p) => (p.type === 'text' ? [p.text] : []))))
    .join('\n');
}

const reply = (text: string): LanguageModelV4GenerateResult => ({
  content: [{ type: 'text', text }],
  finishReason: { unified: 'stop', raw: 'stop' },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 10, text: 10, reasoning: undefined },
  },
  warnings: [],
});

/** A fake model that corrects sentences it knows, in format A (JSON) or B (tags). */
function fixer(corrections: Record<string, string>, opts: { format?: 'json' | 'tags'; foldSystem?: boolean } = {}) {
  const calls: string[] = [];
  const mock = new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'fixer',
    doGenerate: async (options) => {
      const text = promptText(options);
      calls.push(text);
      // Only the user part contains real input sentences (the system prompt has examples).
      const input = text.slice(text.lastIndexOf('Example output:') + 1);
      const fixes = [...input.matchAll(/<s id="(\d+)">(.*?)<\/s>/g)]
        .filter((m) => corrections[m[2]!] !== undefined)
        .map((m) => ({ id: Number(m[1]), text: corrections[m[2]!]!, kind: 'grammar', why: 'Test fix.' }));
      if (opts.format === 'tags') return reply(fixes.map((f) => `<fix id="${f.id}" kind="grammar">${f.text}</fix><why>Test fix.</why>`).join('\n') || '<none/>');
      return reply(JSON.stringify({ fixes }));
    },
  });
  const model: MarginModel = { id: 'mock:fixer', model: mock, foldSystem: opts.foldSystem ?? false, structured: opts.format !== 'tags', tested: true, parallel: 1, provider: 'local', modelId: 'mock' };
  return { model, calls, mock };
}

describe('check', () => {
  it('turns a corrected sentence into exact, minimal suggestions', async () => {
    const text = '# Notes\n\nThey was late. The sky is blue today.\n';
    const { model } = fixer({ 'They was late.': 'They were late.' });
    const r = await check({ text, model });
    expect(r.sentences).toBe(3);
    expect(r.suggestions).toHaveLength(1);
    const s = r.suggestions[0]!;
    expect(text.slice(s.range.start, s.range.end)).toBe('was');
    expect(s.replacement).toBe('were');
    expect(s.sentence).toMatchObject({ original: 'They was late.', fixed: 'They were late.' });
  });

  it('offsets survive emoji, CJK and wrapped lines', async () => {
    const text = '😀😀 日本語のメモ。\n\nWe goes to the\nstation every day.';
    const { model } = fixer({ 'We goes to the station every day.': 'We go to the station every day.' });
    const [s] = (await check({ text, model })).suggestions;
    expect(text.slice(s!.range.start, s!.range.end)).toBe('goes');
    expect(s!.sentence.fixed).toBe('We go to the\nstation every day.'); // the line break is kept
  });

  it('masks protected spans and restores them', async () => {
    const text = 'Please run `npm test` when your ready.';
    const { model, calls } = fixer({ 'Please run ⟦0⟧ when your ready.': "Please run ⟦0⟧ when you're ready." });
    const [s] = (await check({ text, model })).suggestions;
    expect(calls[0]).not.toContain('npm test');
    expect(text.slice(s!.range.start, s!.range.end)).toBe('your');
    expect(s!.replacement).toBe("you're");
  });

  it('rejects a fix that drops a placeholder', async () => {
    const { model } = fixer({ 'Please run ⟦0⟧ when your ready.': "Please run it when you're ready." });
    const r = await check({ text: 'Please run `npm test` when your ready.', model });
    expect(r.suggestions).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['placeholders']);
  });

  it('rejects over-edits and negation flips', async () => {
    const { model } = fixer({
      'Honestly, the meeting could have been an email.': 'Frankly, that gathering might simply have been a message.',
      'She said she would call back, but she never did.': 'She said she would call back, and she did.',
    });
    const r = await check({ text: 'Honestly, the meeting could have been an email. She said she would call back, but she never did.', model });
    expect(r.suggestions).toEqual([]);
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(['edit-ratio', 'negation']);
  });

  it('drops edits that touch a Harper lint (Harper owns them)', async () => {
    const text = 'This is a example of they was wrong.';
    const { model } = fixer({ 'This is a example of they was wrong.': 'This is an example of they were wrong.' });
    const a = text.indexOf(' a ') + 1;
    const r = await check({ text, model, existing: [{ start: a, end: a + 1 }] });
    expect(r.suggestions.map((s) => s.replacement)).toEqual(['were']);
    const all = await check({ text: 'They was here.', model: fixer({ 'They was here.': 'They were here.' }).model, existing: [{ start: 5, end: 8 }] });
    expect(all.rejected.map((x) => x.reason)).toEqual(['harper-overlap']);
  });

  it('caches answers, including "no change", across calls', async () => {
    const cache = lruCache();
    const { model, calls } = fixer({ 'They was late.': 'They were late.' });
    const text = 'They was late. The sky is blue today.';
    await check({ text, model, cache });
    const second = await check({ text, model, cache });
    expect(calls).toHaveLength(1);
    expect(second.cacheHits).toBe(2);
    expect(second.suggestions).toHaveLength(1);
  });

  it('honours the ignore list', async () => {
    const { model } = fixer({ 'They was late.': 'They were late.' });
    const first = await check({ text: 'They was late.', model });
    const { original, fixed } = first.suggestions[0]!.sentence;
    const ignored = new Set([await ignoreKey(original, fixed)]);
    const r = await check({ text: 'They  was\nlate.', model, ignored });
    expect(r.rejected.map((x) => x.reason)).toEqual(['ignored']);
  });

  it('only checks sentences in `ranges`', async () => {
    const { calls, model } = fixer({});
    const text = 'First one is here. Second one is here.';
    const r = await check({ text, model, ranges: [{ start: 20, end: 21 }] });
    expect(r.sentences).toBe(1);
    expect(calls[0]).toContain('Second one is here.');
    expect(calls[0]).not.toContain('<s id="1">First');
  });

  it('batches sentences', async () => {
    const { calls, model } = fixer({});
    const text = Array.from({ length: 10 }, (_, i) => `Sentence number ${i} is fine.`).join(' ');
    const r = await check({ text, model, batch: { maxSentences: 4 } });
    expect(r.modelCalls).toBe(3);
    expect(calls).toHaveLength(3);
  });

  it('retries a sentence the model flagged but echoed back unchanged', async () => {
    let n = 0;
    const mock = new MockLanguageModelV4({
      provider: 'mock',
      modelId: 'echo',
      doGenerate: async (options) => {
        n++;
        const retried = promptText(options).includes('returned it unchanged');
        const text = retried ? 'Hey, how were you?' : 'Hey, how was you?';
        return reply(JSON.stringify({ fixes: [{ id: 1, text, kind: 'grammar', why: 'Agreement.' }] }));
      },
    });
    const r = await check({ text: 'Hey, how was you?', model: { id: 'mock:echo', model: mock, foldSystem: false, structured: true, tested: true, parallel: 1, provider: 'local', modelId: 'mock' } });
    expect(n).toBe(2);
    expect(r.modelCalls).toBe(2);
    expect(r.suggestions.map((s) => s.replacement)).toEqual(['were']);
  });

  it('runs batches concurrently up to `concurrency`', async () => {
    let active = 0;
    let peak = 0;
    const mock = new MockLanguageModelV4({
      provider: 'mock',
      modelId: 'c',
      doGenerate: async () => {
        peak = Math.max(peak, ++active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return reply('{"fixes":[]}');
      },
    });
    const text = Array.from({ length: 9 }, (_, i) => `Sentence number ${i} is fine.`).join(' ');
    const r = await check({ text, model: { id: 'mock:c', model: mock, foldSystem: false, structured: true, tested: true, parallel: 1, provider: 'local' as const, modelId: 'mock' }, batch: { maxSentences: 2 }, concurrency: 2 });
    expect(r.modelCalls).toBe(5);
    expect(peak).toBe(2);
  });

  it('falls back to the tag protocol when JSON is unreadable', async () => {
    let n = 0;
    const mock = new MockLanguageModelV4({
      provider: 'mock',
      modelId: 'x',
      doGenerate: async () => reply(n++ === 0 ? 'Sure! Here are the fixes.' : '<fix id="1" kind="grammar">They were late.</fix><why>Agreement.</why>'),
    });
    const r = await check({ text: 'They was late.', model: { id: 'mock:x', model: mock, foldSystem: false, structured: true, tested: true, parallel: 1, provider: 'local' as const, modelId: 'mock' } });
    expect(r.suggestions.map((s) => s.replacement)).toEqual(['were']);
  });

  it('folds the system prompt into the user prompt when the model needs it', async () => {
    const { mock, model } = fixer({}, { foldSystem: true });
    await check({ text: 'They are here today.', model });
    expect(mock.doGenerateCalls[0]!.prompt.some((m) => m.role === 'system')).toBe(false);
  });

  it('aborts cleanly', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const { model, calls } = fixer({});
    await expect(check({ text: 'They are here today.', model, signal: ctl.signal })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('works with format B models', async () => {
    const { model } = fixer({ 'Their going home.': "They're going home." }, { format: 'tags' });
    const r = await check({ text: 'Their going home.', model });
    expect(r.suggestions.map((s) => s.replacement)).toEqual(["They're"]);
  });
});

describe('rewrite', () => {
  it('drops placeholders the model invents when the text had none, without a warning', async () => {
    const mock = new MockLanguageModelV4({
      provider: 'mock',
      modelId: 'w',
      doStream: async (options) => {
        const prompt = promptText(options);
        if (prompt.includes('⟦')) throw new Error('placeholders mentioned with none in the text');
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start' as const, id: 't' },
              { type: 'text-delta' as const, id: 't', delta: 'The team repeated the test ⟦0⟧.' },
              { type: 'text-end' as const, id: 't' },
              { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: 'stop' }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } } },
            ],
          }),
        };
      },
    });
    const r = rewrite({ text: 'The team decided to repeat the test.', preset: 'formal', model: { id: 'mock:w', model: mock, foldSystem: false, structured: true, tested: true, parallel: 1, provider: 'local', modelId: 'mock' } });
    let streamed = '';
    for await (const part of r.textStream) streamed += part;
    expect(streamed).toBe('The team repeated the test.');
    expect(await r.done).toEqual({ text: 'The team repeated the test.', warnings: [] });
  });


  it('streams with placeholders restored and warns about negation changes', async () => {
    const mock = new MockLanguageModelV4({
      provider: 'mock',
      modelId: 'w',
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: 't' },
            { type: 'text-delta' as const, id: 't', delta: 'Run ⟦' },
            { type: 'text-delta' as const, id: 't', delta: '0⟧ and it works.' },
            { type: 'text-end' as const, id: 't' },
            {
              type: 'finish' as const,
              finishReason: { unified: 'stop' as const, raw: 'stop' },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
            },
          ],
        }),
      }),
    });
    const r = rewrite({ text: "Run `make` and it doesn't fail.", preset: 'concise', model: { id: 'mock:w', model: mock, foldSystem: false, structured: true, tested: true, parallel: 1, provider: 'local' as const, modelId: 'mock' } });
    let streamed = '';
    for await (const part of r.textStream) streamed += part;
    expect(streamed).toBe('Run `make` and it works.');
    expect(await r.done).toEqual({ text: 'Run `make` and it works.', warnings: ['negation'] });
  });
});
