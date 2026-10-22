import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { type BatchOptions, batches } from './batch.js';
import { type Language, splitBlocks } from './blocks.js';
import { type CachedResult, type CheckCache, sha256 } from './cache.js';
import { applyHunks, toHunks } from './diff.js';
import { type GuardOptions, guardFix, overlaps, saysNoError } from './guards.js';
import { mask, unmask } from './mask.js';
import type { MarginModel } from './model.js';
import { type Fix, Fixes, parseJsonLenient, parseTags } from './parse.js';
import { checkSystemPrompt, checkUserPrompt, type OutputFormat, PROMPT_VERSION } from './prompts/check.js';
import { splitSentences } from './sentences.js';
import type { Dialect, FixKind, Hunk, Range, Rejection, Suggestion } from './types.js';

export interface CheckInput {
  text: string;
  model: MarginModel;
  dialect?: Dialect;
  language?: Language;
  /** Harper lint ranges: LLM edits that touch them are dropped (Harper owns those errors). */
  existing?: Range[];
  /** Only check sentences that overlap these ranges (dirty blocks, a selection). Default: everything. */
  ranges?: Range[];
  /** Keys from `ignoreKey()` the user chose to ignore. */
  ignored?: ReadonlySet<string>;
  signal?: AbortSignal;
  cache?: CheckCache;
  batch?: BatchOptions;
  guard?: GuardOptions;
  /** Model calls in flight at once. Default 1 (a local GPU serves one request well; free tiers rate-limit). */
  concurrency?: number;
}

export interface CheckResult {
  suggestions: Suggestion[];
  /** Fixes the model proposed that Margin refused, and why (for the eval and debugging; no text). */
  rejected: Rejection[];
  sentences: number;
  modelCalls: number;
  cacheHits: number;
}

const MAX_ECHO_RETRIES = 4;
const ECHO_NOTE =
  'Note: you flagged this sentence as wrong earlier but returned it unchanged. If it has an error, return the corrected sentence with the error actually fixed. If it is correct, return no fixes.';
const isEcho = (fixed: string, original: string) => fixed.replace(/\s+/g, ' ').trim() === original.replace(/\s+/g, ' ').trim();

export class MarginParseError extends Error {
  override readonly name = 'MarginParseError';
}

/** A sentence prepared for the model: whitespace collapsed, protected spans masked. */
interface Prepared {
  range: Range;
  /** The sentence as in the document. */
  source: string;
  /** Whitespace collapsed; what the model sees after unmasking. */
  collapsed: string;
  /** For each collapsed character: its offset in the sentence, and the offset after it. */
  starts: number[];
  ends: number[];
  masked: string;
  originals: string[];
  key: string;
}

/** Key for the ignore list: one fix to one sentence (`Suggestion.sentence.original` / `.fixed`). Whitespace-insensitive. */
export const ignoreKey = (sentence: string, fixed: string) => {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  return sha256(`${norm(sentence)}\u0000${norm(fixed)}`);
};

export async function check(input: CheckInput): Promise<CheckResult> {
  const { text, model } = input;
  const dialect = input.dialect ?? 'American';
  const result: CheckResult = { suggestions: [], rejected: [], sentences: 0, modelCalls: 0, cacheHits: 0 };

  const prepared: Prepared[] = [];
  for (const block of splitBlocks(text, input.language ?? 'markdown')) {
    for (const s of splitSentences(block)) {
      if (input.ranges && !input.ranges.some((r) => overlaps(s, r))) continue;
      const { text: collapsed, starts, ends } = collapse(s.text);
      const { text: masked, originals } = mask(collapsed);
      const key = await sha256(`${PROMPT_VERSION}\u0000${model.id}\u0000${dialect}\u0000${masked}`);
      prepared.push({ range: { start: s.start, end: s.end }, source: text.slice(s.start, s.end), collapsed, starts, ends, masked, originals, key });
    }
  }
  result.sentences = prepared.length;

  const answers = new Map<Prepared, CachedResult>();
  const misses: Prepared[] = [];
  for (const p of prepared) {
    const hit = await input.cache?.get(p.key);
    if (hit) {
      answers.set(p, hit);
      result.cacheHits++;
    } else misses.push(p);
  }

  const queue = batches(misses.map((p) => ({ p, text: p.masked })), input.batch);
  const worker = async () => {
    for (let batch = queue.shift(); batch; batch = queue.shift()) {
      input.signal?.throwIfAborted();
      const fixes = await callModel(model, dialect, batch.map((b, i) => ({ id: i + 1, text: b.text })), input.signal);
      result.modelCalls++;
      for (const [i, { p }] of batch.entries()) {
        const fix = fixes.get(i + 1);
        if (fix && isEcho(fix.text, p.masked)) {
          echoes.push(p); // flagged but returned unchanged: retried alone below
          continue;
        }
        const answer: CachedResult = fix ? { fixed: fix.text, kind: fix.kind, why: fix.why } : { fixed: null };
        answers.set(p, answer);
        await input.cache?.set(p.key, answer);
      }
    }
  };
  const echoes: Prepared[] = [];
  await Promise.all(Array.from({ length: Math.max(1, Math.min(input.concurrency ?? 1, queue.length)) }, worker));

  // Models sometimes diagnose an error ("subject-verb agreement") but copy the sentence
  // unchanged. Ask once more for just that sentence; if it echoes again, treat it as correct.
  for (const p of echoes.slice(0, MAX_ECHO_RETRIES)) {
    input.signal?.throwIfAborted();
    const fix = (await callModel(model, dialect, [{ id: 1, text: p.masked }], input.signal, ECHO_NOTE)).get(1);
    result.modelCalls++;
    const answer: CachedResult = fix && !isEcho(fix.text, p.masked) ? { fixed: fix.text, kind: fix.kind, why: fix.why } : { fixed: null };
    answers.set(p, answer);
    await input.cache?.set(p.key, answer);
  }

  for (const p of prepared) {
    const answer = answers.get(p);
    if (answer?.fixed) await evaluate(p, answer, input, result);
  }
  return result;
}

async function evaluate(p: Prepared, answer: CachedResult, input: CheckInput, result: CheckResult) {
  const reject = (reason: Rejection['reason']) => result.rejected.push({ sentence: p.range, reason });
  const fixed = unmask(answer.fixed!.trim(), p.originals);
  if (fixed === undefined) return reject('placeholders');
  if (fixed.replace(/\s+/g, ' ') === p.collapsed) return;

  const relative = toHunks(p.collapsed, fixed, 0);
  if (!relative.length) return;
  if (saysNoError(answer.why)) return reject('says-no-error');
  const why = guardFix(p.collapsed, fixed, relative, input.guard);
  if (why) return reject(why);

  // Collapsed offsets → sentence offsets → document offsets.
  const hunks: Hunk[] = relative.map((h) => {
    const start = h.start < p.starts.length ? p.starts[h.start]! : p.source.length;
    const end = h.end === h.start ? start : p.ends[h.end - 1]!;
    return { start: p.range.start + start, end: p.range.start + end, replacement: h.replacement };
  });
  const kept = hunks.filter((h) => !(input.existing ?? []).some((r) => overlaps(h, r)));
  if (!kept.length) return reject('harper-overlap');
  const sentenceFixed = applyHunks(p.source, hunks.map((h) => ({ ...h, start: h.start - p.range.start, end: h.end - p.range.start })));
  if (input.ignored?.size && input.ignored.has(await ignoreKey(p.source, sentenceFixed))) return reject('ignored');
  for (const h of kept) {
    result.suggestions.push({
      range: { start: h.start, end: h.end },
      replacement: h.replacement,
      sentence: { ...p.range, original: p.source, fixed: sentenceFixed },
      kind: (answer.kind as FixKind | undefined) ?? 'grammar',
      why: answer.why ?? '',
      model: input.model.id,
    });
  }
}

/** Collapses whitespace runs to one space, remembering where each character came from. */
function collapse(s: string): { text: string; starts: number[]; ends: number[] } {
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  for (const m of s.matchAll(/\s+|[^\s]+/g)) {
    if (/^\s/.test(m[0])) {
      text += ' ';
      starts.push(m.index);
      ends.push(m.index + m[0].length);
    } else {
      for (let i = 0; i < m[0].length; i++) {
        text += m[0][i];
        starts.push(m.index + i);
        ends.push(m.index + i + 1);
      }
    }
  }
  return { text, starts, ends };
}

async function callModel(m: MarginModel, dialect: Dialect, sentences: { id: number; text: string }[], signal?: AbortSignal, note?: string): Promise<Map<number, Fix>> {
  const user = note ? `${checkUserPrompt(sentences)}\n\n${note}` : checkUserPrompt(sentences);
  const ids = new Set(sentences.map((s) => s.id));
  const call = (format: OutputFormat) => {
    const system = checkSystemPrompt(dialect, format);
    return {
      model: m.model,
      temperature: 0,
      maxRetries: 2,
      maxOutputTokens: Math.max(256, Math.ceil((user.length / 4) * 1.4) + 150),
      ...(signal ? { abortSignal: signal } : {}),
      ...(m.providerOptions ? { providerOptions: m.providerOptions as never } : {}),
      ...(m.foldSystem ? { prompt: `${system}\n\nInput:\n${user}` } : { system, prompt: user }),
    };
  };

  let fixes: Fix[] | undefined;
  if (m.structured) {
    try {
      fixes = (await generateText({ ...call('json'), output: Output.object({ schema: Fixes }) })).output.fixes;
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) throw error;
      fixes = parseJsonLenient(error.text ?? '');
    }
  }
  if (!fixes) {
    const r = await generateText(call('tags'));
    fixes = parseTags(r.text);
    if (!fixes) throw new MarginParseError(`unreadable reply from ${m.id} (${r.text.length} chars, finish: ${r.finishReason})`);
  }
  // Unknown ids are dropped; for a repeated id the first fix wins.
  const out = new Map<number, Fix>();
  for (const f of fixes) if (ids.has(f.id) && !out.has(f.id)) out.set(f.id, f);
  return out;
}
