// Rewrite and tone benchmark on real paragraphs (from `pnpm -F @margin/eval fetch-real`).
//
//   pnpm -F @margin/eval rewrite-bench -- --provider local --label local-gemma4-26b
//
// Rewrites have no single right answer, so this measures what can be checked: meaning-safety
// warnings (numbers, negation, protected spans), Harper errors before and after, length,
// contractions and exclamation marks (tone), how much of the text changed, and speed.
// Only numbers go to results/; the rewritten text stays in data/real/ (git-ignored).
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createModel, type MarginModel, type ModelConfig, REWRITE_PRESETS, type RewritePreset, rewrite, splitBlocks } from '@margin/core';
import { Dialect, LocalLinter } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';
import { tokenize, wordEdits } from './human-score.ts';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    label: { type: 'string', default: 'rewrite' },
    provider: { type: 'string', default: 'local' },
    model: { type: 'string' },
    paragraphs: { type: 'string', default: '40' },
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
  if (values.provider === 'local') return createModel({ provider: 'local', ...(id ? { model: id } : {}) } as ModelConfig);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  return createModel({ provider: 'gemini', apiKey, ...(id ? { model: id } : {}) });
}

/** Prose paragraphs of 150–800 characters: no code, tables, headings or link lists. */
function paragraphs(): { source: string; text: string }[] {
  const out: { source: string; text: string }[] = [];
  for (const set of ['issues', 'docs']) {
    for (const file of readdirSync(new URL(`${set}/`, data)).sort()) {
      const md = readFileSync(new URL(`${set}/${file}`, data), 'utf8').replace(/\r\n/g, '\n');
      for (const b of splitBlocks(md)) {
        const text = md.slice(b.start, b.end).trim();
        if (text.length < 150 || text.length > 800 || /^[-*+>#|]|^\d+\./.test(text) || (text.match(/[.!?](\s|$)/g)?.length ?? 0) < 2) continue;
        out.push({ source: `${set}/${file}`, text });
      }
    }
  }
  // Spread the sample across documents: at most 2 paragraphs from each.
  const perDoc = new Map<string, number>();
  return out.filter((p) => (perDoc.set(p.source, (perDoc.get(p.source) ?? 0) + 1).get(p.source) ?? 0) <= 2).slice(0, Number(values.paragraphs));
}

const words = (s: string) => s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
const contractions = (s: string) => s.match(/\b\w+(?:n['’]t|['’](?:re|ve|ll|m|d))\b|\b(?:it|that|there|what|let|here|he|she)['’]s\b/gi)?.length ?? 0;
const exclamations = (s: string) => s.match(/!/g)?.length ?? 0;

/** `rewrite()` streams; `done` resolves once the stream has been read. */
const finish = async (r: ReturnType<typeof rewrite>) => {
  for await (const _ of r.textStream);
  return r.done;
};

const model = makeModel();
const linter = new LocalLinter({ binary: binaryInlined, dialect: Dialect.American });
const lints = async (s: string) => (await linter.lint(s, { language: 'markdown' })).length;
const presets = Object.keys(REWRITE_PRESETS) as Exclude<RewritePreset, 'custom'>[];
const sample = paragraphs();
console.error(`${sample.length} paragraphs × ${presets.length} presets`);

interface Row {
  preset: string;
  ok: number;
  failed: number;
  warnings: Record<string, number>;
  lengthRatio: number[];
  changedShare: number[];
  harperBefore: number;
  harperAfter: number;
  contractionsBefore: number;
  contractionsAfter: number;
  exclamationsBefore: number;
  exclamationsAfter: number;
  ms: number[];
}

const rows: Row[] = [];
const outputs: { source: string; preset: string; before: string; after: string; warnings: string[] }[] = [];
for (const preset of presets) {
  const row: Row = { preset, ok: 0, failed: 0, warnings: {}, lengthRatio: [], changedShare: [], harperBefore: 0, harperAfter: 0, contractionsBefore: 0, contractionsAfter: 0, exclamationsBefore: 0, exclamationsAfter: 0, ms: [] };
  for (const p of sample) {
    const t = performance.now();
    try {
      const { text, warnings } = await finish(rewrite({ text: p.text, model, preset }));
      row.ms.push(performance.now() - t);
      row.ok++;
      for (const w of warnings) row.warnings[w] = (row.warnings[w] ?? 0) + 1;
      row.lengthRatio.push(words(text) / Math.max(1, words(p.text)));
      const src = tokenize(p.text);
      const changed = wordEdits(src, tokenize(text)).reduce((n, e) => {
        const [, s, en] = /^(\d+)-(\d+):/.exec(e)!;
        return n + Math.max(1, Number(en) - Number(s));
      }, 0);
      row.changedShare.push(Math.min(1, changed / Math.max(1, src.length)));
      row.harperBefore += await lints(p.text);
      row.harperAfter += await lints(text);
      row.contractionsBefore += contractions(p.text);
      row.contractionsAfter += contractions(text);
      row.exclamationsBefore += exclamations(p.text);
      row.exclamationsAfter += exclamations(text);
      outputs.push({ source: p.source, preset, before: p.text, after: text, warnings });
    } catch (error) {
      row.failed++;
      console.error(`${preset} failed: ${error instanceof Error ? error.message.slice(0, 120) : error}`);
    }
  }
  rows.push(row);
  console.error(`${preset}: ${row.ok} ok, ${row.failed} failed`);
}
await linter.dispose();

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const date = new Date().toISOString().slice(0, 10);
const commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
writeFileSync(new URL(`rewrites-${values.label}.json`, data), `${JSON.stringify(outputs, null, 2)}\n`);
const summary = rows.map((r) => ({
  preset: r.preset,
  ok: r.ok,
  failed: r.failed,
  warnings: r.warnings,
  medianLengthRatio: median(r.lengthRatio),
  medianChangedShare: median(r.changedShare),
  harperBefore: r.harperBefore,
  harperAfter: r.harperAfter,
  contractionsBefore: r.contractionsBefore,
  contractionsAfter: r.contractionsAfter,
  exclamationsBefore: r.exclamationsBefore,
  exclamationsAfter: r.exclamationsAfter,
  medianMs: Math.round(median(r.ms)),
}));
writeFileSync(new URL(`../results/${date}-rewrite-${values.label}.json`, import.meta.url), `${JSON.stringify({ date, commit, model: model.id, paragraphs: sample.length, presets: summary }, null, 2)}\n`);
console.log('| preset | ok | warnings | length (median) | words changed (median) | Harper errors before → after | contractions before → after | "!" before → after | time (median) |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const s of summary) {
  const w = Object.entries(s.warnings).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  console.log(`| ${s.preset} | ${s.ok}/${s.ok + s.failed} | ${w} | ${pct(s.medianLengthRatio)} | ${pct(s.medianChangedShare)} | ${s.harperBefore} → ${s.harperAfter} | ${s.contractionsBefore} → ${s.contractionsAfter} | ${s.exclamationsBefore} → ${s.exclamationsAfter} | ${(s.medianMs / 1000).toFixed(1)} s |`);
}
