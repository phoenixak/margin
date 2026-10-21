# Margin

An AI second pass for Harper. Harper's fast, local, rule-based checks run first. An LLM then handles only what rules can't catch: agreement across clauses, tense, real-but-wrong words, run-ons, sentences that don't parse. It also does rewrites on demand. Margin is an optional companion to Harper, and v1 is **local models only** (Ollama or LM Studio): no cloud providers, no API keys, nothing leaves the machine.

"Margin" is a working name. Never put "Harper" in the product name; Harper is Automattic's project.

**Read `docs/PLAN.md` before starting any phase.** It contains the research, the design decisions with their reasons, and the roadmap with acceptance criteria.

## Sibling repos

| Path | What | Rules |
|---|---|---|
| `../../harper` (`D:/Projects/harper`) | Automattic/harper, cloned for reference | Read only. Use it to learn harper.js, harper-ls and the VS Code and Obsidian integrations. Don't modify it, vendor it, or copy code out of it. Depend on the published `harper.js` package. |
| `../../ai-sdk-quota` (`D:/Projects/ai-sdk-quota`) | Phoenix's library | **Not used in v1** (local-only). Kept for a possible later cloud tier. Don't edit it from this repo; library gaps go in `docs/UPSTREAM.md`. |

Adjust these paths if the repos live elsewhere.

## Non-negotiables

1. **Local only.** v1 talks only to a model server on localhost. Nothing leaves the machine; a test `fetch` enforces it.
2. **No document text in logs, telemetry or committed fixtures.** Log hashes, lengths, member ids and timings instead. Margin has no telemetry.
3. **No cloud, no keys in v1.** Adding any non-local provider is a scope change: ask first.
4. **Minimal edits.** Check mode fixes errors and never polishes correct text. Every check-mode fix passes the over-edit guard (PLAN §5.4).
5. **Models never produce offsets.** They return corrected sentences by id. Ranges come from a local word diff (PLAN §5.2).
6. **Never block typing.** LLM work is debounced, cancellable with AbortSignal, and concurrency-limited. Results are dropped if the text changed underneath.
7. **Harper owns mechanical errors.** Suppress LLM edits that overlap a Harper lint, and don't render Harper's lints ourselves.
8. **Model is injected.** `core` takes an AI SDK `LanguageModel`; it never constructs providers itself, so a cloud tier or ai-sdk-quota pool can plug in later.
9. **Companion to Harper.** Margin requires Harper (VS Code: `extensionDependencies`), uses Harper's dialect, and never duplicates Harper's lints.

## Verify before trusting

PLAN.md was researched on 2026-10-21, and package APIs, model ids and free-tier limits drift. Before relying on a specific name or number, confirm it in the installed package's types (`node_modules/**/*.d.ts`) or `../../harper`. If reality differs from the plan, follow reality, fix PLAN.md, and log the change in `docs/DECISIONS.md`. Items marked **(verify)** in the plan are known to be uncertain.

## Stack

- TypeScript (strict), Node ≥ 22 (AI SDK 7 requires it), pnpm workspaces.
- `ai@^7` (AI SDK 7) with `@ai-sdk/openai-compatible` for Ollama and LM Studio. (Cloud providers are out of scope for v1.)
- `harper.js`: use `LocalLinter` in Node, since `WorkerLinter` doesn't work in Node.
- `zod`, `diff` (jsdiff), `vitest`, `tsup` for libraries, `esbuild` for the VS Code bundle (CJS output).
- Ask before adding any other runtime dependency.

## Layout

```
packages/core      editor-agnostic pipeline + pool factory (no vscode/obsidian imports)
packages/cli       `margin check <file>` for development and eval
packages/vscode    VS Code extension (first adapter)
packages/eval      fixtures + runner (dev only, never shipped)
packages/ls        later: language server (Neovim, Helix, Zed)
packages/obsidian  later: Obsidian plugin
docs/              PLAN.md, DECISIONS.md, UPSTREAM.md, QUOTA-NOTES.md, HARPER-NOTES.md
```

`core` receives its environment through injected interfaces (fetch, secrets, storage, clock, logger). That lets the same code run in the extension host, a language server, Obsidian and tests.

## Commands

Fill these in during Phase 1 and keep them current.

```
pnpm install
pnpm -r build
pnpm -r test                 # unit tests: mock models only, no network
pnpm -F @margin/eval eval    # real models: needs a local server and/or keys in env
```

## How to work

- Work one phase at a time from PLAN.md §9. Start each phase by writing a short plan for it (files, tests, risks), and wait for Phoenix's OK on anything marked **ask**.
- Write tests first for pure logic: the segmenter, masker, diff-to-ranges, guards, parsers and staleness check.
- Unit tests use mock models and never touch the network. A test `fetch` that throws on any non-localhost URL enforces this.
- Real-provider runs use synthetic or public-domain text only, never Phoenix's own documents.
- A phase is finished when tests are green, PLAN.md checkboxes are updated, and any deviations are logged in DECISIONS.md.
- Stop and ask before any of these: adding a dependency, adding a non-local provider, publishing, or editing ai-sdk-quota.
- Make small commits with imperative messages.
