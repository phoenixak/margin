# Margin

An AI second pass for Harper. Harper's fast, local, rule-based checks run first. An LLM then handles only what rules can't catch: agreement across clauses, tense, real-but-wrong words, run-ons, sentences that don't parse. It also does rewrite and tone on demand. Margin is an optional companion to Harper and an open-source starting point. **Tested: Gemma 4 26B A4B, hosted through the Gemini API (user's own key) and local on Ollama.** The editor and browser adapters with a local model are still being tested, and the docs say exactly what was run.

"Margin" is a working name. Never put "Harper" in the product name; Harper is Automattic's project.

**Read `docs/PLAN.md` before starting any phase.** It contains the research, the design decisions with their reasons, and the roadmap with acceptance criteria.

## Sibling repos

| Path | What | Rules |
|---|---|---|
| `../../harper` (`D:/Projects/harper`) | Automattic/harper, cloned for reference | Read only. Use it to learn harper.js, harper-ls and the VS Code and Obsidian integrations. Don't modify it, vendor it, or copy code out of it. Depend on the published `harper.js` package. |
| `../../ai-sdk-quota` (`D:/Projects/ai-sdk-quota`) | Phoenix's library | **Not used** (one hosted provider needs no pool). Don't edit it from this repo; library gaps go in `docs/UPSTREAM.md`. |

Adjust these paths if the repos live elsewhere.

## Non-negotiables

1. **Consent before sending.** Nothing is sent anywhere until the user picks a provider. Picking Gemini shows where text goes (Google; the free tier may use it to improve products). excludeGlobs and untrusted workspaces are never sent.
2. **No document text in logs, telemetry or committed fixtures.** Log hashes, lengths, model ids and timings instead. Margin has no telemetry.
3. **Keys live only in the platform's secret store**: VS Code `context.secrets`, Obsidian `app.secretStorage`; in the browser `chrome.storage.local`, documented as unencrypted. Never in settings, code, logs or committed files (`spike/.env` and other `.env` files are gitignored).
4. **Minimal edits.** Check mode fixes errors and never polishes correct text. Every check-mode fix passes the over-edit guard (PLAN §3.3).
5. **Models never produce offsets.** They return corrected sentences by id. Ranges come from a local word diff (PLAN §3.2).
6. **Never block typing.** LLM work is debounced, cancellable with AbortSignal, and concurrency-limited. Results are dropped if the text changed underneath.
7. **Harper owns mechanical errors.** Suppress LLM edits that overlap a Harper lint, and don't render Harper's lints ourselves.
8. **Model is injected.** `core` takes an AI SDK `LanguageModel` plus a provider profile; adapters build it with `createModel()`.
9. **Companion to Harper.** Margin requires Harper (VS Code: `extensionDependencies`), uses Harper's dialect, and never duplicates Harper's lints.
10. **Honesty.** Never claim something works that wasn't tested. The README's "What's tested" section must match reality (today: hosted Gemma 4 26B A4B in VS Code, Chrome, Firefox; local Gemma 4 26B A4B in the CLI and evals).

## Verify before trusting

PLAN.md was researched on 2026-10-21, and package APIs, model ids and free-tier limits drift. Before relying on a specific name or number, confirm it in the installed package's types (`node_modules/**/*.d.ts`) or `../../harper`. If reality differs from the plan, follow reality, fix PLAN.md, and log the change in `docs/DECISIONS.md`. Items marked **(verify)** in the plan are known to be uncertain.

## Stack

- TypeScript (strict), Node ≥ 22 (AI SDK 7 requires it), pnpm workspaces.
- `ai@^7` (AI SDK 7) with `@ai-sdk/google` (Gemini API, tested) and `@ai-sdk/openai-compatible` (Ollama / LM Studio, untested).
- `harper.js`: `LocalLinter` with `harper.js/binaryInlined` in Node (`WorkerLinter` doesn't work in Node; `harper.js/binary` breaks on Windows).
- `zod`, `diff` (jsdiff), `vitest`, `tsup` for libraries, `esbuild` for the VS Code bundle (CJS output).
- Ask before adding any other runtime dependency.

## Layout

```
packages/core      editor-agnostic pipeline + createModel() (no vscode/browser/obsidian imports)
packages/cli       `margin check <file>` / `margin rewrite` for development and eval
packages/vscode    VS Code extension (first adapter)
packages/eval      fixtures + runner (dev only, never shipped)
packages/browser   Chrome + Firefox MV3 extension
packages/ls        language server (Neovim, Helix, Emacs, Sublime, Zed)
packages/obsidian  Obsidian plugin
spike/             Phase 0 spikes (dev only)
docs/              PLAN.md, DECISIONS.md, HARPER-NOTES.md (+ QUOTA-NOTES.md, UPSTREAM.md for ai-sdk-quota)
```

`core` receives its environment through injected interfaces (fetch, secrets, storage, clock, logger). That lets the same code run in the extension host, a browser service worker, a language server, Obsidian and tests.

## Commands

```
pnpm install
pnpm build                   # core, then cli
pnpm test                    # unit tests: mock models only, no network
pnpm typecheck
node packages/cli/dist/cli.js check fixtures/sample.md   # real model: GEMINI_API_KEY in ./.env (synthetic text only)
```

## How to work

- Work one phase at a time from PLAN.md §8. Start each phase by writing a short plan for it (files, tests, risks), and wait for Phoenix's OK on anything marked **ask**.
- Write tests first for pure logic: the segmenter, masker, diff-to-ranges, guards, parsers and staleness check.
- Unit tests use mock models and never touch the network. A test `fetch` that throws enforces this.
- Real-provider runs use synthetic or public-domain text only, never Phoenix's own documents.
- A phase is finished when tests are green, PLAN.md checkboxes are updated, and any deviations are logged in DECISIONS.md.
- Stop and ask before any of these: adding a dependency, adding a provider, changing what is sent where, publishing, or editing ai-sdk-quota.
- Make small commits with imperative messages.
