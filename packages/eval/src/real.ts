// Real-world documents through the same pipeline the extensions use: Harper lints first, Margin
// checks the rest with the given model. Run `pnpm -F @margin/eval fetch-real` first.
//
//   pnpm -F @margin/eval eval-real -- --provider local --label local-gemma4-26b
//
// Writes every Margin flag (with its text) to data/real/flags-<label>.json for labelling; that
// file stays git-ignored. Only counts and timings go to results/.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { check, createModel, type MarginModel, type ModelConfig } from '@margin/core';
import { Dialect, LocalLinter } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    label: { type: 'string', default: 'real' },
    provider: { type: 'string', default: 'local' },
    model: { type: 'string' },
    'base-url': { type: 'string' },
  },
});

const root = new URL('../../../', import.meta.url);
try {
  process.loadEnvFile(new URL('.env', root));
} catch {
  // no .env
}
const data = new URL('../data/real/', import.meta.url);

function makeModel(): MarginModel {
  const id = values.model;
  if (values.provider === 'local') {
    return createModel({ provider: 'local', ...(id ? { model: id } : {}), ...(values['base-url'] ? { baseURL: values['base-url'] } : {}) } as ModelConfig);
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  return createModel({ provider: 'gemini', apiKey, ...(id ? { model: id } : {}) });
}

const model = makeModel();
const linter = new LocalLinter({ binary: binaryInlined, dialect: Dialect.American });
const words = (s: string) => s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;

interface DocResult {
  set: 'docs' | 'issues';
  file: string;
  words: number;
  sentences: number;
  harper: number;
  margin: number;
  /** Margin flags dropped because Harper already flags that spot. */
  dedup: number;
  ms: number;
  calls: number;
}

const results: DocResult[] = [];
const flags: { file: string; original: string; fixed: string; replacement: string; why: string; kind: string }[] = [];
for (const set of ['docs', 'issues'] as const) {
  for (const file of readdirSync(new URL(`${set}/`, data)).sort()) {
    const text = readFileSync(new URL(`${set}/${file}`, data), 'utf8').replace(/\r\n/g, '\n');
    const lints = await linter.lint(text, { language: 'markdown' });
    const existing = lints.map((l) => ({ start: l.span().start, end: l.span().end }));
    const t = performance.now();
    const r = await check({ text, model, existing, batch: { maxSentences: 8 }, concurrency: model.parallel ?? 1 });
    const ms = Math.round(performance.now() - t);
    results.push({
      set,
      file,
      words: words(text),
      sentences: r.sentences,
      harper: lints.length,
      margin: r.suggestions.length,
      dedup: r.rejected.filter((x) => x.reason === 'harper-overlap').length,
      ms,
      calls: r.modelCalls,
    });
    for (const s of r.suggestions) flags.push({ file: `${set}/${file}`, original: s.sentence.original, fixed: s.sentence.fixed, replacement: s.replacement, why: s.why, kind: s.kind });
    console.error(`${set}/${file}: ${r.sentences} sentences, Harper ${lints.length}, Margin ${r.suggestions.length}, ${(ms / 1000).toFixed(1)} s`);
  }
}
await linter.dispose();

const date = new Date().toISOString().slice(0, 10);
const commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
writeFileSync(new URL(`flags-${values.label}.json`, data), `${JSON.stringify(flags, null, 2)}\n`);
mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
const out = new URL(`../results/${date}-real-${values.label}.json`, import.meta.url);
const previous = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
writeFileSync(out, `${JSON.stringify({ ...previous, date, commit, model: model.id, documents: results }, null, 2)}\n`);
const sum = (set: string, k: keyof DocResult) => results.filter((r) => r.set === set).reduce((n, r) => n + Number(r[k]), 0);
for (const set of ['docs', 'issues']) {
  const w = sum(set, 'words');
  console.log(
    `${set}: ${results.filter((r) => r.set === set).length} documents, ${w} words, ${sum(set, 'sentences')} sentences; Harper ${sum(set, 'harper')} flags (${((sum(set, 'harper') / w) * 1000).toFixed(1)}/1k words); Margin ${sum(set, 'margin')} flags (${((sum(set, 'margin') / w) * 1000).toFixed(1)}/1k words), ${sum(set, 'dedup')} dropped for Harper overlap; ${(sum(set, 'ms') / 1000).toFixed(0)} s, ${(sum(set, 'ms') / Math.max(1, sum(set, 'sentences'))).toFixed(0)} ms/sentence`,
  );
}
console.log(`flags for labelling: packages/eval/data/real/flags-${values.label}.json (${flags.length})`);
