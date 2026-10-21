# Margin: plan

> **Scope change, 2026-10-21:** v1 is a **local-models-only companion to Harper**. No cloud providers, no API keys, no privacy modes, no ai-sdk-quota pool (§6, §7.2 and the cloud parts of the roadmap are deferred and kept for reference). `core` takes an injected AI SDK `LanguageModel` built with `@ai-sdk/openai-compatible` for Ollama or LM Studio. See `docs/DECISIONS.md`.

Researched on 2026-10-21. Anything marked **(verify)** is uncertain or likely to drift, so confirm it before building on it.

## 0. Summary

Margin adds a second, LLM-powered pass on top of Harper, inside the editor. Work is split into three tiers:

- **Harper** (instant, local, rule-based) handles spelling, capitalization and mechanical grammar. Margin doesn't reimplement or re-render any of this.
- **Check mode** (seconds; LLM; runs automatically or on command) catches what rules miss: agreement across clauses, tense, real-but-wrong words, run-ons, missing words, and sentences that don't parse. It makes minimal edits only.
- **Rewrite mode** (on demand; LLM; streamed) improves, shortens, changes tone, or follows a custom instruction. The result is shown as a diff to accept or reject.

Every model call goes through an ai-sdk-quota pool. The pool is built from whatever the user has: a local server (Ollama or LM Studio), free tiers (Groq, Gemini, OpenRouter) and their own keys. Privacy modes map to pool tags. The first adapter is VS Code, followed later by a language server and an Obsidian plugin.

## 1. Goals and non-goals

**Goals**

- Catch the errors Harper can't, with high precision. A wrong suggestion costs more trust than a missed one.
- Cost nothing to run. Use local models or free tiers with the user's own keys, and no Margin server.
- Be private by default, and let the user always see where their text goes.
- Feel instant. Never block typing, and show results within a couple of seconds of a pause.

**Non-goals for now**

- Replacing or forking Harper. Harper intentionally keeps generative AI out of its pipeline, so Margin lives outside it.
- A hosted service, accounts, or shipped API keys.
- Non-English checking in v1. Harper is English-focused; Phase 6 covers an LLM-only path for other languages.
- Code comments and commit messages in v1. These come later.

## 2. Landscape

Several existing tools already do LLM proofreading and rewriting with local or bring-your-own models: Writing Tools, R3write, WritingAssistant, Lexicon and GemType. They are standalone apps, system-wide popups, or a browser extension.

Lexicon is the closest in spirit, pairing a local rule engine with a local LLM. But it is its own editor, and its rule engine is LanguageTool rather than Harper.

None of these combines Harper's rules, an LLM pass inside the editor, and quota-aware routing across free tiers. That combination is Margin's whole pitch, so the scope stays there.

## 3. Architecture

### 3.1 Check pipeline

```
edit ─▶ debounce ─▶ dirty prose blocks ─▶ sentences ─▶ cache lookup
                                                         │ misses
                                                         ▼
     mask protected spans ─▶ batch ─▶ pool call (check prompt) ─▶ parse
                                                                    │
     publish ◀─ drop if stale ◀─ guards ◀─ ranges ◀─ word diff ◀─ unmask
```

1. **Debounce.** Wait for an idle pause (default 2 s), or run on save or on command.
2. **Find dirty blocks.** Split the document into prose blocks with Markdown awareness: paragraphs, list items and block quotes. Skip fenced or indented code, front matter, tables, HTML blocks and math blocks. Keep a hash per block, and send only changed blocks onward.
3. **Split into sentences** with `Intl.Segmenter(locale, { granularity: 'sentence' })`. Abbreviations like "e.g." cause false splits, so merge any fragment under about 3 words into the previous sentence.
4. **Check the cache.** The key is sha256 of the normalized sentence + mode + `PROMPT_VERSION`. Cache "no change" results too. Most sentences are fine, so these negative hits save most of the quota.
5. **Mask** protected spans as `⟦0⟧`, `⟦1⟧`, … (§5.5).
6. **Batch** up to about 12 sentences or 600 input tokens per call. Tune these numbers in the eval. One 2026 study found batching also improved minimal-edit quality.
7. **Call the pool** (§6).
8. **Parse** the response as JSON or the tag protocol (§5.3). Validate ids and drop unknown ones.
9. **Unmask.** Each placeholder must appear exactly once and in its original order, or the fix is rejected.
10. **Diff.** Word-diff the original sentence against the corrected one (`diffWordsWithSpace`). Group adjacent changes into hunks and map them to absolute UTF-16 offsets.
11. **Apply guards:** over-edit, negation flip, protected tokens, Harper overlap, and the ignore list (§5.4, §5.6).
12. **Drop stale results.** If the block's hash changed since the request started, discard what came back.
13. **Publish** the suggestions and write them to the cache.

### 3.2 Packages

- **`core`** holds the segmenter, block splitter, masker, batcher, prompts, parsers, diff-to-ranges, guards, the cache interface with an LRU implementation, the pipeline (`check()` and `rewrite()`), the pool factory (`createMarginPool()`), local-server detection, and the model registry.
- **`cli`** provides `margin check <file> [--mode] [--privacy]`. It prints suggestions and runs harper.js for dedup. Claude Code and the eval both use it.
- **`vscode`** covers diagnostics, code actions, commands, settings, secrets, the status bar, and the rewrite diff UI.
- **`eval`** holds the fixtures, the runner and the report.

### 3.3 Core types (sketch)

```ts
type Offset = number; // UTF-16 code units into the original text (a JS string index)

interface Suggestion {
  range: { start: Offset; end: Offset };                    // one hunk
  replacement: string;
  sentence: { start: Offset; end: Offset; fixed: string };  // whole-sentence fix
  kind: 'grammar' | 'word' | 'punctuation' | 'clarity';
  why: string;                                              // ≤ 12 words, shown on hover
  member: string;                                           // pool member that produced it
}

interface CheckOptions {
  existing: Array<{ start: Offset; end: Offset }>;          // Harper lint ranges, for dedup
  signal: AbortSignal;
  dialect: 'American' | 'British' | 'Australian' | 'Canadian' | 'Indian'; // Harper's Dialect enum (0–4)
}
```

Adapters convert between these offsets and editor positions. VS Code's `document.positionAt()` already uses UTF-16, which matches JS string indices.

## 4. Harper integration

**What harper.js offers** (from its docs):

- One `Linter` interface with two implementations:
  - `LocalLinter` runs on the same thread. Use it in Node.
  - `WorkerLinter` runs in a Web Worker. It doesn't work properly in Node.
- Methods:
  - `lint(text, options)` returns `Lint[]`.
  - `organizedLints()` keeps each lint's source rule.
  - Also available: `applySuggestion()`, `ignoreLint()`, `setLintConfig()`, `isLikelyEnglish()` and `isolateEnglish()`. There is no `contextHash()` or `setDialect()` in 2.13.0; the dialect is a constructor option.
- `Span` is documented as Unicode scalar values, but **harper.js returns UTF-16 code units** (tested with emoji, CJK and combining marks; `spike/harper/spans.test.ts`). Spans compare directly with Margin's offsets.
- Node setup is covered by `../../harper/packages/web/src/routes/docs/harperjs/node/`. Binaries: `harper.js/binary`, `/slimBinary`, `/binaryInlined`, `/slimBinaryInlined`. On Windows, `harper.js/binary` fails to load its `.wasm` (`D:\D:\…` path bug), so Node code uses `harper.js/binaryInlined`.

**How each adapter gets Harper's results:**

- **VS Code: don't bundle Harper.** The official Harper extension already runs harper-ls.
  - Read its diagnostics with `vscode.languages.getDiagnostics(uri)`, filtered by their `source`, and refresh on `vscode.languages.onDidChangeDiagnostics`. This respects the user's Harper config and dictionary and avoids duplicate squiggles.
  - The extension id is `elijah-potter.harper`; harper-ls diagnostics have `source: "Harper"` and `code: <rule name>`.
  - Margin requires Harper (`extensionDependencies`), so Harper is always there.
- **CLI, eval and language server:** use `LocalLinter`.
- **Obsidian:** use `WorkerLinter`, for dedup only. Harper's own Obsidian plugin renders Harper's lints.

**Phase 0 deliverable:** `docs/HARPER-NOTES.md`, covering:

- the Linter API as installed
- span units
- the Dialect enum values
- how the VS Code plugin launches harper-ls and labels its diagnostics
- how the Obsidian plugin loads the WASM

## 5. The LLM layer

### 5.1 Modes

| | Check | Rewrite |
|---|---|---|
| Trigger | idle, save, or command | command on a selection |
| Output | fixes for the changed sentences only | full rewritten text, streamed |
| Temperature | 0 | about 0.4 |
| UI | diagnostics and quick fixes | diff preview with accept or reject |
| Guards | everything in §5.4 | placeholders and negation only; the user reviews the diff |

### 5.2 Sentence-id protocol (why the model never gives offsets)

LLMs are unreliable at character offsets, and when asked to quote a "find" string they often paraphrase it. Margin avoids both problems this way:

- **Input:** numbered sentences, e.g. `<s id="3">They was late to the the meeting.</s>`.
- **Output:** only the sentences that changed, by id, each as a full corrected sentence.
- **Ranges:** Margin diffs each original/corrected pair locally. The offsets are always exact, even when the model rephrases.
- **Optional context:** the previous sentence can be sent as read-only context (`<ctx>…</ctx>`) to help with tense and pronoun agreement across sentences. Measure its token cost in the eval.

### 5.3 Output format (decided in the Phase 0 spike)

There are two candidates.

**A. Structured output.** Use `generateText({ output: Output.object({ schema }) })` (AI SDK 7).

- Ollama enforces JSON schemas with constrained decoding through `response_format` on its OpenAI-compatible endpoint.
- Gemini and many Groq and OpenRouter models also support schemas.
- Invalid output throws `NoObjectGeneratedError`.

**B. Tag protocol.** Plain text like `<fix id="3" kind="grammar">corrected sentence</fix><why>…</why>`, parsed leniently and then validated with zod. It works on any model and it streams.

**The catch with A in a mixed pool.** A member that rejects `response_format` returns a 400, and ai-sdk-quota rethrows 400 and 422 errors without trying the next model. That leaves two options:

- Tag members that don't support schemas (e.g. `no-json`) and exclude that tag in check mode.
- Use B everywhere.

The default hypothesis is A for capable members, with B as the fallback when every capable member is exhausted. The spike decides with data: parse rate, latency and quality per member.

Schema for A:

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

### 5.4 Over-edit guard

On minimal-edit tasks, LLMs over-correct: they swap synonyms, polish style, and rephrase correct clauses. Research also finds that declarative prompts like "correct the errors" make this worse than prompts that list which edits are allowed. Margin counters it in four ways:

1. **Prompt.** List the allowed and forbidden edits explicitly (§8). The few-shot examples include a correct sentence left untouched.
2. **Edit-ratio limit.** If changed words divided by sentence words exceeds a threshold (start at 0.35), drop the fix in check mode. Alternatively, downgrade it to a Hint labelled "rewrite suggestion"; the eval decides which.
3. **Hard rejects.** Reject any fix that:
   - adds or removes negation (`not`, `never`, `no`, `n't`);
   - changes numbers, URLs, emails or placeholders;
   - changes text inside quotation marks;
   - only changes style choices Harper owns, such as Oxford commas.
4. **Optional strict mode** (a Phase 4 experiment). Generate 3 candidates and keep only edits that appear in at least 2 of them. A 2026 paper found this edit-level majority voting reduces over-correction without any training. It triples the number of calls, so offer it for local models only.

### 5.5 Masking protected spans

Before sending, replace these with `⟦n⟧` placeholders, and restore them afterwards:

- inline code
- link URLs (keep the link text)
- bare URLs and emails
- wiki links `[[…]]`
- footnote references
- inline math `$…$`
- HTML tags
- emphasis markers, where they would split words

Code blocks, front matter, tables and math blocks are skipped entirely (see §3.1, step 2).

Start with a small, well-tested tokenizer. If the regexes get hairy, ask before adding a Markdown parser dependency such as `micromark` or `mdast`.

### 5.6 Dedup with Harper

- The prompt tells the model that spelling and capitalization are handled elsewhere.
- Drop any hunk that falls fully inside a Harper lint range. Drop a whole fix if all of its hunks overlap Harper lints.
- Persist ignores: store a hash of (sentence, fix) in an ignore list, and never show that fix again.

### 5.7 Triggers, cancellation and staleness

- **Trigger setting:** `idle` (the default, after 2 s), `save`, or `manual`.
- **Concurrency:** at most 1 check in flight per document, and 2–3 globally.
- **Cancellation:** a new edit to a block aborts that block's in-flight request via `abortSignal`.
- **Staleness:** every request records its block's hash. If the hash has changed by the time results arrive, they're discarded.
- **Untrusted workspaces:** cloud members are disabled.
- **Excluded files:** files matching `margin.cloud.excludeGlobs` (default: `**/.env*`, `**/secrets/**`, `**/*.pem`, `**/*.key`) never go to cloud members.

### 5.8 Tokens, reasoning and caching

- **Turn reasoning off,** or down to the minimum, in check mode. Reasoning tokens use up output-token limits. In ai-sdk-quota's 2026-10-21 soak run, most of the remaining 429s came from Groq's output-tokens-per-minute limit.
- **Cap output.** Set `maxOutputTokens` from the input size: about 1.3× the input tokens plus 100.
- **Keep the system prompt byte-identical, and put it first.** Groq doesn't count cached tokens toward rate limits. Add a snapshot test that the prompt bytes are stable, and bump `PROMPT_VERSION` on any change.
- **Set reasoning knobs through namespaced `providerOptions`.** The knobs differ by provider and by AI SDK provider package. Pass all of them at once; each provider reads only its own namespace, so per-member settings need no special support from the pool.

| Member | Knob to set (**verify** each against the installed provider's types) |
|---|---|
| Groq `gpt-oss-*` | `providerOptions.groq.reasoningEffort: 'low'` (enum: none, default, low, medium, high) |
| Gemini Flash-Lite | `providerOptions.google.thinkingConfig: { thinkingLevel: 'minimal' }` (or `thinkingBudget: 0`) |
| OpenRouter | `providerOptions.openrouter.reasoning: { effort: 'none' }` |
| Ollama / LM Studio (openai-compatible) | The namespace is the `name` passed to `createOpenAICompatible`. Check whether `reasoningEffort` turns thinking off for Gemma 4 and Qwen. If not, pick a non-thinking model or tag. |

## 6. Using ai-sdk-quota

### 6.1 Pool factory (sketch)

```ts
import { generateText, Output } from 'ai';
import { createQuotaPool } from 'ai-sdk-quota';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createGroq } from '@ai-sdk/groq';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

export async function createMarginPool(cfg: MarginConfig, secrets: Secrets, store: QuotaStore) {
  const members = [];

  if (cfg.local.enabled) {
    const local = createOpenAICompatible({
      name: 'local',
      baseURL: cfg.local.baseUrl,       // Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1
      supportsStructuredOutputs: true,  // (verify per model in the spike)
    });
    members.push({ id: 'local', model: local(cfg.local.model), tags: ['local'] }); // no `limits` = unlimited
  }

  const groqKey = await secrets.get('groq');
  if (groqKey) members.push({
    id: 'groq-20b', model: createGroq({ apiKey: groqKey })('openai/gpt-oss-20b'),
    limits: 'groq:free', tags: ['cloud'],
  });

  const geminiKey = await secrets.get('gemini');
  if (geminiKey) members.push({
    id: 'gemini-lite', model: createGoogleGenerativeAI({ apiKey: geminiKey })('gemini-3.5-flash-lite'),
    limits: 'gemini:free', tags: ['cloud', 'may-train'],
  });

  const orKey = await secrets.get('openrouter');
  if (orKey) members.push({
    id: 'or-gemma4', model: createOpenRouter({ apiKey: orKey })('google/gemma-4-26b-a4b-it:free'),
    limits: 'openrouter:free', tags: ['cloud', 'may-train'],
  });

  return createQuotaPool({ models: orderByProfile(members, cfg.profile), store, onEvent: cfg.onEvent });
}

// A check call
const { output } = await generateText({
  model: pool.model({ exclude: excludeFor(cfg.privacy), stickyKey: docUri }),
  maxRetries: 0,
  temperature: 0,
  maxOutputTokens,
  abortSignal,
  system: CHECK_SYSTEM_PROMPT,
  prompt: renderSentences(batch),
  output: Output.object({ schema: Fixes }),
  providerOptions: REASONING_OFF,
});
```

`stickyKey: docUri` keeps a document on one model while it has quota. That keeps the editing style consistent within a document, for both modes.

### 6.2 Privacy modes and pool filters

| Mode | `exclude` | Meaning |
|---|---|---|
| `local-only` (default) | `['cloud']` | Nothing leaves the machine. |
| `no-training` | `['may-train']` | Cloud is allowed only where the provider doesn't train on inputs. |
| `any` | `[]` | Every configured member. |

- If no local server is found on first run, ask the user to choose a mode. Never fall through to cloud silently.
- Treat tags as policy data. Store each provider's data-use terms with a source and the date checked, the same way ai-sdk-quota's limits registry does.
- **Gemini:** the free tier may use content to improve Google's products, so tag it `may-train`.
- **OpenRouter:** whether free endpoints train depends on the upstream provider and on the account's training settings, which are separate for free and paid models. Tag them `may-train` unless each request enforces otherwise. OpenRouter's provider-routing preferences include a per-request data-collection setting: `providerOptions.openrouter.provider.data_collection: 'deny'` (confirmed in `@openrouter/ai-sdk-provider@3.1.0` types).
- **Groq:** confirm its terms before tagging it either way.

### 6.3 Profiles (member order)

Member order is the priority order (ai-sdk-quota's default `'priority'` strategy; confirmed in `docs/QUOTA-NOTES.md`).

- **`privacy-first`** (the default when a local server exists): local → Groq → Gemini → OpenRouter.
- **`speed-first`:** Groq → local → Gemini → OpenRouter.

Rebuild the pool when settings change, but keep the same store so the counters carry over.

### 6.4 Events and the status bar

Map `onEvent` (`route | skip | fail | cooldown | reconcile | exhausted`) to a status bar item. It shows which member answered, whether a member is cooling down, or that all models are at their limit. When a daily cap is set (§6.5), also show `pool.remaining()`. Member ids are visible to users, so give them clear names.

### 6.5 Budgets as a user cap

Offer an optional `margin.dailyCap` setting. Implement it with `budgets: { perKey: { rpd: cap } }` and `budgetKey: 'margin'` on every call. That stops Margin from draining a free tier the user also needs elsewhere.

### 6.6 Questions to answer in Phase 0

Write the answers in `docs/QUOTA-NOTES.md`. Real gaps go in `docs/UPSTREAM.md`.

1. How do you declare a member with no limits, such as a local server?
2. Is member order the priority order? Is there an include/require filter, or only `exclude`?
3. **Aborts:** when the caller aborts, is the reservation released, or committed with real usage? Test it: 100 aborted calls should leave capacity unchanged. Editors abort constantly.
4. **Persistence across restarts and windows.**
   - `memoryStore()` resets when VS Code restarts, so daily windows are lost.
   - Each VS Code window runs its own extension host, so two windows keep separate counters for the same key.
   - Margin therefore needs a store that persists and is safe across processes, such as a file-backed store with locking that implements the store interface. Decide whether it lives in Margin or upstream.
5. Do two pools sharing one store share counters for the same member ids?
6. How does the caller learn which member answered: a route event, or response metadata?
7. Does a `NoObjectGeneratedError` (bad JSON in a 200 response) count as a member failure, and should it? This probably calls for an upstream hook along the lines of "validate the response, else try the next member".
8. Can `probe` be called as a library function? That would enable an in-editor "check my limits" command.

### 6.7 Linking the unpublished library

Run `pnpm pack` in `../../ai-sdk-quota` and install the tarball, or use a `link:` dependency with overrides.

Watch for two copies of `ai` or `@ai-sdk/provider`. The symptom is an error like "LanguageModelV4 is not assignable to LanguageModelV4". Types and runtime checks both require a single copy.

## 7. Models

Free-tier lists change weekly. Margin recommends models from its own eval results and the user's probed limits, never from a hardcoded list. What follows is a snapshot as of 2026-10-21.

### 7.1 Local

| VRAM | Suggested start | Notes |
|---|---|---|
| none or 8 GB | Gemma 4 E4B (`gemma4:e4b`; Ollama's default `gemma4`) | about 4.5 GB at 4-bit |
| 12–16 GB | Gemma 4 12B QAT (`gemma4:12b-it-qat`) | the default on the dev machine |
| 16 GB, to try | Gemma 4 26B A4B QAT (`gemma4:26b-a4b-it-qat`) | MoE with 3.8B active, so fast. About 14.4 GB of weights at 4-bit, which is tight on 16 GB; keep the context small. |
| 16 GB, alternatives | `gpt-oss:20b`, Qwen 3.5 9B, Qwen3 14B | gpt-oss is a reasoning model, so set its effort to low |
| 24 GB+ | Gemma 4 26B A4B or 31B | |

- Gemma 4 models can reason, so make sure thinking is off in check mode.
- Margin only sends small batches, so a small context window saves VRAM: `OLLAMA_CONTEXT_LENGTH=8192 ollama serve`.
- Keep the model warm with Ollama's `keep_alive`, and send one warm-up call when Margin activates with local enabled.
- Detect local servers on activation (Ollama: `GET /api/tags`; LM Studio: `GET /v1/models`) and match the installed models against the registry.

**Dev machine: Radeon RX 9070 XT, 16 GB.**

- On Linux, ROCm 7 officially supports this card and Ollama lists it.
- On Windows, Ollama's ROCm support table stops at RDNA 3, so Ollama uses its Vulkan backend (on by default when installed). LM Studio offers both ROCm and Vulkan runtimes.
- Reports differ on whether Vulkan or ROCm is faster on this card. Some llama.cpp benchmarks show Vulkan ahead on token generation, so if you're on Linux, measure both.
- Reference speeds with Ollama on ROCm: about 92 tok/s for gpt-oss:20b, 58 tok/s for Qwen3.5 9B, and 52 tok/s for Qwen3 14B.

### 7.2 Free cloud

| Provider | Free tier (verify in the console) | Privacy | Role in Margin |
|---|---|---|---|
| Groq | No card needed. Limits are per model and per organization; about 30 RPM / 1,000 RPD is commonly cited. Cached tokens don't count. Some organizations also have output-tokens-per-minute limits. | confirm terms | Fastest, so the first cloud choice for check mode |
| Gemini | Flash and Flash-Lite are free, including 3.5 Flash-Lite and 3.1 Flash-Lite. Limits are per project. | the free tier may train | Good-quality backup |
| OpenRouter | `:free` models at 20 RPM and 50 RPD, rising to 1,000 RPD after $10 of credits (confirmed in ai-sdk-quota's PHASE0.md from OpenRouter's docs; the daily cap is shared across all `:free` models) | depends on the upstream provider and account settings | Breadth; last resort |

OpenRouter's free models as of October 2026 include:

- `google/gemma-4-26b-a4b-it:free`
- `minimax/minimax-m3.1-flash:free`
- NVIDIA Nemotron 3 and 3.5 variants
- Poolside Laguna
- Thinking Machines Inkling

Some of these are reasoning models. Avoid `openrouter/free` in check mode: it routes each request to a random free model, so the editing style would vary from one request to the next.

Start the cloud check pool in this order: Groq `openai/gpt-oss-20b` → Gemini `gemini-3.5-flash-lite` → OpenRouter `google/gemma-4-26b-a4b-it:free`. Then let the Phase 4 eval decide. Phoenix's own probe and soak data overrides published limits; for example, his Groq account sustained about 20 of a published 30 RPM.

### 7.3 Registry

Keep a registry at `packages/core/src/models.json`. Each entry records:

- id and provider
- recommended VRAM
- the reasoning knob
- schema support (from the spike)
- data-use tag, with source and date
- eval scores, with date

The VS Code "Choose models" command reads from it.

## 8. Prompts (drafts; the eval decides)

Check mode, system prompt:

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

Few-shot: 3 examples, including at least one correct sentence left untouched and one sentence with a placeholder.

**Rewrite presets:** Improve, Concise, Formal, Friendly, Fix only, and Custom. The rewrite system prompt says: keep the same language and dialect; keep the meaning, the Markdown and the placeholders; output only the rewritten text.

Keep prompts in `packages/core/src/prompts/`, versioned with `PROMPT_VERSION` and covered by snapshot tests.

## 9. Roadmap

### Phase 0: Learn and spike (no product code)

- [x] Clone Automattic/harper to `../../harper` and write `docs/HARPER-NOTES.md` (checklist in §4).
- [x] Read `../../ai-sdk-quota`: README, PHASE0.md, public types, store interface, limits registry and probe. Write `docs/QUOTA-NOTES.md` answering §6.6, with small tests where possible.
- [ ] Run the format spike: send one synthetic 20-sentence fixture to each candidate local model, once with format A and once with format B. Record parse success, latency p50/p95, tokens, and the edits made. Commit the results as JSON plus a table.
- [ ] Decide the format and the default local model, and record them in `docs/DECISIONS.md`.

**Done when** the notes and decisions exist, and every open question has an answer or an UPSTREAM entry.

### Phase 1: Core and CLI

- [ ] Scaffold the workspace: pnpm, strict tsconfig, vitest, tsup, lint.
- [ ] Build the pipeline pieces: segmenter, block splitter, masker/unmasker, batcher, prompt builder, parsers (A and B), word diff → hunks → ranges, guards, dedup, LRU cache, staleness check, `check()` and `rewrite()`.
- [ ] Build `createLocalModel()` (Ollama / LM Studio via `@ai-sdk/openai-compatible`) and local-server detection. One request in flight at a time (one GPU).
- [ ] Build `margin check <file>` with harper.js dedup.
- [ ] Write tests for:
  - emoji and CJK offsets
  - rejected fixes when placeholders are lost, duplicated or reordered
  - rejected negation flips
  - the edit-ratio guard
  - dropped stale results
  - aborting mid-call
  - no network access in unit tests

**Done when** `pnpm -r test` is green and `margin check fixtures/sample.md` gives sensible suggestions with a local model.

### Phase 2: VS Code MVP (check mode)

- [ ] Scaffold the extension: esbuild → CJS, activating on markdown and plaintext.
- [ ] Declare `extensionDependencies: ["elijah-potter.harper"]` and read the dialect from Harper's settings.
- [ ] Add settings: trigger, idle delay, local URL and model, severity.
- [ ] Add commands: Check document, Check selection, Clear cache, Show model status, Toggle.
- [ ] Publish a DiagnosticCollection `margin`, with the message set to the reason and the source set to `Margin (member)`.
- [ ] Add code actions: apply a hunk, apply the whole sentence, ignore.
- [ ] Dedup against Harper via `getDiagnostics` (`source === 'Harper'`).
- [ ] Status bar: model, busy/idle, server unreachable.

**Done when:**

- In local-only mode on the dev machine, suggestions appear within about 3 s of pausing.
- Typing never stutters.
- An integration test proves no request leaves localhost.

### Phase 3: Rewrite and persistence

- [ ] Rewrite selection: preset QuickPick → stream into a virtual document → diff editor → Accept or Reject. Accept only applies if the selection hasn't changed.
- [ ] Add a persistent cache with a TTL, the ignore list, and the Clear cache command.

**Done when:**

- Rewrites stream and cancel cleanly.

### Phase 4: Eval and recommendations

- [ ] Build `packages/eval` fixtures. Write our own; check licences before using any public grammar-correction data (JFLEG, for example, is non-commercial). Four sets:
  - **Error set:** sentences with expected minimal fixes, organized by error type.
  - **Clean set:** correct sentences that must stay untouched, at least as large as the error set.
  - **Markdown set:** code, links and placeholders.
  - **Offsets set:** emoji, CJK and combining marks.
- [ ] Measure: precision (the primary metric), recall, false-positive rate on the clean set, placeholder violations, parse failures, latency p50/p95, tokens per request, and 429s. Follow the pattern of ai-sdk-quota's bench: a dated run, the commit hash, and the raw JSON committed.
- [ ] Tune the batch size, the edit-ratio threshold, and whether to send the context sentence.
- [ ] Try strict mode (edit-level voting) on local models.
- [ ] Generate the recommendations in `models.json` from the results.

**Done when** one command reproduces the table, and the extension's defaults come from it.

### Phase 5: Reach and release

- [ ] Build a language server over `core` with diagnostics and code actions, and test it in Neovim.
- [ ] Build the Obsidian plugin:
  - Use `WorkerLinter` for dedup.
  - Store keys in `app.secretStorage` (requires Obsidian 1.11.4 or later; secrets are device-local and not synced).
  - Handle Obsidian's network rules. Either allow CORS with local servers (Ollama's `OLLAMA_ORIGINS`) or give the providers a custom `fetch` built on `requestUrl`, which doesn't stream **(verify)**.
- [ ] Language-server editors: config docs for Neovim, Helix, Emacs (Eglot) and Sublime Text, plus a small Zed extension that runs margin-ls (the same set Harper covers through harper-ls).
- [ ] Publish to the VS Code Marketplace and Open VSX. The README needs a clear "where your text goes" section. No telemetry.

### Phase 6: Later

- Non-English checking through an LLM-only path. Use `isLikelyEnglish` / `isolateEnglish` to route text; there's no Harper dedup on that path.
- Code comments and commit messages.
- Per-project style rules: a `.margin.json` with banned words and preferred spellings.

### Phase 7: Browser and the rest of Harper's integrations

Decided 2026-10-21: Margin aims to run wherever Harper runs (see the table in `docs/HARPER-NOTES.md`). The browser comes after VS Code and the Phase 4 eval have proven the core.

- [ ] One MV3 extension for Chrome and Firefox (`packages/browser`), as Harper does. WordPress is covered by it, as it is for Harper.
- [ ] Decide key handling first: browsers have no real secret store, so start local-only (Ollama needs `OLLAMA_ORIGINS` for the extension's origin).
- [ ] Highlights in arbitrary editable fields: depend on Harper's `lint-framework` if it's published by then; don't copy it.
- [ ] Google Docs draws text on a canvas; treat it as a separate, optional milestone.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Free tiers change or vanish | Local-first defaults, a registry with dates, probing, and a graceful "all at limit" state |
| Over-correction erodes trust | Precision-first eval, guards, easy ignore, conservative defaults |
| Harper users expect privacy | Local-only default, visible routing, excludeGlobs, workspace trust |
| Slow machines | E4B, cloud fallback, manual trigger |
| Quota races across windows and restarts | A persistent shared store |
| Two copies of `ai` when linking ai-sdk-quota | Install from a tarball |
| Name and trademark | No "Harper" in the product name |

## 11. Open questions for Phoenix

Answered 2026-10-21; see `docs/DECISIONS.md`.

1. Name: "Margin" stays the working name.
2. ai-sdk-quota: published to npm on 2026-10-22; linked from a tarball until then.
3. Dev OS: both. Windows day to day (Ollama on Vulkan); Linux for ROCm vs Vulkan measurements.
4. Default trigger: idle.
5. Licence: MIT.

## 12. Sources (checked 2026-10-21)

Harper
- harper.js linting guide: https://writewithharper.com/docs/harperjs/linting
- harper.js API reference: https://writewithharper.com/docs/harperjs/ref/harper.js.html
- WorkerLinter (not for Node): https://writewithharper.com/docs/harperjs/ref/harper.js.workerlinter.html
- Repository: https://github.com/Automattic/harper

AI SDK and providers
- Structured data (AI SDK 7): https://ai-sdk.dev/v7/docs/ai-sdk-core/generating-structured-data
- `Output` reference: https://ai-sdk.dev/v7/docs/reference/ai-sdk-core/output
- OpenAI-compatible providers: https://ai-sdk.dev/v7/providers/openai-compatible-providers
- OpenRouter provider: https://github.com/OpenRouterTeam/ai-sdk-provider
- AI SDK 7 release (June 2026): https://community.vercel.com/t/vercel-weekly-2026-06-29/44602

Models and hardware
- Gemma 4 sizes and memory: https://ai.google.dev/gemma/docs/core
- Gemma 4 Ollama tags and QAT: https://jacar.es/en/gemma-4-locally-with-ollama/
- RX 9070 XT local AI (ROCm, Ollama tables, tok/s): https://localaimaster.com/blog/rx-9070-xt-local-ai
- Vulkan vs ROCm on the RX 9070 XT (llama.cpp numbers, in Japanese): https://gaming-st.com/gpu/radeon-local-ai-gpu-rocm-10-1-vs-geforce/
- Ollama structured outputs over the OpenAI-compatible API: https://futureagi.com/blog/what-is-ollama-2026

Free tiers and privacy
- OpenRouter free models: https://openrouter.ai/collections/free-models
- OpenRouter free router: https://openrouter.ai/openrouter/free
- OpenRouter provider logging and training settings: https://openrouter.ai/docs/guides/privacy/provider-logging
- OpenRouter free limits (third-party): https://pricepertoken.com/endpoints/openrouter/free
- Groq free tier: https://www.developersdigest.tech/models/free-api/groq
- Gemini free tier: https://yingtu.ai/en/blog/google-gemini-api-free-tier-limits-2026

Obsidian
- SecretStorage guide: https://docs.obsidian.md/plugins/guides/secret-storage
- 1.11.4 changelog: https://obsidian.md/changelog/2026-01-07-desktop-v1.11.4

Over-correction research
- Edit-level majority voting: https://arxiv.org/abs/2605.13624
- Prompts and batching for minimal-edit correction: https://arxiv.org/abs/2609.10810
- Post-correction via overcorrection (EMNLP 2025): https://arxiv.org/abs/2509.20811

Existing tools
- Writing Tools: https://github.com/theJayTea/WritingTools
- R3write: https://github.com/drknowhow/R3write
- Lexicon: https://github.com/AashishH15/Lexicon
- GemType write-up: https://dev.to/riponcm/open-source-grammarly-alternatives-in-2026-and-why-i-built-another-one-4ljk
