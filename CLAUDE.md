# Margin

An AI second pass for Harper. Harper's fast, local, rule-based checks run first. An LLM then handles only what rules can't catch: agreement across clauses, tense, real-but-wrong words, run-ons, sentences that don't parse. It also does rewrites on demand. Model calls go through **ai-sdk-quota**, so a pool of local models, free tiers and the user's own keys works without hitting 429s. Margin is local-first and private by default.

"Margin" is a working name. Never put "Harper" in the product name; Harper is Automattic's project.

**Read `docs/PLAN.md` before starting any phase.** It contains the research, the design decisions with their reasons, and the roadmap with acceptance criteria.

## Sibling repos

| Path | What | Rules |
|---|---|---|
| `../../harper` (`D:/Projects/harper`) | Automattic/harper, cloned for reference | Read only. Use it to learn harper.js, harper-ls and the VS Code and Obsidian integrations. Don't modify it, vendor it, or copy code out of it. Depend on the published `harper.js` package. |
| `../../ai-sdk-quota` (`D:/Projects/ai-sdk-quota`) | Phoenix's library (unpublished) | Use it, but don't edit it from this repo. When Margin needs something the library lacks, add an entry to `docs/UPSTREAM.md` (the need, why, an API sketch, and a test that would prove it), then work around the gap in Margin. |

Adjust these paths if the repos live elsewhere.

## Non-negotiables

1. **Local-only by default.** The default privacy mode sends nothing off the machine. Text goes to a pool member tagged `may-train` only in a mode the user explicitly chose.
2. **No document text in logs, telemetry or committed fixtures.** Log hashes, lengths, member ids and timings instead. Margin has no telemetry.
3. **Keys live only in the editor's secret store**: VS Code `context.secrets`, Obsidian `app.secretStorage`. Never put them in settings, data.json, code, logs or committed files.
4. **Minimal edits.** Check mode fixes errors and never polishes correct text. Every check-mode fix passes the over-edit guard (PLAN §5.4).
5. **Models never produce offsets.** They return corrected sentences by id. Ranges come from a local word diff (PLAN §5.2).
6. **Never block typing.** LLM work is debounced, cancellable with AbortSignal, and concurrency-limited. Results are dropped if the text changed underneath.
7. **Harper owns mechanical errors.** Suppress LLM edits that overlap a Harper lint, and don't render Harper's lints ourselves.
8. **Let the pool retry.** Every AI SDK call through the pool sets `maxRetries: 0`.
9. **Follow providers' rules.** One key per provider account. No key rotation or multi-account features (same policy as ai-sdk-quota).

## Verify before trusting

PLAN.md was researched on 2026-10-21, and package APIs, model ids and free-tier limits drift. Before relying on a specific name or number, confirm it in one of three places: the installed package's types (`node_modules/**/*.d.ts`), `../harper`, or `../ai-sdk-quota`. If reality differs from the plan, follow reality, fix PLAN.md, and log the change in `docs/DECISIONS.md`. Items marked **(verify)** in the plan are known to be uncertain.

## Stack

- TypeScript (strict), Node ≥ 22 (AI SDK 7 requires it), pnpm workspaces.
- `ai@^7` (AI SDK 7) with these providers:
  - `@ai-sdk/openai-compatible` for Ollama and LM Studio
  - `@ai-sdk/groq`
  - `@ai-sdk/google`
  - `@openrouter/ai-sdk-provider`, latest major (the 2.9.x line is for AI SDK 6)
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
- Stop and ask before any of these: editing ai-sdk-quota, adding a dependency, changing a privacy default, publishing, or sending real document text to a cloud provider.
- Make small commits with imperative messages.
