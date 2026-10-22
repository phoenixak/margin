// Generates the data for the side-by-side showcase page: Harper's lints and Margin's suggestions
// on a sample paragraph, and every rewrite preset on another. The samples were written for the
// demo (no one's real text). Output: results/demo-<label>.json.
//
//   pnpm -F @margin/eval demo -- --provider local --label local-gemma4-26b
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { check, createModel, type ModelConfig, REWRITE_PRESETS, type RewritePreset, rewrite } from '@margin/core';
import { Dialect, LocalLinter } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { label: { type: 'string', default: 'demo' }, provider: { type: 'string', default: 'local' }, model: { type: 'string' } },
});

export const CHECK_SAMPLE =
  "Hi team, I tried the new release yesterday and their is a problem with the export button. When I click it nothing happen, and the progress bar stay stuck at zero. The logs shows a timeout error, but I don't think its the network, my connection was fine. Me and my colleague was able to reproduce it on two different machines. Could you please look into this? Its blocking our launch.";
export const REWRITE_SAMPLE =
  "So basically we decided that we are going to move the weekly sync to Thursday because a lot of people said that Monday mornings are really busy for them and they can't really focus, and also the design team is out on Mondays anyway, so it makes sense. Let me know if that doesn't work for you.";

/** `rewrite()` streams; `done` resolves once the stream has been read. */
const finish = async (r: ReturnType<typeof rewrite>) => {
  for await (const _ of r.textStream);
  return r.done;
};

const model = createModel({ provider: values.provider, ...(values.model ? { model: values.model } : {}), ...(values.provider === 'gemini' ? { apiKey: process.env.GEMINI_API_KEY } : {}) } as ModelConfig);
const linter = new LocalLinter({ binary: binaryInlined, dialect: Dialect.American });
const lints = await linter.lint(CHECK_SAMPLE, { language: 'plaintext' });
const harper = lints.map((l) => ({
  start: l.span().start,
  end: l.span().end,
  kind: l.lint_kind_pretty(),
  message: l.message(),
  replacement: l.suggestions()[0]?.get_replacement_text() ?? null,
}));
await linter.dispose();

const t0 = performance.now();
const checked = await check({ text: CHECK_SAMPLE, model, existing: harper.map(({ start, end }) => ({ start, end })), batch: { maxSentences: 8 } });
const checkMs = Math.round(performance.now() - t0);
const margin = checked.suggestions.map((s) => ({ start: s.range.start, end: s.range.end, replacement: s.replacement, why: s.why, kind: s.kind }));

const rewrites: { preset: string; label: string; text: string; ms: number; warnings: string[] }[] = [];
for (const preset of Object.keys(REWRITE_PRESETS) as Exclude<RewritePreset, 'custom'>[]) {
  const t = performance.now();
  const { text, warnings } = await finish(rewrite({ text: REWRITE_SAMPLE, model, preset }));
  rewrites.push({ preset, label: REWRITE_PRESETS[preset].label, text, ms: Math.round(performance.now() - t), warnings });
}

const out = { model: model.id, checkSample: CHECK_SAMPLE, harper, margin, checkMs, rewriteSample: REWRITE_SAMPLE, rewrites };
writeFileSync(new URL(`../results/demo-${values.label}.json`, import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
