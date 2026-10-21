// Human-text eval: Margin on real writing, run the way the extensions run it (Harper first, Margin
// skips anything Harper flags). Run `pnpm -F @margin/eval fetch-human` first.
//
//   pnpm -F @margin/eval eval-human -- --provider local --label local-26b
//   pnpm -F @margin/eval eval-human -- --provider gemini --label hosted-26b --concurrency 2
//
// JFLEG sentences are licensed CC BY-NC-SA and are never written to the results; only numbers and
// sentence numbers are. Gutenberg text is public domain, so its false alarms are quoted.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { applyHunks, check, createModel, type Hunk, type MarginModel, type ModelConfig, type Range, type Suggestion } from '@margin/core';
import { Dialect, LocalLinter, SuggestionKind } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';
import { BOOKS } from './books.ts';
import { detokenize, gutenbergParagraphs, type HumanSummary, scoreSentence, summarizeHuman } from './human-score.ts';
import { layout } from './score.ts';

const { values } = parseArgs({
  // pnpm passes the `--` separator through.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    label: { type: 'string', default: 'human' },
    provider: { type: 'string', default: 'gemini' },
    model: { type: 'string' },
    'base-url': { type: 'string' },
    batch: { type: 'string', default: '8' },
    concurrency: { type: 'string', default: '1' },
    sets: { type: 'string', default: 'jfleg,gutenberg' },
    jfleg: { type: 'string', default: '747' },
    paragraphs: { type: 'string', default: '200' },
  },
});

const root = new URL('../../../', import.meta.url);
try {
  process.loadEnvFile(new URL('.env', root));
} catch {
  // no .env
}
const data = new URL('../data/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, data), 'utf8');

function makeModel(): MarginModel {
  const id = values.model;
  if (values.provider === 'local') {
    return createModel({ provider: 'local', ...(id ? { model: id } : {}), ...(values['base-url'] ? { baseURL: values['base-url'] } : {}) } as ModelConfig);
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  return createModel({ provider: 'gemini', apiKey, ...(id ? { model: id } : {}) });
}

interface HarperResult {
  ranges: Range[];
  /** Harper's first suggestion for each lint that has one, as hunks over the document. */
  hunks: Hunk[];
}

async function harper(text: string): Promise<HarperResult> {
  const linter = new LocalLinter({ binary: binaryInlined, dialect: Dialect.American });
  try {
    const lints = await linter.lint(text, { language: 'plaintext' });
    const ranges: Range[] = [];
    const hunks: Hunk[] = [];
    for (const lint of lints) {
      const span = lint.span();
      ranges.push({ start: span.start, end: span.end });
      const s = lint.suggestions()[0];
      if (!s) continue;
      const kind = s.kind();
      if (kind === SuggestionKind.Replace) hunks.push({ start: span.start, end: span.end, replacement: s.get_replacement_text() });
      else if (kind === SuggestionKind.Remove) hunks.push({ start: span.start, end: span.end, replacement: '' });
      else hunks.push({ start: span.end, end: span.end, replacement: s.get_replacement_text() });
    }
    return { ranges, hunks };
  } finally {
    await linter.dispose();
  }
}

/** Applies the hunks inside `range` (non-overlapping, first wins) to that slice of the document. */
function applyInside(doc: string, range: Range, hunks: Hunk[]): string {
  const inside = hunks.filter((h) => h.start >= range.start && h.end <= range.end).sort((a, b) => a.start - b.start);
  const kept: Hunk[] = [];
  for (const h of inside) if (!kept.some((k) => h.start < k.end && k.start < h.end)) kept.push(h);
  return applyHunks(doc.slice(range.start, range.end), kept.map((h) => ({ ...h, start: h.start - range.start, end: h.end - range.start })));
}

const toHunks = (s: Suggestion[]): Hunk[] => s.map((x) => ({ start: x.range.start, end: x.range.end, replacement: x.replacement }));

const model = makeModel();
const batch = { maxSentences: Number(values.batch) };
const concurrency = Number(values.concurrency);
const sets = values.sets!.split(',');
const commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
const date = new Date().toISOString().slice(0, 10);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const report: string[] = [];
const json: Record<string, unknown> = { date, commit, model: model.id, tested: model.tested, batch: batch.maxSentences, concurrency };

async function timed<T>(f: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const r = await f();
  return [r, Math.round(performance.now() - t)];
}

if (sets.includes('jfleg')) {
  const lines = (f: string) => read(`jfleg/${f}`).split('\n').slice(0, Number(values.jfleg));
  const src = lines('test.src').map(detokenize);
  const refs = [0, 1, 2, 3].map((k) => lines(`test.ref${k}`).map(detokenize));
  const n = src.filter((s) => s.length > 0).length;
  const { text, ranges } = layout(src.slice(0, n).map((t) => ({ id: '', text: t })));
  const h = await harper(text);
  const [result, ms] = await timed(() => check({ text, model, existing: h.ranges, batch, concurrency }));
  const score = (out: (i: number) => string): HumanSummary =>
    summarizeHuman(src.slice(0, n).map((s, i) => scoreSentence(s, out(i), refs.map((r) => r[i]!))));
  const margin = score((i) => applyInside(text, ranges[i]!, toHunks(result.suggestions)));
  const harperOnly = score((i) => applyInside(text, ranges[i]!, h.hunks));
  const both = score((i) => applyInside(text, ranges[i]!, [...h.hunks, ...toHunks(result.suggestions)]));
  const row = (name: string, s: HumanSummary) =>
    `| ${name} | ${pct(s.precision)} | ${pct(s.recall)} | ${s.f05.toFixed(3)} | ${pct(s.recallNonSpelling)} | ${s.changed} | ${s.cleanChanged}/${s.clean} |`;
  report.push(
    `## JFLEG test set: ${n} sentences from learner essays, 4 human corrections each\n`,
    'Edits are compared word by word with the closest human correction. "Recall without spelling" leaves out one-word spelling and capitalization fixes, which Margin leaves to Harper by design. "Clean sentences changed" counts sentences all four humans left alone.\n',
    '| system | precision | recall | F0.5 | recall without spelling | sentences changed | clean sentences changed |',
    '|---|---|---|---|---|---|---|',
    row('Harper alone (first suggestion)', harperOnly),
    row(`Margin alone (${model.id}, skipping Harper's spans)`, margin),
    row('Harper + Margin (what you get)', both),
    `\n${result.modelCalls} model calls, ${(ms / 1000).toFixed(0)} s (${(ms / Math.max(1, result.sentences)).toFixed(0)} ms per sentence). Rejected by guards: ${result.rejected.length}.\n`,
  );
  json.jfleg = { sentences: n, ms, calls: result.modelCalls, rejected: result.rejected.map((r) => r.reason), harper: harperOnly, margin, both };
  console.error(`jfleg: ${n} sentences, ${(ms / 1000).toFixed(0)} s`);
}

if (sets.includes('gutenberg')) {
  // A fixed, spread-out sample of paragraphs from each book.
  const perBook = Math.ceil(Number(values.paragraphs) / Object.keys(BOOKS).length);
  const items: { book: string; text: string }[] = [];
  for (const [book, id] of Object.entries(BOOKS)) {
    const paras = gutenbergParagraphs(read(`gutenberg/${id}.txt`)).filter((p) => p.length <= 1200);
    const step = paras.length / perBook;
    for (let k = 0; k < perBook && k * step < paras.length; k++) items.push({ book, text: paras[Math.floor(k * step)]! });
  }
  const { text, ranges } = layout(items.map((it) => ({ id: '', text: it.text })));
  const h = await harper(text);
  const [result, ms] = await timed(() => check({ text, model, existing: h.ranges, batch, concurrency }));
  const words = text.split(/\s+/).filter(Boolean).length;
  const flagged = ranges.filter((r) => result.suggestions.some((s) => s.range.start >= r.start && s.range.end <= r.end)).length;
  const sentences = new Map<string, Suggestion>();
  for (const s of result.suggestions) sentences.set(`${s.sentence.start}`, s);
  const examples = [...sentences.values()].map((s) => {
    const i = ranges.findIndex((r) => s.sentence.start >= r.start && s.sentence.end <= r.end);
    return `- *${items[i]?.book}*: “${s.sentence.original}” → “${s.sentence.fixed}” (${s.why})`;
  });
  report.push(
    `## Published prose: ${items.length} paragraphs (${result.sentences} sentences, ${words.toLocaleString('en-US')} words) from four public-domain books\n`,
    `Professionally edited text, so nearly every suggestion here is a false alarm (or old spelling and style). Books: ${Object.keys(BOOKS).join(', ')}.\n`,
    '| | Harper | Margin |',
    '|---|---|---|',
    `| flags | ${h.ranges.length} | ${result.suggestions.length} |`,
    `| per 1,000 words | ${((h.ranges.length / words) * 1000).toFixed(1)} | ${((result.suggestions.length / words) * 1000).toFixed(1)} |`,
    `| sentences Margin changed | | ${sentences.size} of ${result.sentences} (${pct(sentences.size / Math.max(1, result.sentences))}) |`,
    `| paragraphs Margin flagged | | ${flagged} of ${items.length} |`,
    `\n${result.modelCalls} model calls, ${(ms / 1000).toFixed(0)} s. Rejected by guards: ${result.rejected.length}.\n`,
    `### Every sentence Margin changed\n\n${examples.join('\n') || 'None.'}\n`,
  );
  json.gutenberg = { paragraphs: items.length, sentences: result.sentences, words, ms, calls: result.modelCalls, harperFlags: h.ranges.length, marginFlags: result.suggestions.length, sentencesChanged: sentences.size, paragraphsFlagged: flagged };
  console.error(`gutenberg: ${items.length} paragraphs, ${(ms / 1000).toFixed(0)} s`);
}

const base = `${date}-human-${values.label}`;
mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../results/${base}.json`, import.meta.url), `${JSON.stringify(json, null, 2)}\n`);
const md = `# Human-text eval: ${values.label} (${date}, commit ${commit})\n\nModel: \`${model.id}\` (${values.provider}), batch ${batch.maxSentences}, concurrency ${concurrency}. Harper runs first and Margin skips anything Harper flags, as in the extensions.\n\n${report.join('\n')}`;
writeFileSync(new URL(`../results/${base}.md`, import.meta.url), md);
console.log(md);
