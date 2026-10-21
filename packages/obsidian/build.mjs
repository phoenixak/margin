import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  // Obsidian provides these at runtime (the same list as its sample plugin).
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules, 'fs'],
  // Build from core's source modules so only what's used is bundled.
  alias: { '@margin/core': resolve('../core/src/index.ts') },
  logLevel: 'warning',
});
const manifest = `${JSON.stringify(
  {
    // "Margin" alone is taken in Obsidian's plugin list.
    id: 'margin-ai-proofreader',
    name: 'Margin Proofreader',
    version: pkg.version,
    minAppVersion: '1.11.4',
    description: "An AI second pass after Harper: catches what grammar rules can't and rewrites on request. Local model or Gemini.",
    author: 'Ahmed Khaled',
    authorUrl: 'https://github.com/phoenixak',
    fundingUrl: { 'GitHub Sponsors': 'https://github.com/sponsors/phoenixak', 'Ko-fi': 'https://ko-fi.com/phoenixak' },
    isDesktopOnly: true, // not tested on mobile yet
  },
  null,
  2,
)}\n`;
writeFileSync('dist/manifest.json', manifest);
// The standalone repo (phoenixak/margin-obsidian) carries manifest.json at its root;
// this monorepo must not, or Obsidian's directory ties the plugin id to it.
copyFileSync('styles.css', 'dist/styles.css');
console.log('built dist/main.js');
