# Building the Margin browser extension

These steps reproduce the uploaded add-on exactly (the files in `packages/browser/dist/firefox`, without `.map` files).

## Environment

- Any OS: built and tested on Windows 11; also works on Linux and macOS.
- **Node.js 22 or later** (tested with 24.19). Install from https://nodejs.org.
- **pnpm 10** (tested with 10.34). Install with `npm install -g pnpm@10` or `corepack enable && corepack prepare pnpm@10 --activate`.

All other build tools (esbuild, TypeScript) are pinned in `pnpm-lock.yaml` and installed by `pnpm install`.

## Steps

From the root of the source package:

```sh
pnpm install --frozen-lockfile
pnpm -F @margin/browser build
```

`pnpm -F @margin/browser build` runs `packages/browser/build.mjs`, which:

1. bundles `packages/browser/src/{background,content,options,popup}.ts` and the parts of `packages/core/src` they import with esbuild (minified IIFE, target `firefox140`);
2. copies `static/options.html`, `static/popup.html`, `static/ui.css` and `static/icons/*`;
3. copies `harper_wasm_slim_bg.wasm` unmodified from the `harper.js` npm package (Apache-2.0, https://github.com/Automattic/harper);
4. writes `manifest.json`.

The result is in `packages/browser/dist/firefox`.

## Third-party code

The bundle includes open-source libraries from npm, unmodified: `ai`, `@ai-sdk/*` (Vercel AI SDK, Apache-2.0), `zod` (MIT), `diff` (BSD-3-Clause) and `harper.js` (Apache-2.0).
