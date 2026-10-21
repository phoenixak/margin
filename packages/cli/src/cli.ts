#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { check, createModel, type Dialect, type MarginModel, REWRITE_PRESETS, type RewritePreset, rewrite } from '@margin/core';
import { formatSuggestion, lineCol } from './format.js';
import { harperRanges } from './harper.js';

const HELP = `margin: an AI second pass for Harper

Usage:
  margin check <file> [options]
  margin rewrite <file> --preset <${[...Object.keys(REWRITE_PRESETS), 'custom'].join('|')}> [--instruction "…"] [--lines a-b]

Options:
  --provider gemini|local   Default gemini (tested). local = Ollama / LM Studio (untested).
  --model <id>              Default gemma-4-26b-a4b-it (gemini) or gemma4:26b-a4b-it-qat (local)
  --base-url <url>          Local server, default http://localhost:11434/v1
  --dialect <name>          American (default), British, Australian, Canadian, Indian
  --plaintext               Treat the file as plain text instead of Markdown
  --no-harper               Don't run Harper for dedup
  --json                    Print suggestions as JSON

The Gemini key is read from GEMINI_API_KEY (a .env file in the current directory works).
With --provider gemini, the file's text is sent to Google's Gemini API.`;

const DIALECTS: Dialect[] = ['American', 'British', 'Australian', 'Canadian', 'Indian'];

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      provider: { type: 'string', default: 'gemini' },
      model: { type: 'string' },
      'base-url': { type: 'string' },
      dialect: { type: 'string', default: 'American' },
      plaintext: { type: 'boolean', default: false },
      'no-harper': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      preset: { type: 'string' },
      instruction: { type: 'string' },
      lines: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, file] = positionals;
  if (values.help || !command || !file || !['check', 'rewrite'].includes(command)) {
    console.log(HELP);
    return values.help ? 0 : 2;
  }
  const dialect = values.dialect as Dialect;
  if (!DIALECTS.includes(dialect)) throw new Error(`unknown dialect "${values.dialect}"`);

  try {
    process.loadEnvFile();
  } catch {
    // no .env here
  }
  const model = makeModel(values.provider!, values.model, values['base-url']);
  const text = readFileSync(file, 'utf8');
  const language = values.plaintext ? 'plaintext' : 'markdown';

  const ctl = new AbortController();
  process.once('SIGINT', () => ctl.abort());

  if (command === 'check') {
    const existing = values['no-harper'] ? [] : await harperRanges(text, dialect, language);
    const started = performance.now();
    const r = await check({ text, model, dialect, language, existing, signal: ctl.signal, batch: { maxSentences: 8 }, concurrency: 2 });
    if (values.json) {
      console.log(JSON.stringify(r.suggestions.map((s) => ({ ...lineCol(text, s.range.start), ...s })), null, 2));
    } else {
      for (const s of r.suggestions) console.log(formatSuggestion(file, text, s));
    }
    const reasons = Object.entries(Object.groupBy(r.rejected, (x) => x.reason)).map(([k, v]) => `${k} ${v!.length}`);
    console.error(
      `${r.suggestions.length} suggestion(s) in ${r.sentences} sentence(s); ${r.modelCalls} call(s) to ${model.id}, ${r.cacheHits} cached, ` +
        `${Math.round(performance.now() - started)} ms; Harper ranges ${existing.length}${reasons.length ? `; rejected: ${reasons.join(', ')}` : ''}`,
    );
    return 0;
  }

  const preset = values.preset as RewritePreset | undefined;
  if (!preset || !(preset === 'custom' || preset in REWRITE_PRESETS)) throw new Error('rewrite needs --preset');
  const [from, to] = (values.lines ?? '').split('-').map(Number);
  const lines = text.split('\n');
  const selected = values.lines ? lines.slice(from! - 1, to ?? from).join('\n') : text;
  const r = rewrite({ text: selected, model, preset, dialect, signal: ctl.signal, ...(values.instruction ? { instruction: values.instruction } : {}) });
  for await (const part of r.textStream) process.stdout.write(part);
  const { warnings } = await r.done;
  process.stdout.write('\n');
  if (warnings.length) console.error(`check before using: ${warnings.join(', ')} changed`);
  return 0;
}

function makeModel(provider: string, modelId: string | undefined, baseURL: string | undefined): MarginModel {
  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('set GEMINI_API_KEY (or use --provider local)');
    const m = createModel({ provider: 'gemini', apiKey, ...(modelId ? { model: modelId } : {}) });
    console.error(`Sending text to Google's Gemini API (${m.id}).`);
    return m;
  }
  if (provider === 'local') {
    const m = createModel({ provider: 'local', ...(modelId ? { model: modelId } : {}), ...(baseURL ? { baseURL } : {}) });
    console.error(`Using a local server (${m.id}). Note: the local path is untested by Margin's maintainers.`);
    return m;
  }
  throw new Error(`unknown provider "${provider}"`);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`margin: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
