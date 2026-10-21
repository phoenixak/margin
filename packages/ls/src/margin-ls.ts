#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CacheStorage, Dialect, Range } from '@margin/core';
import { Dialect as HarperDialect, LocalLinter } from 'harper.js';
// `harper.js/binary` can't find its .wasm on Windows; the inlined binary avoids the file read.
import { binaryInlined } from 'harper.js/binaryInlined';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { startServer } from './server.js';

if (process.argv.includes('--version')) {
  console.log('margin-ls 0.0.1');
  process.exit(0);
}

/** Per-user state: XDG on Linux/macOS, %LOCALAPPDATA% on Windows. Holds only hashes (no text). */
const dir =
  process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'margin')
    : join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'margin');

const file = (name: string): CacheStorage => ({
  read: async () => {
    try {
      return readFileSync(join(dir, name), 'utf8');
    } catch {
      return undefined;
    }
  },
  write: async (data) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), data);
  },
});

let linter: { dialect: Dialect; linter: LocalLinter } | undefined;
async function harperRanges(text: string, dialect: Dialect, language: 'markdown' | 'plaintext'): Promise<Range[]> {
  try {
    if (linter?.dialect !== dialect) {
      await linter?.linter.dispose();
      linter = { dialect, linter: new LocalLinter({ binary: binaryInlined, dialect: HarperDialect[dialect] }) };
    }
    return (await linter.linter.lint(text, { language })).map((l) => {
      const span = l.span();
      return { start: span.start, end: span.end };
    });
  } catch {
    linter = undefined;
    return []; // dedup is best-effort
  }
}

startServer(createConnection(ProposedFeatures.all), {
  harperRanges,
  storage: { cache: file('check-cache.json'), ignored: file('ignored.json') },
});
