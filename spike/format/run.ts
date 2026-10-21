// Phase 0 format spike (PLAN §5.3): structured output (A) vs tag protocol (B), per member.
//
//   LOCAL_BASE_URL=http://localhost:11434/v1 LOCAL_MODELS=gemma4:12b-it-qat node format/run.ts
//
// Cloud members run only with MARGIN_SPIKE_CLOUD=1 plus their key (GROQ_API_KEY,
// GEMINI_API_KEY, OPENROUTER_API_KEY). The fixture is synthetic; no real text is sent.
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, type LanguageModel, Output } from 'ai';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

type Sentence = { id: number; text: string; expected: string | null; type?: string };
const fixture: { sentences: Sentence[] } = JSON.parse(readFileSync(new URL('fixture.json', import.meta.url), 'utf8'));
const RUNS = Number(process.env.RUNS ?? 3);

const RULES = `You are a copy editor doing a minimal-edit proofread of American English.

You receive sentences as <s id="N">…</s>. Some may be correct.
Fix only clear errors:
- grammar and agreement (subject–verb, pronoun, tense consistency)
- a wrong word that is still a real word (their/there, affect/effect)
- missing, repeated or extra words
- run-on sentences and comma splices
- punctuation that changes or hides the meaning
Do not:
- change a sentence that is already correct
- change word choice, tone, style or dialect
- fix spelling or capitalization (another tool handles those)
- touch placeholders like ⟦0⟧; keep each one exactly once, in order
- add or remove negation, numbers, names or facts
Return only the sentences you changed, each as the full corrected sentence, with a kind and a reason of at most 12 words. If nothing needs fixing, return an empty list.`;

const SYSTEM_A = `${RULES}

Example input:
<s id="1">The dogs barks at night.</s>
<s id="2">Open ⟦0⟧ to start.</s>
Example output:
{"fixes":[{"id":1,"text":"The dogs bark at night.","kind":"grammar","why":"Plural subject takes a plural verb."}]}`;

const SYSTEM_B = `${RULES}

Answer with one line per changed sentence, and nothing else:
<fix id="N" kind="grammar|word|punctuation|clarity">full corrected sentence</fix><why>reason</why>
If nothing needs fixing, answer <none/>.

Example input:
<s id="1">The dogs barks at night.</s>
<s id="2">Open ⟦0⟧ to start.</s>
Example output:
<fix id="1" kind="grammar">The dogs bark at night.</fix><why>Plural subject takes a plural verb.</why>`;

const Fix = z.object({
  id: z.number().int(),
  text: z.string().min(1),
  kind: z.enum(['grammar', 'word', 'punctuation', 'clarity']),
  why: z.string().max(120),
});
const Fixes = z.object({ fixes: z.array(Fix) });
type FixT = z.infer<typeof Fix>;

function parseTags(text: string): FixT[] | undefined {
  if (/<none\s*\/>/.test(text) && !text.includes('<fix')) return [];
  const out: FixT[] = [];
  for (const m of text.matchAll(/<fix\s+id="(\d+)"(?:\s+kind="(\w+)")?\s*>([\s\S]*?)<\/fix>\s*(?:<why>([\s\S]*?)<\/why>)?/g)) {
    const r = Fix.safeParse({ id: Number(m[1]), kind: m[2] ?? 'grammar', text: m[3]!.trim(), why: (m[4] ?? '').trim().slice(0, 120) });
    if (r.success) out.push(r.data);
  }
  return out.length || !text.trim() ? out : undefined;
}

const prompt = fixture.sentences.map((s) => `<s id="${s.id}">${s.text}</s>`).join('\n');
const inputChars = prompt.length;
const maxOutputTokens = Math.ceil((inputChars / 4) * 1.3) + 100;

interface Member {
  id: string;
  model: LanguageModel;
  providerOptions?: Record<string, Record<string, unknown>>;
}

function members(): Member[] {
  const out: Member[] = [];
  const baseURL = process.env.LOCAL_BASE_URL ?? 'http://localhost:11434/v1';
  const local = createOpenAICompatible({ name: 'local', baseURL, supportsStructuredOutputs: true });
  for (const id of (process.env.LOCAL_MODELS ?? 'gemma4:12b-it-qat').split(',').filter(Boolean)) {
    out.push({ id: `local:${id}`, model: local(id), providerOptions: { local: { reasoningEffort: 'none' } } });
  }
  if (process.env.MARGIN_SPIKE_CLOUD !== '1') return out;
  if (process.env.GROQ_API_KEY) {
    out.push({
      id: 'groq:gpt-oss-20b',
      model: createGroq({ apiKey: process.env.GROQ_API_KEY })('openai/gpt-oss-20b'),
      providerOptions: { groq: { reasoningEffort: 'low' } },
    });
  }
  if (process.env.GEMINI_API_KEY) {
    out.push({
      id: 'gemini:3.5-flash-lite',
      model: createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })('gemini-3.5-flash-lite'),
      providerOptions: { google: { thinkingConfig: { thinkingLevel: 'minimal' } } },
    });
  }
  if (process.env.OPENROUTER_API_KEY) {
    out.push({
      id: 'openrouter:gemma-4-26b-a4b:free',
      model: createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })('google/gemma-4-26b-a4b-it:free'),
      providerOptions: { openrouter: { reasoning: { effort: 'none' }, provider: { data_collection: 'deny' } } },
    });
  }
  return out;
}

interface Run {
  member: string;
  format: 'A' | 'B';
  ok: boolean;
  error?: string;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  fixes?: FixT[];
}

async function once(m: Member, format: 'A' | 'B'): Promise<Run> {
  const t0 = performance.now();
  const base = {
    model: m.model,
    maxRetries: 0,
    temperature: 0,
    maxOutputTokens,
    prompt,
    providerOptions: m.providerOptions as never,
    abortSignal: AbortSignal.timeout(120_000),
  };
  try {
    if (format === 'A') {
      const r = await generateText({ ...base, system: SYSTEM_A, output: Output.object({ schema: Fixes }) });
      return { member: m.id, format, ok: true, ms: performance.now() - t0, ...tokens(r.usage), fixes: r.output.fixes };
    }
    const r = await generateText({ ...base, system: SYSTEM_B });
    const fixes = parseTags(r.text);
    return { member: m.id, format, ok: fixes !== undefined, ms: performance.now() - t0, ...tokens(r.usage), ...(fixes ? { fixes } : { error: 'unparseable' }) };
  } catch (e) {
    return { member: m.id, format, ok: false, ms: performance.now() - t0, error: e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : String(e) };
  }
}

function tokens(u: { inputTokens?: number; outputTokens?: number; outputTokenDetails?: { reasoningTokens?: number } }) {
  return { inputTokens: u.inputTokens, outputTokens: u.outputTokens, reasoningTokens: u.outputTokenDetails?.reasoningTokens };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const placeholders = (s: string) => s.match(/⟦\d+⟧/g)?.join('') ?? '';

function score(fixes: FixT[]) {
  const byId = new Map(fixes.map((f) => [f.id, f]));
  let tp = 0, exact = 0, fp = 0, fn = 0, placeholderViolations = 0, unknownIds = 0;
  for (const f of fixes) if (!fixture.sentences.some((s) => s.id === f.id)) unknownIds++;
  for (const s of fixture.sentences) {
    const f = byId.get(s.id);
    const changed = f !== undefined && norm(f.text) !== norm(s.text);
    if (f && placeholders(f.text) !== placeholders(s.text)) placeholderViolations++;
    if (s.expected === null) {
      if (changed) fp++;
    } else if (changed) {
      tp++;
      if (norm(f!.text) === norm(s.expected)) exact++;
    } else fn++;
  }
  return { tp, exact, fp, fn, placeholderViolations, unknownIds };
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!) : NaN;
};

const all: Run[] = [];
for (const m of members()) {
  for (const format of ['A', 'B'] as const) {
    for (let i = 0; i < RUNS; i++) {
      const r = await once(m, format);
      all.push(r);
      console.log(`${m.id} ${format} #${i + 1}: ${r.ok ? 'ok' : `FAIL ${r.error}`} ${Math.round(r.ms)}ms`);
    }
  }
}

const rows = [...new Set(all.map((r) => `${r.member}|${r.format}`))].map((key) => {
  const runs = all.filter((r) => `${r.member}|${r.format}` === key);
  const ok = runs.filter((r) => r.ok);
  const scores = ok.map((r) => score(r.fixes!));
  const sum = (k: keyof ReturnType<typeof score>) => scores.reduce((a, s) => a + s[k], 0);
  const [member, format] = key.split('|');
  return {
    member, format, runs: runs.length, parsed: ok.length,
    p50: pct(ok.map((r) => r.ms), 50), p95: pct(ok.map((r) => r.ms), 95),
    outTokens: ok.length ? Math.round(ok.reduce((a, r) => a + (r.outputTokens ?? 0), 0) / ok.length) : NaN,
    tp: sum('tp'), exact: sum('exact'), fp: sum('fp'), fn: sum('fn'),
    placeholderViolations: sum('placeholderViolations'), unknownIds: sum('unknownIds'),
  };
});

const date = new Date().toISOString().slice(0, 10);
const errors = fixture.sentences.filter((s) => s.expected !== null).length;
const table = [
  `Format spike, ${date}. ${fixture.sentences.length} sentences (${errors} with errors), ${RUNS} runs per member and format. Counts are summed over parsed runs.`,
  '',
  '| member | format | parsed | p50 ms | p95 ms | out tok | changed errors | exact | false positives | missed | placeholder violations | unknown ids |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.member} | ${r.format} | ${r.parsed}/${r.runs} | ${r.p50} | ${r.p95} | ${r.outTokens} | ${r.tp} | ${r.exact} | ${r.fp} | ${r.fn} | ${r.placeholderViolations} | ${r.unknownIds} |`),
].join('\n');

mkdirSync(new URL('results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`results/${date}.json`, import.meta.url), JSON.stringify({ date, runs: RUNS, maxOutputTokens, rows, raw: all }, null, 2));
writeFileSync(new URL(`results/${date}.md`, import.meta.url), `${table}\n`);
console.log(`\n${table}`);
