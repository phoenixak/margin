#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  check,
  createModel,
  explainError,
  DEFAULT_LOCAL_URLS,
  type Dialect,
  detectLocalServers,
  localSetupHelp,
  type MarginModel,
  modelAdvice,
  modelInfo,
  REWRITE_PRESETS,
  type RewritePreset,
  rewrite,
} from '@margin/core';
import { formatSuggestion, lineCol } from './format.js';
import { harperRanges } from './harper.js';

const HELP = `margin: an AI second pass for Harper

Usage:
  margin check <file> [options]
  margin models [--base-url <url>]          find local servers (Ollama, LM Studio) and their models
  margin rewrite <file> --preset <${[...Object.keys(REWRITE_PRESETS), 'custom'].join('|')}> [--instruction "…"] [--lines a-b]

Options:
  --provider local|gemini   local = Ollama / LM Studio (text stays here; tested with Ollama and
                            gemma4:26b-a4b-it-qat). gemini = Google Gemini API (tested; sends text to Google).
                            Default: gemini if GEMINI_API_KEY is set, otherwise local.
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
      provider: { type: 'string' },
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
  try {
    process.loadEnvFile();
  } catch {
    // no .env here
  }
  if (command === 'models') return listModels(values['base-url']);
  if (values.help || !command || !file || !['check', 'rewrite'].includes(command)) {
    console.log(HELP);
    return values.help ? 0 : 2;
  }
  const dialect = values.dialect as Dialect;
  if (!DIALECTS.includes(dialect)) throw new Error(`unknown dialect "${values.dialect}"`);

  const model = makeModel(values.provider ?? (process.env.GEMINI_API_KEY ? 'gemini' : 'local'), values.model, values['base-url']);
  activeModel = model;
  const text = readFileSync(file, 'utf8');
  const language = values.plaintext ? 'plaintext' : 'markdown';

  const ctl = new AbortController();
  process.once('SIGINT', () => ctl.abort());

  if (command === 'check') {
    const existing = values['no-harper'] ? [] : await harperRanges(text, dialect, language);
    const started = performance.now();
    const r = await check({ text, model, dialect, language, existing, signal: ctl.signal, batch: { maxSentences: 8 }, concurrency: model.parallel });
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

async function listModels(baseURL: string | undefined): Promise<number> {
  const probes = await detectLocalServers({ urls: [...new Set([...(baseURL ? [baseURL] : []), ...DEFAULT_LOCAL_URLS])] });
  let found = false;
  for (const p of probes) {
    if (p.server) {
      found = true;
      console.log(`${p.server.kind} at ${p.server.baseURL}`);
      for (const m of p.server.models) console.log(`  ${m}${modelInfo('local', m)?.autoCheck ? '   (recommended)' : ''}`);
    } else {
      console.log(`${p.url}: ${p.problem}`);
    }
  }
  if (!found) console.log(`
${localSetupHelp('unreachable', undefined, 'linux')}`);
  return found ? 0 : 1;
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
    const advice = modelAdvice('local', m.modelId);
    console.error(`Using a local server (${m.id}); text stays on this machine. ${advice.note ?? ''}`);
    return m;
  }
  throw new Error(`unknown provider "${provider}"`);
}

let activeModel: MarginModel | undefined;

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`margin: ${activeModel ? explainError(error, activeModel) : error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
