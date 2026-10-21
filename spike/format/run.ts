// Phase 0 format spike (PLAN §5.3): structured output (A) vs tag protocol (B), per model.
//
// Margin v1 is local-only. This dev-only spike also runs *hosted copies of the same open
// models* (Gemma 4, Qwen, gpt-oss) so a default can be picked without downloading weights.
// Only the synthetic fixture is sent. Keys come from spike/.env (gitignored):
//
//   node --env-file=.env format/run.ts                    # every model whose key is set
//   LOCAL_MODELS=gemma4:12b-it-qat node format/run.ts     # a local Ollama server
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, type LanguageModel, NoObjectGeneratedError, Output } from 'ai';
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
  // An empty reply is a failure (e.g. reasoning used up the output budget), not "no fixes".
  return out.length ? out : undefined;
}

const prompt = fixture.sentences.map((s) => `<s id="${s.id}">${s.text}</s>`).join('\n');
const inputChars = prompt.length;
const maxOutputTokens = Math.ceil((inputChars / 4) * 1.3) + 100;

interface Member {
  id: string;
  model: LanguageModel;
  providerOptions?: Record<string, Record<string, unknown>>;
  /** The endpoint rejects system instructions (Gemma on the Gemini API): fold the system prompt into the user prompt. */
  noSystem?: boolean;
}

const list = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

function members(): Member[] {
  const out: Member[] = [];
  const env = process.env;
  const baseURL = env.LOCAL_BASE_URL ?? 'http://localhost:11434/v1';
  const local = createOpenAICompatible({ name: 'local', baseURL, supportsStructuredOutputs: true });
  for (const id of list(env.LOCAL_MODELS)) {
    out.push({ id: `local:${id}`, model: local(id), providerOptions: { local: { reasoningEffort: 'none' } } });
  }
  if (env.OPENROUTER_API_KEY) {
    const or = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });
    // Free: Gemma 4 26B A4B (the 16 GB "to try" model) and 31B. Paid ones cost fractions of a cent per run.
    const ids = list(env.OPENROUTER_MODELS ?? 'google/gemma-4-26b-a4b-it:free,google/gemma-4-31b-it:free,qwen/qwen3.5-9b,qwen/qwen3-14b,openai/gpt-oss-20b');
    for (const id of ids) {
      const reasoning = /gpt-oss/.test(id) ? { effort: 'low' } : { effort: 'none' };
      out.push({ id: `openrouter:${id}`, model: or(id), providerOptions: { openrouter: { reasoning, provider: { data_collection: 'deny' } } } });
    }
  }
  if (env.GROQ_API_KEY) {
    const groq = createGroq({ apiKey: env.GROQ_API_KEY });
    for (const id of list(env.GROQ_MODELS ?? 'openai/gpt-oss-20b')) {
      out.push({ id: `groq:${id}`, model: groq(id), providerOptions: { groq: { reasoningEffort: 'low' } } });
    }
  }
  if (env.GEMINI_API_KEY) {
    const google = createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY });
    // Gemma variants hosted by Google; set GEMINI_MODELS from the model listing (see format/list-gemini.ts).
    for (const id of list(env.GEMINI_MODELS)) {
      // Gemma 4 thinks by default here and can spend the whole output budget on it; 'minimal' turns it off.
      out.push({ id: `gemini:${id}`, model: google(id), noSystem: id.startsWith('gemma'), providerOptions: { google: { thinkingConfig: { thinkingLevel: 'minimal' } } } });
    }
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
  /** Raw reply (synthetic fixture only), for debugging parse failures. */
  text?: string;
}

async function once(m: Member, format: 'A' | 'B'): Promise<Run> {
  const t0 = performance.now();
  const call = (system: string) => ({
    model: m.model,
    maxRetries: 0,
    temperature: 0,
    maxOutputTokens,
    providerOptions: m.providerOptions as never,
    abortSignal: AbortSignal.timeout(120_000),
    ...(m.noSystem ? { prompt: `${system}

Input:
${prompt}` } : { system, prompt }),
  });
  try {
    if (format === 'A') {
      const r = await generateText({ ...call(SYSTEM_A), output: Output.object({ schema: Fixes }) });
      return { member: m.id, format, ok: true, ms: performance.now() - t0, ...tokens(r.usage), fixes: r.output.fixes, text: r.text };
    }
    const r = await generateText(call(SYSTEM_B));
    const fixes = parseTags(r.text);
    return { member: m.id, format, ok: fixes !== undefined, ms: performance.now() - t0, ...tokens(r.usage), ...(fixes ? { fixes } : { error: 'unparseable' }), text: r.text };
  } catch (e) {
    const text = NoObjectGeneratedError.isInstance(e) ? e.text : undefined;
    return { member: m.id, format, ok: false, ms: performance.now() - t0, error: e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : String(e), ...(text === undefined ? {} : { text }) };
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
const targets = members();
if (!targets.length) throw new Error('No models configured: set keys in spike/.env or LOCAL_MODELS (see the header comment).');
for (const m of targets) {
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
