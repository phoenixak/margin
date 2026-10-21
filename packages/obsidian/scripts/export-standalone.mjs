// Exports the Obsidian plugin as a standalone repository (phoenixak/margin-obsidian).
//
//   node packages/obsidian/scripts/export-standalone.mjs [target-dir]
//
// Obsidian's community directory scans the whole repository it's pointed at and installs
// its dependencies with npm. This monorepo has a browser extension, a CLI and pnpm
// workspace links, so the plugin is published from a generated repo that contains only
// the plugin and the core code it uses. Edit here (packages/obsidian, packages/core),
// never in the generated repo.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = resolve(here, '..');
const core = resolve(plugin, '../core');
const root = resolve(plugin, '../..');
const target = resolve(process.argv[2] ?? resolve(root, '../margin-obsidian'));
const pkg = JSON.parse(readFileSync(join(plugin, 'package.json'), 'utf8'));
const corePkg = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));

// Keep the generated repo's git history, installed modules and lockfile.
mkdirSync(target, { recursive: true });
for (const entry of readdirSync(target)) {
  if (['.git', 'node_modules', 'package-lock.json'].includes(entry)) continue;
  rmSync(join(target, entry), { recursive: true, force: true });
}

// Sources: the plugin in src/, core in src/core/ with imports rewritten.
cpSync(join(core, 'src'), join(target, 'src/core'), { recursive: true });
for (const f of readdirSync(join(plugin, 'src'))) {
  const text = readFileSync(join(plugin, 'src', f), 'utf8').replaceAll("from '@margin/core'", "from './core/index.js'");
  writeFileSync(join(target, 'src', f), text);
}

const pin = (deps) => Object.fromEntries(Object.entries(deps).map(([k, v]) => [k, v.replace(/^\^/, '')]));
// npm enforces obsidian's exact CodeMirror peers (pnpm let the monorepo drift); use them.
const obsidianPeers = JSON.parse(readFileSync(join(plugin, 'node_modules/obsidian/package.json'), 'utf8')).peerDependencies ?? {};
writeFileSync(
  join(target, 'package.json'),
  `${JSON.stringify(
    {
      name: 'margin-obsidian',
      version: pkg.version,
      private: true,
      description: 'Margin Proofreader for Obsidian: an AI second pass after Harper. Generated from github.com/phoenixak/margin.',
      license: 'MIT',
      type: 'module',
      scripts: { build: 'node build.mjs', typecheck: 'tsc --noEmit' },
      // Everything is bundled into main.js; Obsidian provides obsidian and @codemirror/* at runtime.
      devDependencies: {
        ...pin(corePkg.dependencies),
        '@ai-sdk/provider': '4.0.31',
        ...pin(Object.fromEntries(Object.entries(pkg.devDependencies).filter(([k]) => k !== 'vitest'))),
        ...pin(Object.fromEntries(Object.entries(obsidianPeers).filter(([k]) => k.startsWith('@codemirror/')))),
      },
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  join(target, 'tsconfig.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'es2022',
        lib: ['es2024', 'dom'],
        module: 'esnext',
        moduleResolution: 'bundler',
        strict: true,
        noUncheckedIndexedAccess: true,
        verbatimModuleSyntax: true,
        isolatedModules: true,
        skipLibCheck: true,
        noEmit: true,
        types: ['node'],
      },
      include: ['src'],
    },
    null,
    2,
  )}\n`,
);

// The build script: the monorepo's, minus the alias to core's source.
const build = readFileSync(join(plugin, 'build.mjs'), 'utf8')
  .replace(/\s*\/\/ Build from core's source modules[^\n]*\n\s*alias: \{[^}]*\},\n/, '\n')
  .replace("writeFileSync('../../manifest.json', manifest);", "writeFileSync('manifest.json', manifest);")
  .replace("// Obsidian's community list reads manifest.json from the repository root.", "// The directory reads manifest.json from the repository root.")
  .replace(/^import \{ resolve \} from 'node:path';\n/m, '');
if (build.includes('alias:')) throw new Error('export: could not remove the core alias from build.mjs');
writeFileSync(join(target, 'build.mjs'), build);

for (const f of ['styles.css', 'RELEASE_NOTES.md']) cpSync(join(plugin, f), join(target, f));
cpSync(join(root, 'LICENSE'), join(target, 'LICENSE'));
writeFileSync(join(target, '.gitignore'), 'node_modules/\ndist/\n');
writeFileSync(join(target, 'versions.json'), `${JSON.stringify({ [pkg.version]: '1.11.4' }, null, 2)}\n`);

const readme = readFileSync(join(plugin, 'README.md'), 'utf8').replace(
  /## Install \(from source, for now\)[\s\S]*?(?=## Where your text goes)/,
  `## Install

From Obsidian: Settings → Community plugins → Browse → search "Margin Proofreader". Also install **Harper**.

Manual: download \`main.js\`, \`manifest.json\` and \`styles.css\` from the latest release into \`<vault>/.obsidian/plugins/margin-proofreader/\`.

`,
);
writeFileSync(
  join(target, 'README.md'),
  `${readme.trim()}\n\n## Source\n\nThis repository is generated from [phoenixak/margin](https://github.com/phoenixak/margin) (\`packages/obsidian\` and \`packages/core\`), which also has the VS Code extension, browser extension and language server. Please open issues and pull requests there.\n\nBuild: Node 22+, then \`npm ci && npm run build\`; the plugin files are in \`dist/\`. Releases are built by GitHub Actions with signed build provenance.\n`,
);

mkdirSync(join(target, '.github/workflows'), { recursive: true });
writeFileSync(
  join(target, '.github/workflows/release.yml'),
  readFileSync(join(here, 'standalone-release.yml'), 'utf8'),
);

// The manifest at the root (the directory reads it at HEAD of the default branch).
const manifest = readFileSync(join(plugin, 'dist/manifest.json'), 'utf8');
writeFileSync(join(target, 'manifest.json'), manifest);

const count = (dir) => readdirSync(dir).reduce((n, f) => n + (statSync(join(dir, f)).isDirectory() ? count(join(dir, f)) : 1), 0);
console.log(`exported margin-obsidian ${pkg.version} to ${target} (${count(join(target, 'src'))} source files)`);
if (!existsSync(join(target, 'package-lock.json'))) console.log('next: run `npm install` there to create package-lock.json');
