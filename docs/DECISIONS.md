# Decisions

Newest first. Each entry: the decision, why, and what it changed.

## 2026-10-21: Local route first-class; browser extension

- Phoenix expects most users to run a local model. Local is now listed first everywhere, Margin detects Ollama / LM Studio and lists their models (`core/local.ts`), runs one call at a time for local GPUs (`MarginModel.parallel`), and explains local failures plainly (`core/errors.ts`). `margin models` lists what's installed.
- `gemma4:26b-a4b-it-qat` gets `autoCheck: true` because it has the same weights as the hosted model that passed the eval; it's still labelled "not yet tested" everywhere. Other local models get a one-time note that they haven't been evaluated and may over-correct (`modelAdvice`).
- Ollama refuses browser-extension origins by default (docs.ollama.com/faq): the browser options page detects the 403 and gives the OS-specific `OLLAMA_ORIGINS` command; LM Studio needs "Enable CORS". VS Code and the CLI aren't affected (Node sends no Origin).
- Ollama maps `reasoning_effort: "none"` to thinking off on its OpenAI-compatible API, which is what Margin sends.
- Browser: Harper's slim WASM ships as a file (20 MB) and loads by URL; the inlined build would be 27 MB of JS in a service worker. The extension builds against core's source so content scripts stay small (14 KB).

## 2026-10-21: Eval results and tuned defaults

- Hosted Gemma 4 26B A4B on 137 synthetic items: **precision 100%, recall 82.3%, 0 of 70 correct sentences changed** (two identical runs at batch 8). Report: `packages/eval/results/README.md`.
- Defaults: **batch 8, 2 calls in parallel** (VS Code engine and CLI). Batch 15 lost recall (82% → 69%); batch 4 was slower with no gain.
- The guard now rejects fixes that add or remove `[ ] < > | #` as well as `*`, `_`, `~` and backticks: the model occasionally leaked stray characters in big batches.
- Gemini's per-minute quota for Gemma is the practical limit; the VS Code engine's 30 s wait on 429 is the right behavior.
- `MODELS` registry: hosted Gemma 4 26B A4B gets `autoCheck: true`; the local model has the same weights but is `autoCheck: false` until someone evaluates the local path.

## 2026-10-21: Hosted-first, full scope, open-source starting point

- **Hosted Gemma 4 26B A4B (Gemini API, user's key) is the tested path** for development, tests, the eval and demos. Local (Ollama / LM Studio) is implemented but **untested**: Phoenix has limited bandwidth (multi-GB weights) and Margin is a showpiece first. The README says this plainly and invites local testers.
- This replaces "local-only v1" (earlier the same day). Consent before the first send, a "Where your text goes" section, and keys in secret stores come back. ai-sdk-quota stays out: one provider needs no pool.
- **Full scope, in order:** core + CLI → VS Code → rewrite/tone → eval → browser (Chrome + Firefox) → language server + Obsidian → release. PLAN.md rewritten around it (old plan: git `2a626d8`).
- **Weak models:** research (arXiv 2609.10810, 2506.13148) shows prompted models under ~9B over-correct noticeably (Qwen3-8B precision ~72% even with an optimized prompt). The model registry gets an `autoCheck` flag, set from eval results; models without it get on-demand checking only.
- **Browser dedup:** extensions can't read Harper's extension, so Margin's browser extension bundles harper.js for dedup only.

## 2026-10-21: Format spike results (hosted stand-ins)

No local model server yet (limited bandwidth), so the spike ran the **same open-weight models hosted by Google's Gemini API**: Gemma 4 26B A4B and Gemma 4 31B. 20 synthetic sentences (12 with errors), 3 runs per model and format. Raw data: `spike/format/results/2026-10-21.{json,md}`.

| model | format | parsed | errors fixed | exact wording | correct sentences changed | placeholder violations | p50 (hosted) |
|---|---|---|---|---|---|---|---|
| Gemma 4 26B A4B | A / B | 3/3 / 3/3 | 12/12 every run | 10/12 | 0 | 0 | ~9.5 s |
| Gemma 4 31B | A / B | 3/3 / 3/3 | 12/12 every run | 10/12 | 0 | 0 | ~40 s |

The two "inexact" fixes are acceptable: a comma splice fixed with `;` instead of `, so`, and a tense fix without adding the comma before "so" (comma style is Harper's job). The eval must score acceptable alternatives, not exact strings.

**Findings**
- **Gemma 4 thinks by default** on the Gemini API (245 hidden tokens for a 2-sentence prompt). On the full batch that used up `maxOutputTokens` and returned empty text. `thinkingConfig: { thinkingLevel: 'minimal' }` → 0 reasoning tokens (`thinkingBudget` is rejected for Gemma). Locally the same applies: thinking must be off for Gemma 4 in Ollama / LM Studio. **Verify the local switch** when a server is available.
- Gemma on the Gemini API rejects system instructions, so the spike folds the system prompt into the user prompt for it.
- An empty reply must count as a parse failure, not "no fixes" (the first run hid the thinking problem that way; parser fixed).
- OpenRouter's free Gemma 4 endpoints were "rate-limited upstream" for every call (Google capacity), so no data from there. The OpenRouter key is free tier (50 requests/day, no credit), so paid stand-ins (Qwen 3.5 9B, Qwen3 14B, gpt-oss-20b) couldn't run. The Groq key was rejected as invalid.
- Gemma 4 12B and E4B aren't hosted anywhere we have access to, so they're **untested**.

**Decisions (provisional until a local run)**
- **Format: A (structured output)** for local servers (Ollama and LM Studio enforce JSON schemas with constrained decoding). Keep the B parser as the fallback for models or servers without schema support. Both formats tied on quality here.
- **Default model on 16 GB: Gemma 4 26B A4B QAT** (`gemma4:26b-a4b-it-qat`), if it fits with a small context (about 14.4 GB of weights). Otherwise Gemma 4 12B QAT, which still needs measuring. 31B was no better and much slower.
- **Precision looks promising** (0 false positives on 8 clean sentences, including style and negation bait), but 20 synthetic sentences is a smoke test, not the Phase 4 eval.

## 2026-10-21: Phase 0

### Answers to PLAN §11 (from Phoenix)

- **Name:** "Margin" remains the working name.
- **Dev OS:** both. Windows day to day (Ollama uses Vulkan on the RX 9070 XT); Linux to measure ROCm vs Vulkan.
- **Default trigger:** `idle` (2 s).
- **Licence:** MIT (`LICENSE`).
- **ai-sdk-quota:** Phoenix publishes it to npm on 2026-10-22. Until then Margin installs a `pnpm pack` tarball (`vendor/`, gitignored), then switches to the npm version. `docs/UPSTREAM.md` was written first so its gaps can be considered before the release.

### Scope: match Harper's integrations

Margin aims to run wherever Harper runs. The integration-by-integration mapping is in `HARPER-NOTES.md`. The language server covers Neovim, Helix, Emacs, Sublime and (with a small extension) Zed. VS Code and Obsidian get their own adapters. Chrome/Firefox (which also covers WordPress) is a new **Phase 7**, after VS Code and the Phase 4 eval. Harper Desktop is out of scope for now. PLAN §9 updated.

### Node ≥ 22, not ≥ 20

AI SDK 7 requires Node 22+. CLAUDE.md and the root `package.json` updated. VS Code's Electron Node version must be checked in Phase 2 (it matters for `node:sqlite`, see UPSTREAM #2).

### Repo layout fixes

`PLAN.md` moved to `docs/PLAN.md` (where CLAUDE.md points). Sibling repos are two levels up: `../../harper`, `../../ai-sdk-quota`; CLAUDE.md and PLAN.md updated.

### harper.js facts that change the plan

- Spans from harper.js are **UTF-16**, not scalar values as Harper's docs say (tested). No offset conversion is needed for dedup.
- Node code must import `harper.js/binaryInlined`: `harper.js/binary` can't find its `.wasm` on Windows.
- No `contextHash()` / `setDialect()` in 2.13.0; the dialect is set when constructing the linter.
- VS Code dedup filters diagnostics by `source === 'Harper'` from extension `elijah-potter.harper`.

### ai-sdk-quota facts that change the plan

- A local member is declared by omitting `limits`. PLAN §6.1 sketch updated.
- Member order is priority order. PLAN §6.3 confirmed.
- Margin passes `require: ['json']` itself on structured-output calls and tags members with `capabilities: { json: false }` where needed (the pool doesn't infer it; UPSTREAM #4).
- Margin never calls the pool with an already-aborted signal and always sets `maxOutputTokens`, because aborted calls are charged their estimate (UPSTREAM #1).
- A persistent store across windows is needed by Phase 3: SQLite via `node:sqlite` on `createScriptedStore`, upstream if Phoenix agrees (UPSTREAM #2), otherwise in Margin.

### Pending (Phase 0 not finished)

- Format and default model: decided provisionally above (2026-10-21 spike). A local confirmation run is still pending.
