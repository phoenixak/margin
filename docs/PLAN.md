# Margin: plan

Rewritten 2026-10-21 after Phase 0. The research behind it is in `HARPER-NOTES.md` and `DECISIONS.md`. The earlier, pool-based plan (ai-sdk-quota, free-tier routing, privacy modes) is in git history (`2a626d8`) and `QUOTA-NOTES.md` / `UPSTREAM.md`.

## 0. What Margin is

An **optional AI companion to Harper**. Harper's rule-based checks stay in charge of spelling, capitalization and mechanical grammar. Margin adds a second pass, using an LLM, for what rules can't catch: agreement across clauses, tense, real-but-wrong words, missing or repeated words, run-ons and comma splices. It also offers **rewrite and tone** on demand.

It's an open-source starting point, built honestly:

- **Tested path: hosted Gemma 4 26B A4B through the Gemini API**, with the user's own key. Development, tests, the eval and demos all use it.
- **Local path (Ollama / LM Studio): implemented, not tested by us.** The author had no bandwidth to download multi-GB weights. The same open model (`gemma4:26b-a4b-it-qat`) should behave the same locally; the README says so plainly and invites people to test it and report back.
- Harper's community is wary of AI (Harper issue #2622). Margin stays a separate, optional install that never touches Harper itself, and it says clearly where text goes.

**Goals**

- Catch errors Harper misses, with high precision. A wrong suggestion costs more trust than a missed one.
- Be honest: what's tested, what isn't, and where text goes.
- Feel responsive. Never block typing; show results a few seconds after a pause.
- Cover the places Harper runs: VS Code, the browser (Chrome and Firefox), language-server editors and Obsidian.

**Non-goals for now**

- Replacing or forking Harper, or rendering Harper's lints.
- A Margin server, accounts or shipped keys. Users bring their own Gemini key (or a local server).
- Non-English checking, code comments and commit messages.
- Automatic tone or style suggestions. Tone and rewrite only run when the user asks.

## 1. Providers

`core` receives an AI SDK `LanguageModel` plus a small provider profile. It never builds providers itself.

| Provider | Status | Model | Notes |
|---|---|---|---|
| **Gemini API** (`@ai-sdk/google`) | **tested, default** | `gemma-4-26b-a4b-it` | User's key. Gemma rejects system instructions, so fold the system prompt into the prompt. Thinking is on by default and can use up the whole output budget: always send `thinkingConfig: { thinkingLevel: 'minimal' }` (`thinkingBudget` is rejected). Free tier: Google may use content to improve its products; say so. Limits for Gemma on the free tier: **verify** in Phase 4. |
| **Local** (`@ai-sdk/openai-compatible`) | implemented, **untested** | `gemma4:26b-a4b-it-qat` (16 GB), `gemma4:12b…` (smaller GPUs) | Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234/v1`. How to switch Gemma 4's thinking off locally is **unverified** (try `reasoningEffort: 'none'` and Ollama's `think: false`). |

Other models: Gemma 4 31B scored the same on the smoke test and was about 4× slower, so it's an option, not the default. Research says prompted models under ~9B over-correct noticeably (DECISIONS 2026-10-21), so the model registry marks which models may run **automatic** check mode; the rest get on-demand only.

**Consent.** Nothing is sent anywhere until the user chooses a provider. Choosing Gemini shows, once: "Your text is sent to Google's Gemini API with your key. On the free tier, Google may use it to improve its products."

## 2. Architecture

### 2.1 Check pipeline

```
edit ─▶ debounce ─▶ dirty prose blocks ─▶ sentences ─▶ cache lookup
                                                         │ misses
                                                         ▼
     mask protected spans ─▶ batch ─▶ model call (check prompt) ─▶ parse
                                                                     │
     publish ◀─ drop if stale ◀─ guards ◀─ ranges ◀─ word diff ◀─ unmask
```

1. **Debounce.** Idle pause (default 2 s), on save, or on command.
2. **Dirty blocks.** Markdown-aware prose blocks: paragraphs, list items, block quotes, headings. Skip fenced/indented code, front matter, tables, HTML blocks, math blocks. Hash each block; only changed blocks go on.
3. **Sentences** via `Intl.Segmenter(locale, { granularity: 'sentence' })`. Merge fragments under ~3 words into the previous sentence (abbreviations like "e.g.").
4. **Cache.** Key = sha256(normalized sentence + mode + `PROMPT_VERSION` + model id). Cache "no change" too.
5. **Mask** protected spans as `⟦0⟧`, `⟦1⟧`, … (§3.4).
6. **Batch** ~5–12 sentences per call (research: batching cuts over-correction; best batch ~5 for small models, ~15 for large). Tune in the eval.
7. **Call the model** with temperature 0, a `maxOutputTokens` cap (≈1.3 × input tokens + 100), thinking off, and the caller's `abortSignal`.
8. **Parse.** Format A (structured output) by default; format B (tag protocol) as the fallback. Validate ids; drop unknown ones. An empty reply is a failure, not "no fixes".
9. **Unmask.** Each placeholder exactly once, in order, or the fix is rejected.
10. **Diff.** Word diff (`diffWordsWithSpace`) of original vs corrected → hunks → absolute UTF-16 offsets.
11. **Guards** (§3.3) and **Harper dedup** (§4).
12. **Stale check.** If the block's hash changed since the request started, discard.
13. **Publish** and cache.

### 2.2 Packages

| Package | Contents | Phase |
|---|---|---|
| `packages/core` | segmenter, block splitter, masker, batcher, prompts, parsers, diff→ranges, guards, dedup, cache interface + LRU, `check()` / `rewrite()`, provider factory (`createModel()`), model registry. No editor imports; environment injected (fetch, storage, clock, logger). | 1 |
| `packages/cli` | `margin check <file>` and `margin rewrite`; harper.js (`binaryInlined`) for dedup. Used by development and the eval. | 1 |
| `packages/vscode` | VS Code extension (requires Harper's extension). | 2–3 |
| `packages/eval` | fixtures, runner, report (dev only). | 4 |
| `packages/browser` | Chrome + Firefox MV3 extension. | 5 |
| `packages/ls` | `margin-ls` language server for Neovim, Helix, Emacs, Sublime, Zed. | 6 |
| `packages/obsidian` | Obsidian plugin. | 6 |

### 2.3 Core types (sketch)

```ts
type Offset = number; // UTF-16 code units (JS string index)

interface Suggestion {
  range: { start: Offset; end: Offset };                    // one hunk
  replacement: string;
  sentence: { start: Offset; end: Offset; fixed: string };  // whole-sentence fix
  kind: 'grammar' | 'word' | 'punctuation' | 'clarity';
  why: string;                                              // ≤ 12 words
  model: string;
}

interface CheckOptions {
  existing: Array<{ start: Offset; end: Offset }>;          // Harper lint ranges
  signal: AbortSignal;
  dialect: 'American' | 'British' | 'Australian' | 'Canadian' | 'Indian'; // Harper's Dialect enum
}
```

## 3. The LLM layer

### 3.1 Modes

| | Check | Rewrite / tone |
|---|---|---|
| Trigger | idle, save or command | command on a selection |
| Output | fixes for changed sentences only | full rewritten text, streamed |
| Temperature | 0 | ~0.4 |
| UI | diagnostics / underlines + quick fixes | diff preview, accept or reject |
| Guards | all of §3.3 | placeholders and negation only; the user reviews the diff |

Rewrite presets: **Improve, Concise, Formal, Friendly, Fix only, Custom**. Never automatic.

### 3.2 Sentence-id protocol

Models never produce offsets. Input is numbered sentences (`<s id="3">…</s>`); output is only the changed sentences, by id, each as the full corrected sentence. Margin word-diffs locally, so ranges are always exact. Optional read-only `<ctx>` with the previous sentence; measure in the eval.

Format A schema:

```ts
const Fixes = z.object({
  fixes: z.array(z.object({
    id: z.number().int(),
    text: z.string().min(1),
    kind: z.enum(['grammar', 'word', 'punctuation', 'clarity']),
    why: z.string().max(120),
  })),
});
```

Format B: `<fix id="N" kind="…">corrected sentence</fix><why>…</why>` per line, or `<none/>`.

### 3.3 Over-edit guards

1. **Prompt** lists allowed and forbidden edits (§7); few-shot includes an untouched correct sentence.
2. **Edit ratio.** Changed words / sentence words > 0.35 → drop (or downgrade to a "rewrite suggestion" hint; the eval decides).
3. **Hard rejects:** negation added or removed (`not`, `never`, `no`, `n't`, …); numbers, URLs, emails or placeholders changed; text inside quotation marks changed; only an Oxford-comma or other Harper-owned style change.
4. **Strict mode** (Phase 4 experiment): 3 candidates, keep edits that appear in ≥ 2.

### 3.4 Masking

Replace with `⟦n⟧` and restore: inline code, link URLs (keep link text), bare URLs and emails, wiki links `[[…]]`, footnote refs, inline math `$…$`, HTML tags, emphasis markers that split words. Start with a small, well-tested tokenizer; ask before adding a Markdown parser.

### 3.5 Triggers, cancellation, staleness

- Trigger: `idle` (default, 2 s), `save` or `manual`.
- At most 1 check in flight per document, 2 globally. A new edit to a block aborts its request.
- Hosted errors ("high demand" 503s, 429s): retry with backoff (AI SDK `maxRetries: 2`), then show "Gemini is busy, retrying soon" in the status bar. Never spin.
- Excluded files: `margin.excludeGlobs` (default `**/.env*`, `**/secrets/**`, `**/*.pem`, `**/*.key`) are never sent.
- Untrusted VS Code workspaces: Margin is off.

## 4. Harper integration

Facts in `HARPER-NOTES.md`. Summary:

- **VS Code:** require Harper (`extensionDependencies: ["elijah-potter.harper"]`). Read its diagnostics with `languages.getDiagnostics(uri)` filtered by `source === 'Harper'`, refresh on `onDidChangeDiagnostics`. Use Harper's dialect setting.
- **CLI, eval, language server:** harper.js `LocalLinter` with `harper.js/binaryInlined` (the file-based binary fails on Windows). Spans are UTF-16, same as Margin's offsets.
- **Browser:** extensions can't read each other's state, so Margin can't see Harper's Chrome-extension lints. Bundle harper.js (published, Apache-2.0) **for dedup only**, as the Obsidian plugin does. Margin's underlines must coexist with Harper's on the same field; use a distinct style.
- **Obsidian:** `WorkerLinter` + `slimBinaryInlined` for dedup only.
- **Dedup rule:** drop a hunk that falls inside a Harper lint; drop a fix if all its hunks overlap Harper lints. Ignored fixes: hash(sentence, fix) in a persistent ignore list.

## 5. Keys and privacy

- **VS Code:** `context.secrets`. **Obsidian:** `app.secretStorage` (1.11.4+). **Browser:** `chrome.storage.local`. It isn't encrypted; the README and options page say so.
- No document text in logs, telemetry or committed fixtures. No telemetry at all.
- The README has a "Where your text goes" section, and one "What's tested" section that says the local path is untested and why.

## 6. Models registry

`packages/core/src/models.json`: id, provider, recommended VRAM (local), thinking-off knob, structured-output support, `autoCheck: boolean` (allowed for automatic check mode; set from eval results), data-use note with source and date, eval scores with date.

## 7. Prompts

Check mode (the spike version, `spike/format/run.ts`, is the starting point):

```
You are a copy editor doing a minimal-edit proofread of {dialect} English.

You receive sentences as <s id="N">…</s>. Some may be correct.
Fix only clear errors:
- grammar and agreement (subject–verb, pronoun, tense consistency)
- a wrong word that is still a real word (their/there, affect/effect)
- missing, repeated or extra words
- run-on sentences and comma splices
- punctuation that changes or hides the meaning
Do not:
- change a sentence that is already correct
- change word choice, tone, style or dialect
- fix spelling or capitalization (another tool handles those)
- touch placeholders like ⟦0⟧; keep each one exactly once, in order
- add or remove negation, numbers, names or facts
Return only the sentences you changed, each as the full corrected sentence, with a kind and a reason of at most 12 words. If nothing needs fixing, return an empty list.
```

Rewrite: keep the language, dialect, meaning, Markdown and placeholders; output only the rewritten text. Prompts live in `packages/core/src/prompts/`, versioned with `PROMPT_VERSION`, with byte-stability snapshot tests.

## 8. Roadmap

### Phase 0: Learn and spike — done (2026-10-21)

- [x] HARPER-NOTES, QUOTA-NOTES, UPSTREAM.
- [x] Format spike on hosted Gemma 4 26B A4B / 31B: both formats parse; 12/12 errors fixed, 0 of 8 correct sentences changed.
- [x] Decisions: hosted Gemma 4 26B A4B as the tested path; format A with B fallback; local implemented but untested.

### Phase 1: Core and CLI

- [x] Workspace: pnpm, strict tsconfig, vitest, tsup. (Linter: not chosen yet; ask.)
- [x] Pure pieces, tests first: block splitter, segmenter, masker/unmasker, batcher, prompt builder, parsers A and B, word diff → hunks → ranges, guards, Harper dedup, LRU cache, staleness.
- [x] `createModel()` for Gemini (thinking off, system prompt folded) and Local (openai-compatible).
- [x] `check()` and `rewrite()` (streamed) with abort support.
- [x] `margin check <file>` and `margin rewrite <file> --preset …` (key from `GEMINI_API_KEY`; harper.js dedup).
- [x] Tests: emoji/CJK offsets; placeholders lost, duplicated or reordered; negation flips; edit ratio; stale results; abort mid-call; unit tests make no network calls (a test `fetch` that throws).

**Done when** `pnpm -r test` is green and `margin check fixtures/sample.md` gives sensible suggestions with hosted Gemma.

### Phase 2: VS Code extension, check mode

- [x] esbuild → CJS; activates on Markdown and plaintext; `extensionDependencies` on Harper.
- [x] First-run: choose provider (Gemini key → SecretStorage, or local URL + model) with the consent notice.
- [x] Settings: provider, model, trigger, idle delay, local URL, excludeGlobs, severity.
- [x] Commands: Check document, Check selection, Set Gemini key, Clear cache, Clear ignored, Show status, Toggle.
- [x] DiagnosticCollection `margin` (message = reason, source = `Margin`); code actions: apply hunk, apply sentence, ignore.
- [x] Harper dedup via `getDiagnostics` (also re-filtered when Harper re-lints); dialect from Harper's `harper.dialect`.
- [x] Status bar: model (+ "untested path"), checking, busy with retry, no key, set up, error.
- [x] Underlines move with edits until the next check (`shift.ts`); edited sentences drop theirs.
- [x] **Manual run in real VS Code** (1.142, Harper 2.13.0), 2026-10-21 by Phoenix: a 5,288-char document, 62 sentences, 8 calls, 5 suggestions, 0 rejected, 15.3 s on hosted Gemma 4 26B A4B. Install: `code --install-extension packages/vscode/margin-0.0.1.vsix`.
- [ ] Speed up the first check: 2 calls in parallel and/or ~12 sentences per batch (measure in the Phase 4 eval).

**Done when** suggestions appear a few seconds after a pause with hosted Gemma, typing never stutters, and tests cover the engine (debounce, abort, staleness, busy retry, concurrency, triggers). The VS Code glue (`extension.ts`) is covered only by the manual run.

### Phase 3: Rewrite, tone and persistence (VS Code)

- [x] Rewrite/tone: preset QuickPick (+ Custom) → stream into a virtual document → diff editor → Accept/Reject (only if the selection is unchanged); warnings for changed negation, numbers or protected spans; editor context menu.
- [x] Persistent cache with TTL (`core/stored-cache.ts`: only "no change" hashes go to disk, never text), the ignore list (globalState), Clear cache.
- [x] Manual run of rewrite in real VS Code (0.0.2, Formal preset), 2026-10-21 by Phoenix.

### Phase 4: Eval

- [x] Own fixtures (synthetic, MIT): 59 errors with acceptable alternatives, 68 clean (bait-heavy), 10 Markdown/offset cases.
- [x] Score **acceptable alternatives**, not one exact string (the spike's two "misses" were valid fixes).
- [x] Metrics: precision first, recall, false-positive rate on the clean set, placeholder violations, parse failures, latency p50/p95, tokens, 429/503 counts. Dated runs with commit hash and raw JSON.
- [x] Tune batch size: **8** (4 = slower, no gain; 15 = recall 82% → 69%). 2 calls in parallel.
- [ ] Edit-ratio threshold: never triggered on this set (precision is already 100%); revisit with harder fixtures.
- [ ] The `<ctx>` previous-sentence option and strict mode (voting): not needed at current precision; revisit for smaller models.
- [x] Gemini free tier for Gemma: per-minute quota hit by back-to-back eval runs with 2 parallel calls (exact numbers unpublished); the daily quota held. Registry (`core/src/models.ts`): Gemma 4 26B A4B hosted → `autoCheck: true`.

### Phase 5: Browser extension (Chrome + Firefox)

- [x] One MV3 codebase (`browser_specific_settings.gecko` for Firefox), as Harper does. `pnpm -F @margin/browser build` → `dist/chrome`, `dist/firefox`.
- [x] Background service worker calls the model; content script finds editable fields (`textarea`, `contenteditable`; skips `spellcheck="false"`), maps text ↔ DOM ranges (`field.ts`, tested), draws underlines (CSS Custom Highlight API for contenteditable, a mirror overlay for textareas), and offers Apply / Ignore on click.
- [x] harper.js in the extension for dedup only (the slim WASM shipped as a file, loaded by URL; 20 MB).
- [x] Options page: local first (detect servers, pick a model, OS-specific OLLAMA_ORIGINS / LM Studio CORS help), Gemini (key in `chrome.storage.local`, not encrypted, said so; explicit consent checkbox), test button, sites list, clear cache/ignored. Sites are off until enabled one by one from the toolbar popup (optional host permission per origin).
- [x] Rewrite/tone from the context menu (works on any page via activeTab), streamed into a card with Accept/Reject.
- [x] Manual run in real Chrome, 2026-10-21 (with Grammarly installed alongside): underlines in textarea, fix card + Apply, rewrite via Alt+Shift+R → Formal → Accept, Ctrl+Z undo. Bugs found and fixed: Grammarly's `spellcheck="false"` hid every field; triple-click selections mapped wrong; invented `⟦0⟧` in rewrites; cards overlapping Grammarly's; partial-word selections.
- [ ] Manual run in Firefox, and on real sites (GitHub comments, Gmail, Reddit).
- [ ] Right-click menu path (Chrome's native menu can't be driven by automation; only the shortcut path was verified).
- [ ] Out of scope at first: Google Docs (canvas rendering) and other custom editors.

### Phase 6: Language server and Obsidian

- [x] `margin-ls` over `core` (the engine moved from VS Code into core): diagnostics, quick fixes (apply / sentence / ignore), rewrite presets on a selection via `workspace/applyEdit`, hash-only cache and ignore list on disk, key from `GEMINI_API_KEY` only. Tested in-process over the protocol with a mock model, and over real stdio with hosted Gemma + Harper dedup.
- [x] Setup docs (`packages/ls/README.md`) for Neovim, Helix, Sublime, Emacs (lsp-mode; Eglot runs one server per buffer, said plainly). Not tried in each editor yet.
- [x] Obsidian plugin (`packages/obsidian`): its own CodeMirror decorations + hover card (Apply / Ignore), so it can't clash with Harper's `@codemirror/lint` source; the shared engine; rewrite modal (command + editor menu); settings tab with local first and **Find models**; Gemini key in `app.secretStorage` (min app 1.11.4); all network via `requestUrl`, so no CORS / OLLAMA_ORIGINS setup. harper.js `slimBinaryInlined` for dedup (main.js ≈ 28 MB, like Harper's plugin). Bundle verified to load; **not yet run inside Obsidian** (not installed here).
- [ ] Zed extension: needs a Rust → WASM toolchain (not installed; skipped for bandwidth).

### Phase 7: Release and community

- [ ] README: what it is, "Where your text goes", "What's tested" (hosted yes, local no, and why), how to help test locally.
- [x] Public GitHub repo: https://github.com/phoenixak/margin (2026-10-21).
- [x] VS Code Marketplace: `phoenixak.margin-ai` 0.1.0 (2026-10-21). The id `margin` was taken by another publisher; the product name stays "Margin".
- [ ] Open VSX, Chrome Web Store, Firefox Add-ons, Obsidian community plugins, npm (`@phoenixak/margin-*`).
- [ ] An issue template for "local model report" (model, hardware, results of `margin eval --quick`).
- [ ] Reply to Harper issue #2622 once there's something real to show.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Over-correction erodes trust | Precision-first eval, guards, easy ignore, `autoCheck` only for models that pass |
| Hosted Gemma busy or rate-limited | Backoff, clear status, cache (most sentences hit "no change"), batch |
| Text sent to Google surprises users | Consent on first use, "Where your text goes" in the README, excludeGlobs, per-site opt-in in the browser |
| Local path breaks unnoticed | Say it's untested; `margin eval --quick` for testers; the issue template |
| Underline collisions with Harper in the browser | Distinct style, dedup against harper.js |
| Harper community dislikes AI | Separate optional install, never modify Harper, no "Harper" in the name |
| Scope (four surfaces) for one person | One shared `core`; surfaces in order; each phase has a done-when |
