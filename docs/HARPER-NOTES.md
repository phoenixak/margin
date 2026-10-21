# Harper notes

Phase 0, 2026-10-21. Sources: `harper.js@2.13.0` as installed (`spike/node_modules/harper.js/dist/index.d.ts`) and `../../harper` at `da30e5c` (2026-10-21). Tests: `spike/harper/spans.test.ts`.

## harper.js API (2.13.0)

- Packages export `.` plus four binaries: `harper.js/binary`, `/slimBinary`, `/binaryInlined`, `/slimBinaryInlined`. The PLAN's `harper.js/slimBinary` exists.
- `LocalLinter` (same thread; use in Node) and `WorkerLinter` (Web Worker; not in Node). Both implement `Linter`:
  - `setup()`, `lint(text, options?) → Lint[]`, `organizedLints(text, options?) → Record<ruleName, Lint[]>`
  - `applySuggestion(text, lint, suggestion)`, `ignoreLint(source, lint)`, `ignoreLints`, `ignoreLintHash(bigint)`
  - `isLikelyEnglish(text)`, `isolateEnglish(text)`
  - `getLintConfig / setLintConfig / getDefaultLintConfig`, `getLintDescriptions`, `dispose()`
  - The PLAN mentioned `contextHash()` and `setDialect()`. Neither is on the `Linter` interface in 2.13.0: the dialect is set through the constructor (`new LocalLinter({ binary, dialect })`).
- `LintOptions`: `language?: 'plaintext' | 'markdown' | 'typst'` (default markdown), `regex_mask?: string`, `forceAllHeadings`, `dedup` (default true), `isolateEnglish`.
- `Lint`: `span()`, `get_problem_text()`, `lint_kind()`, `message()`, `suggestions()`, `suggestion_count()`.
- `LintKind`: Agreement, BoundaryError, Capitalization, Eggcorn, Enhancement, Formatting, Grammar, Malapropism, Miscellaneous, Nonstandard, Punctuation, Readability, Redundancy, Regionalism, Repetition, Spelling, Style, Typo, Usage, WordChoice, WordOrder.

### Dialect enum

`American = 0, British = 1, Australian = 2, Canadian = 3, Indian = 4`. Margin's `dialect` setting maps 1:1 to these and to the prompt's `{dialect} English`.

## Span units: UTF-16 (tested)

Harper's docs (`docs/harperjs/spans`) say spans index **Unicode scalar values**. That's true in Rust, but **harper.js returns UTF-16 code units**. With `'😀😀 This is a example.'` the lint on `a` starts at 13 (the JS `indexOf` position), not 11 (the scalar index). CJK and combining marks agree, since they are 1 UTF-16 unit each.

So harper.js spans can be compared with Margin's `Offset` (UTF-16) directly, with no conversion. The test pins this, so a future harper.js change will fail loudly.

harper-ls spans are Rust scalar indices converted to LSP positions by `span_to_range` (`harper-ls/src/diagnostics.rs`). VS Code receives normal `Range`s, so the VS Code adapter never sees raw spans.

## Bug: `harper.js/binary` on Windows

`BinaryModule` reads the wasm with `fs.readFile(new URL(binary).pathname)`. On Windows that path is `/D:/…`, which Node resolves as `D:\D:\…` → `ENOENT`. Fix upstream would be `fileURLToPath`. **Workaround:** use `harper.js/binaryInlined` (or `slimBinaryInlined`) in Node, as the spike test does. The CLI and eval must do the same. Worth a Harper issue (outside this repo; Phoenix's call).

## VS Code extension

- Extension id **`elijah-potter.harper`** (`packages/vscode-plugin/package.json`: publisher `elijah-potter`, name `harper`).
- It bundles a per-platform `harper-ls` binary (`harper-ls.exe` on Windows) and starts it over **stdio** with `vscode-languageclient`. Settings are passed through under the `harper` configuration section.
- Diagnostics: `source: "Harper"`, `code: <rule name>` (`harper-ls/src/diagnostics.rs:133–134`). Margin filters `getDiagnostics(uri)` by `source === 'Harper'`, and can use `code` for finer dedup.

## Obsidian plugin

`packages/obsidian-plugin/src/State.ts` uses `slimBinaryInlined` (the WASM is inlined, so no file or URL loading). `WorkerLinter` by default, with a `useWebWorker` setting that switches to `LocalLinter`. Margin's Obsidian plugin should use the same binary.

## Where Harper runs, and how Margin covers it

From `packages/web/src/routes/docs/integrations/` plus the repo layout:

| Harper integration | How Harper does it | Margin adapter | Phase |
|---|---|---|---|
| VS Code (and forks: VSCodium, Windsurf; Open VSX) | own extension wrapping harper-ls | `packages/vscode` | 2–3 |
| Neovim, Helix, Emacs (Eglot), Sublime Text (LSP package) | `harper-ls` | `packages/ls` (margin-ls); config docs per editor | 5 |
| Zed | Zed extension that downloads harper-ls | margin-ls + a small Zed extension | 5 |
| Obsidian | own plugin, harper.js in-process | `packages/obsidian` | 5 |
| Chrome + Firefox | one MV3 extension (`packages/chrome-plugin`, gecko settings for Firefox); highlights via `packages/lint-framework`; a Google Docs bridge | `packages/browser` | 7 (later) |
| WordPress | plugin, now superseded by the Chrome extension per Harper's own docs | covered by the browser extension | 7 |
| Harper Desktop (Tauri) | offline Markdown editor, "documentation incomplete" | out of scope until it's a real product | — |
| git commit / jj descriptions, comments in code | harper-ls parsers | margin-ls, once PLAN Phase 6 "code comments and commit messages" lands | 6+ |

Browser notes for later: Harper's extension does all work offline in the background worker; its CSP allows `wasm-unsafe-eval` and only `writewithharper.com` for network. `lint-framework` is Apache-2.0, unpublished on npm at 0.0.1 (`private: false`). If it's published by then, depend on it; don't copy it.
