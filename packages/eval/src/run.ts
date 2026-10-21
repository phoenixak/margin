// Margin eval. Real model calls with synthetic fixtures only.
//
//   pnpm -F @margin/eval eval -- --label baseline --batch 8 --concurrency 2
//
// GEMINI_API_KEY comes from the environment or a .env in the repo root.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { check, createModel, type MarginModel, type ModelConfig } from '@margin/core';
import { Dialect, LocalLinter } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';
import { type Item, type ItemResult, layout, scoreItem, type Summary, summarize } from './score.ts';

const { values } = parseArgs({
  options: {
    label: { type: 'string', default: 'run' },
    provider: { type: 'string', default: 'gemini' },
    model: { type: 'string' },
    'base-url': { type: 'string' },
    batch: { type: 'string', default: '8' },
    concurrency: { type: 'string', default: '1' },
    'edit-ratio': { type: 'string', default: '0.35' },
    sets: { type: 'string', default: 'errors,clean,markdown' },
    runs: { type: 'string', default: '1' },
  },
});

const root = new URL('../../../', import.meta.url);
try {
  process.loadEnvFile(new URL('.env', root));
} catch {
  // no .env
}

function makeModel(): MarginModel {
  const id = values.model;
  if (values.provider === 'local') {
    return createModel({ provider: 'local', ...(id ? { model: id } : {}), ...(values['base-url'] ? { baseURL: values['base-url'] } : {}) } as ModelConfig);
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  return createModel({ provider: 'gemini', apiKey, ...(id ? { model: id } : {}) });
}

const load = (name: string): Item[] => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8')).items;

async function harperFlags(items: Item[]): Promise<boolean[]> {
  const linter = new LocalLinter({ binary: binaryInlined, dialect: Dialect.American });
  try {
    return await Promise.all(items.map(async (i) => (await linter.lint(i.text, { language: 'markdown' })).length > 0));
  } finally {
    await linter.dispose();
  }
}

const model = makeModel();
const batch = Number(values.batch);
const concurrency = Number(values.concurrency);
const maxEditRatio = Number(values['edit-ratio']);
const sets = values.sets!.split(',');
const runs = Number(values.runs);
const commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
const date = new Date().toISOString().slice(0, 10);

const items = sets.flatMap((s) => load(s).map((i) => ({ ...i, set: s })));
const harper = await harperFlags(items);
const { text, ranges } = layout(items);

const perRun: { summary: Summary; ms: number; calls: number; errors: string[]; results: ItemResult[] }[] = [];
for (let r = 0; r < runs; r++) {
  const started = performance.now();
  const errors: string[] = [];
  let result: Awaited<ReturnType<typeof check>> | undefined;
  try {
    // No Harper ranges: this measures Margin itself. Harper's coverage is reported separately.
    result = await check({ text, model, batch: { maxSentences: batch }, concurrency, guard: { maxEditRatio } });
  } catch (error) {
    errors.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  }
  const ms = Math.round(performance.now() - started);
  const results = items.map((item, i) => scoreItem(item, ranges[i]!, text, result?.suggestions ?? [], result?.rejected ?? [], harper[i]!));
  perRun.push({ summary: summarize(results), ms, calls: result?.modelCalls ?? 0, errors, results });
  console.error(`run ${r + 1}/${runs}: ${ms} ms, ${result?.modelCalls ?? 0} calls${errors.length ? `, ERROR ${errors[0]}` : ''}`);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const rows = perRun.map(
  ({ summary: s, ms, calls }, i) =>
    `| ${values.label}${runs > 1 ? ` #${i + 1}` : ''} | ${model.id} | ${batch} | ${concurrency} | ${maxEditRatio} | ${pct(s.precision)} | ${pct(s.recall)} | ${s.f05.toFixed(3)} | ${s.falsePositives}/${s.clean} (${pct(s.falsePositiveRate)}) | ${s.correct}/${s.wrong}/${s.missed} | ${pct(s.combinedRecall)} | ${calls} | ${(ms / 1000).toFixed(1)} s |`,
);
const header =
  '| label | model | batch | conc. | edit ratio | precision | recall | F0.5 | false positives (clean) | correct/wrong/missed | + Harper recall | calls | time |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|';

const last = perRun.at(-1)!;
const details = last.results
  .filter((r) => r.outcome === 'wrong' || r.outcome === 'false-positive' || r.outcome === 'missed')
  .map((r) => `- ${r.id} (${r.type ?? ''}${r.debatable ? ', debatable' : ''}) **${r.outcome}**${r.rejected.length ? ` [rejected: ${r.rejected.join(', ')}]` : ''}${r.harper ? ' [Harper flags it]' : ''}: ${r.outcome === 'missed' ? '' : `“${r.output}”`}`);

mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
const base = `${date}-${values.label}`;
writeFileSync(
  new URL(`../results/${base}.json`, import.meta.url),
  JSON.stringify({ date, commit, model: model.id, tested: model.tested, batch, concurrency, maxEditRatio, sets, runs: perRun }, null, 2),
);
const md = `# Eval ${values.label} (${date}, commit ${commit})\n\n${items.length} items: ${sets.join(', ')}. Debatable items are listed but excluded from the scores. Harper ranges are not used, so this measures Margin alone; "+ Harper recall" counts errors fixed by Margin or flagged by Harper.\n\n${header}\n${rows.join('\n')}\n\nRejections (last run): ${JSON.stringify(last.summary.rejectedByReason)}\n\n## Misses, wrong fixes and false positives (last run)\n\n${details.join('\n')}\n`;
writeFileSync(new URL(`../results/${base}.md`, import.meta.url), md);
console.log(`${header}\n${rows.join('\n')}`);
console.log(`\nwrote results/${base}.{json,md}`);
