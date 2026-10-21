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
writeFileSync(
  'dist/manifest.json',
  `${JSON.stringify(
    {
      id: 'margin',
      name: 'Margin',
      version: pkg.version,
      minAppVersion: '1.11.4',
      description: "An AI second pass for Harper: catches what rules can't, rewrites on request. Local model or Gemini.",
      author: 'Ahmed Khaled',
      isDesktopOnly: false,
    },
    null,
    2,
  )}\n`,
);
copyFileSync('styles.css', 'dist/styles.css');
console.log('built dist/main.js');
