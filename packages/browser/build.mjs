import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const harperDist = dirname(fileURLToPath(import.meta.resolve('harper.js')));

const base = {
  manifest_version: 3,
  name: 'Margin: AI second pass for Harper',
  short_name: 'Margin',
  version: pkg.version,
  description: "Catches what Harper's rules can't, in web text fields. Local model (Ollama, LM Studio) or Gemini. Not affiliated with Harper.",
  permissions: ['storage', 'contextMenus', 'scripting', 'activeTab'],
  // Local servers (any port) and the Gemini API. Sites are optional and asked for one at a time.
  host_permissions: ['http://localhost/*', 'http://127.0.0.1/*', 'https://generativelanguage.googleapis.com/*'],
  optional_host_permissions: ['https://*/*', 'http://*/*'],
  action: { default_popup: 'popup.html', default_title: 'Margin' },
  options_ui: { page: 'options.html', open_in_tab: true },
  // Harper's WASM needs wasm-unsafe-eval; nothing else is loaded from outside the extension.
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
};

const targets = {
  chrome: { ...base, background: { service_worker: 'background.js' }, minimum_chrome_version: '120' },
  firefox: {
    ...base,
    background: { scripts: ['background.js'] },
    browser_specific_settings: { gecko: { id: 'margin@phoenixak.dev', strict_min_version: '128.0' } },
  },
};

for (const [name, manifest] of Object.entries(targets)) {
  const out = join('dist', name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: { background: 'src/background.ts', content: 'src/content.ts', options: 'src/options.ts', popup: 'src/popup.ts' },
    outdir: out,
    bundle: true,
    format: 'iife',
    target: name === 'chrome' ? 'chrome120' : 'firefox128',
    minify: true,
    legalComments: 'linked',
    // harper.js reads its .wasm with `fs` only under Node; browsers load it by URL.
    external: ['fs'],
    // Build from core's source modules so content/options/popup only pull in what they use.
    alias: { '@margin/core': resolve('../core/src/index.ts') },
    logLevel: 'warning',
  });
  for (const f of ['options.html', 'popup.html', 'ui.css']) copyFileSync(join('static', f), join(out, f));
  copyFileSync(join(harperDist, 'harper_wasm_slim_bg.wasm'), join(out, 'harper_wasm_slim_bg.wasm'));
  copyFileSync('../../LICENSE', join(out, 'LICENSE'));
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`built ${out}`);
}
