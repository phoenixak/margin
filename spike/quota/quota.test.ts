// Phase 0: answers PLAN §6.6 against the installed ai-sdk-quota tarball.
// Mock models only; no network. Findings are written up in docs/QUOTA-NOTES.md.
import { APICallError, type LanguageModelV4GenerateResult, type LanguageModelV4Usage } from '@ai-sdk/provider';
import { generateText, NoObjectGeneratedError, Output, streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import * as quota from 'ai-sdk-quota';
import { createQuotaPool, memoryStore, type PoolEvent } from 'ai-sdk-quota';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

function usage(input: number, output: number): LanguageModelV4Usage {
  return {
    inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: output, text: output, reasoning: undefined },
  };
}

function generated(text: string): LanguageModelV4GenerateResult {
  return { content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: 'stop' }, usage: usage(10, 5), warnings: [] };
}

function apiError(statusCode: number) {
  return new APICallError({
    message: `HTTP ${statusCode}`,
    url: 'http://mock',
    requestBodyValues: {},
    statusCode,
    isRetryable: statusCode >= 500,
  });
}

const ok = (id: string, text = 'ok') => new MockLanguageModelV4({ provider: 'mock', modelId: id, doGenerate: async () => generated(text) });

/** A model that behaves like an HTTP provider: rejects with an AbortError once the signal fires. */
function hanging(id: string) {
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId: id,
    doGenerate: ({ abortSignal }) =>
      new Promise((_, reject) => {
        const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (abortSignal?.aborted) fail();
        else abortSignal?.addEventListener('abort', fail, { once: true });
      }),
  });
}

describe('Q1: a member with no limits (local server)', () => {
  it('omitting `limits` means unlimited: 500 calls go through and headroom stays 1', async () => {
    const pool = createQuotaPool({ models: [{ id: 'local', model: ok('gemma') }] });
    for (let i = 0; i < 500; i++) await generateText({ model: pool.model(), prompt: 'x', maxRetries: 0 });
    const snap = await pool.snapshot();
    expect(snap.members[0]!.headroom).toBe(1);
    expect(snap.members[0]!.usage).toEqual({});
  });
});

describe('Q2: order and filters', () => {
  it('member order is priority order by default', async () => {
    const events: PoolEvent[] = [];
    const pool = createQuotaPool({
      models: [
        { id: 'a', model: ok('a') },
        { id: 'b', model: ok('b') },
      ],
      onEvent: (e) => events.push(e),
    });
    await generateText({ model: pool.model(), prompt: 'x', maxRetries: 0 });
    expect(events.find((e) => e.type === 'route')).toMatchObject({ memberId: 'a' });
  });

  it('`exclude` filters by tag; `require` filters by capability (no include-by-tag filter exists)', async () => {
    const events: PoolEvent[] = [];
    const pool = createQuotaPool({
      models: [
        { id: 'cloud', model: ok('c'), tags: ['cloud'] },
        { id: 'nojson', model: ok('n'), capabilities: { json: false } },
        { id: 'local', model: ok('l'), tags: ['local'] },
      ],
      onEvent: (e) => events.push(e),
    });
    await generateText({ model: pool.model({ exclude: ['cloud'], require: ['json'] }), prompt: 'x', maxRetries: 0 });
    expect(events.filter((e) => e.type === 'skip').map((e) => (e as { reason: string }).reason)).toEqual(['excluded', 'capability']);
    expect(events.find((e) => e.type === 'route')).toMatchObject({ memberId: 'local' });
  });
});

describe('Q3: aborts', () => {
  it('100 calls aborted before the provider answers: how much capacity do they use?', async () => {
    const pool = createQuotaPool({ models: [{ id: 'm', model: hanging('m'), limits: { rpd: 1000, tpd: 1_000_000 } }] });
    for (let i = 0; i < 100; i++) {
      const ctl = new AbortController();
      const p = generateText({ model: pool.model(), prompt: 'hello world', maxRetries: 0, abortSignal: ctl.signal });
      ctl.abort();
      await expect(p).rejects.toThrow();
    }
    const u = (await pool.snapshot()).members[0]!.usage;
    // Finding: every aborted call is committed at its *estimate* (1 request + ~512 output tokens),
    // even when the abort happened before any byte reached the provider.
    expect(u.rpd!.used).toBe(100);
    expect(u.tpd!.used).toBeGreaterThan(100 * 500);
  });

  it('a signal that is already aborted still reserves and commits (the call never left the process)', async () => {
    const pool = createQuotaPool({ models: [{ id: 'm', model: hanging('m'), limits: { rpd: 1000 } }] });
    const ctl = new AbortController();
    ctl.abort();
    await expect(generateText({ model: pool.model(), prompt: 'x', maxRetries: 0, abortSignal: ctl.signal })).rejects.toThrow();
    expect((await pool.snapshot()).members[0]!.usage.rpd!.used).toBe(1);
  });

  it('an aborted call does not cool the member down or fall through to the next member', async () => {
    const events: PoolEvent[] = [];
    const pool = createQuotaPool({
      models: [
        { id: 'a', model: hanging('a') },
        { id: 'b', model: ok('b') },
      ],
      onEvent: (e) => events.push(e),
    });
    const ctl = new AbortController();
    const p = generateText({ model: pool.model(), prompt: 'x', maxRetries: 0, abortSignal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toThrow();
    expect(events.map((e) => e.type)).toEqual(['route']);
  });
});

describe('Q5: two pools, one store', () => {
  it('share counters for the same member id', async () => {
    const store = memoryStore();
    const make = () => createQuotaPool({ models: [{ id: 'm', model: ok('m'), limits: { rpd: 10 } }], store });
    const p1 = make();
    const p2 = make();
    await generateText({ model: p1.model(), prompt: 'x', maxRetries: 0 });
    await generateText({ model: p2.model(), prompt: 'x', maxRetries: 0 });
    expect((await p1.snapshot()).members[0]!.usage.rpd!.used).toBe(2);
  });
});

describe('Q6: which member answered', () => {
  it('result.providerMetadata.aiSdkQuota.memberId (and a route event)', async () => {
    const pool = createQuotaPool({ models: [{ id: 'groq-20b', model: ok('gpt-oss-20b') }] });
    const r = await generateText({ model: pool.model(), prompt: 'x', maxRetries: 0 });
    expect(r.providerMetadata?.aiSdkQuota).toMatchObject({ memberId: 'groq-20b', modelId: 'gpt-oss-20b' });
  });

  it('also on streams, via the finish part', async () => {
    const parts = [
      { type: 'stream-start' as const, warnings: [] },
      { type: 'text-start' as const, id: 't' },
      { type: 'text-delta' as const, id: 't', delta: 'hi' },
      { type: 'text-end' as const, id: 't' },
      { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: 'stop' }, usage: usage(1, 1) },
    ];
    const model = new MockLanguageModelV4({
      provider: 'mock',
      modelId: 's',
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            for (const p of parts) c.enqueue(p);
            c.close();
          },
        }),
      }),
    });
    const pool = createQuotaPool({ models: [{ id: 'local', model }] });
    const r = streamText({ model: pool.model(), prompt: 'x', maxRetries: 0 });
    await r.consumeStream();
    expect((await r.providerMetadata)?.aiSdkQuota).toMatchObject({ memberId: 'local' });
  });
});

const Fixes = z.object({ fixes: z.array(z.object({ id: z.number().int(), text: z.string() })) });

describe('Q7 + structured output in a mixed pool', () => {
  it('a 400 from a member that rejects response_format is rethrown; the next member is never tried', async () => {
    const b = ok('b', '{"fixes":[]}');
    const pool = createQuotaPool({
      models: [
        { id: 'a', model: new MockLanguageModelV4({ provider: 'mock', modelId: 'a', doGenerate: async () => Promise.reject(apiError(400)) }) },
        { id: 'b', model: b },
      ],
    });
    await expect(
      generateText({ model: pool.model(), prompt: 'x', maxRetries: 0, output: Output.object({ schema: Fixes }) }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(b.doGenerateCalls).toHaveLength(0);
  });

  it('a structured-output call does not automatically require `json` (unlike tools)', async () => {
    const events: PoolEvent[] = [];
    const pool = createQuotaPool({
      models: [
        { id: 'nojson', model: ok('n', '{"fixes":[]}'), capabilities: { json: false } },
        { id: 'json', model: ok('j', '{"fixes":[]}') },
      ],
      onEvent: (e) => events.push(e),
    });
    await generateText({ model: pool.model(), prompt: 'x', maxRetries: 0, output: Output.object({ schema: Fixes }) });
    expect(events.find((e) => e.type === 'route')).toMatchObject({ memberId: 'nojson' });
  });

  it('bad JSON in a 200 is a success to the pool: NoObjectGeneratedError surfaces only after it', async () => {
    const events: PoolEvent[] = [];
    const pool = createQuotaPool({
      models: [
        { id: 'a', model: ok('a', 'not json') },
        { id: 'b', model: ok('b', '{"fixes":[]}') },
      ],
      onEvent: (e) => events.push(e),
    });
    const err = await generateText({ model: pool.model(), prompt: 'x', maxRetries: 0, output: Output.object({ schema: Fixes }) }).catch((e) => e);
    expect(NoObjectGeneratedError.isInstance(err)).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['route', 'reconcile']);
  });
});

describe('Q8: probe as a library', () => {
  it('is not exported from the package entry points', () => {
    expect((quota as Record<string, unknown>).probe).toBeUndefined();
  });
});
