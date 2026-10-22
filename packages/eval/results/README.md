# Eval results

Fixtures: `../fixtures/` (synthetic, MIT): 59 sentences with one error each (several acceptable fixes listed per item), 68 correct sentences (many are deliberate bait: informal style, negation, numbers, quotes, British spellings), and 10 Markdown cases (code, links, URLs, emails, math, HTML, emoji, CJK). Debatable items are reported but not scored.

Scoring: **precision** = correct fixes / every change Margin made (wrong fixes and changes to correct sentences both count against it). **Recall** = correct fixes / errors. A fix counts as correct only if it matches one of the accepted versions. Harper's ranges are not passed to Margin here, so this measures Margin alone; "+ Harper recall" counts errors fixed by Margin *or* already flagged by Harper.

## 2026-10-21, hosted Gemma 4 26B A4B (Gemini API)

| run | batch | parallel calls | precision | recall | F0.5 | correct sentences changed | correct / wrong / missed | + Harper recall | calls | time |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline (8a58e91) | 8 | 2 | 98.1% | 82.3% | 0.944 | 0 / 70 | 51 / 1 / 10 | 85.5% | 18 | 30.7 s |
| b8-c2 #1 (07fc072) | 8 | 2 | **100%** | **82.3%** | **0.959** | **0 / 70** | 51 / 0 / 11 | 85.5% | 18 | 31.9 s |
| b8-c2 #2 (07fc072) | 8 | 2 | 100% | 82.3% | 0.959 | 0 / 70 | 51 / 0 / 11 | 85.5% | 18 | 30.5 s |
| b4-c2 (07fc072) | 4 | 2 | 98.1% | 82.3% | 0.944 | 0 / 70 | 51 / 1 / 10 | 85.5% | 35 | 44.9 s |
| b15-c1 (07fc072) | 15 | 1 | 100% | 69.4% | 0.919 | 0 / 70 | 43 / 0 / 19 | 75.8% | 10 | 75.5 s |
| prompt v2 + echo retry (bbb1cdd) | 8 | 1 | **100%** | 80.6% | 0.954 | **0 / 70** | 50 / 0 / 12 | **87.1%** | 22 | 78.4 s |

**Prompt v2 (2026-10-21, found in Firefox testing):** sentences starting lowercase were merged into the previous one, and the model sometimes diagnosed an error but returned the sentence unchanged ("how was you"). Fixes: split before a lowercase start; retry an echoed sentence alone once; the prompt says to fix grammar even when capitalization is also off. Precision unchanged; Harper-combined recall up. Fixtures e61, e62 (debatable) and c69 (the model once suggested "open it" → "open them") were added after this run.

**Decisions:** batch 8, 2 calls in parallel. Larger batches cost recall (matching arXiv 2609.10810); smaller ones cost time with no gain.

**What it misses:** mostly missing articles ("postpone launch", "before meeting", "due end of the month"), and "Between you and I" / "could care less" in some runs. It never changed a correct sentence.

**The one wrong fix (baseline):** the model leaked a stray `[]` into a corrected sentence ("lose the[]backup drive"). A comma-splice fix elsewhere was blocked by the Markdown guard for a similar stray character. The guard now also rejects added or removed `[ ] < > | #` (commit 07fc072), and later runs had no wrong fixes.

**Rate limits:** running evals back to back with 2 parallel calls hit Gemini's per-minute quota for Gemma (the daily quota was fine). Margin's VS Code engine waits 30 s on a 429; the AI SDK's own retries alone are too short for per-minute quotas.

**Caveats:** one model, one fixture set we wrote ourselves, 137 items. These numbers say the approach works on this model; they aren't a benchmark. The local path is evaluated below.

## 2026-10-22, local Gemma 4 26B A4B (Ollama), synthetic fixtures

First run of the local path: `gemma4:26b-a4b-it-qat` on Ollama 0.40.7, Windows 11, AMD RX 9070 XT (16 GB), 97% on the GPU. Same code as the human-text runs below (commit a999dd0).

| run | batch | parallel calls | precision | recall | F0.5 | correct sentences changed | correct / wrong / missed | + Harper recall | calls | time |
|---|---|---|---|---|---|---|---|---|---|---|
| [local b8-c1](2026-10-22-local-gemma4-26b-b8-c1.md) | 8 | 1 | **100%** | **93.7%** | **0.987** | **0 / 71** | 59 / 0 / 4 | 95.2% | 19 | 59.3 s |

Better recall than the hosted runs (80.6–82.3%) on the same weights. The hosted API and Ollama differ in quantization details and in how "thinking" is switched off, so the two aren't interchangeable; each is measured on its own.

# Human-text eval

The synthetic fixtures were written by us, so they can flatter the approach. These runs use text real people wrote. Run them with `pnpm -F @margin/eval fetch-human`, then `pnpm -F @margin/eval eval-human -- --provider local|gemini`. They run Harper first and let Margin skip what Harper flags, the way the extensions do.

- **[JFLEG](https://github.com/keisks/jfleg) test set** (CC BY-NC-SA 4.0): 747 sentences from English learners' essays, each corrected by four people. Margin's edits are compared word by word with the closest correction. JFLEG's sentences are never committed; only numbers are.
- **Published prose**: 200 paragraphs (about 720 sentences, 16,600 words) from four public-domain books on Project Gutenberg: *The Great Gatsby*, *The Age of Innocence*, *Main Street*, and Keynes's *The Economic Consequences of the Peace*. This is professionally edited text, so nearly anything flagged is a false alarm, or a deliberate style choice.

## 2026-10-22, commit a999dd0

**Learner sentences (JFLEG):**

| system | precision | recall | recall without spelling | correct sentences changed |
|---|---|---|---|---|
| Harper alone (its first suggestion) | 52.2% | 23.7% | 10.3% | 2 / 32 |
| Margin, local ([report](2026-10-22-human-local-gemma4-26b.md)) | 71.8% | 26.7% | 28.5% | 0 / 32 |
| Margin, hosted ([report](2026-10-22-human-hosted-gemma4-26b.md)) | 75.1% | 14.7% | 15.9% | 0 / 32 |
| Margin, local, prompt v3 ([report](2026-10-22-human-local-v3.md)) | 74.9% | 19.7% | 20.0% | 0 / 32 |
| **Harper + Margin, local** | 60.2% | **45.7%** | 35.9% | 2 / 32 |
| Harper + Margin, hosted | 58.8% | 35.7% | 24.6% | 2 / 32 |
| Harper + Margin, local, prompt v3 | 59.3% | 39.5% | 27.9% | 2 / 32 |

"Recall without spelling" leaves out one-word spelling and capitalization fixes, which Margin leaves to Harper. Precision here is a lower bound: an edit that differs from all four human corrections counts as wrong even when it is a valid fix.

**Published prose:**

| | Harper | Margin, local | Margin, hosted |
|---|---|---|---|
| flags per 1,000 words | 24.2 | 3.3 (v3: 2.4) | 2.0 |
| sentences changed | | 46 of 719 (6.4%); v3: 36 (5.0%) | 30 of 719 (4.2%) |

**Prompt v3 (below) trades some recall for precision:** on learner sentences Harper + Margin drops from 45.7% to 39.5% (many of JFLEG's human corrections add optional commas, which v3 leaves alone), while Margin's own precision rises and it changes fewer sentences of published prose. The hosted rows are prompt v2.

**What this says:**
- Adding Margin roughly doubles what gets caught in learner writing (Harper alone 23.7% of the human corrections, with local Margin 45.7%), and Margin's own edits are more precise than Harper's.
- Margin never changed a JFLEG sentence that all four people left alone.
- On polished fiction, local Margin suggests a change in about 1 sentence in 16. Some are real (it found "ware" for "were" in the Keynes text, which Harper misses because "ware" is a word), but most "fix" deliberate style: comma splices in dialogue, dialect ("old Bingham Playfair, that died"), the subjunctive ("if my figure prove"), and optional commas after introductory clauses. Each report lists every changed sentence.
- Local finds more than hosted on the same weights, and also flags more on clean text.

**Fixed because of these runs (commit 4d09a2a):** the sentence splitter broke quoted speech like “You promised!” into his ear. and split after initials ("M. Loucheur"), so the model "fixed" fragments; and the model sometimes changed a sentence while saying "No changes needed", which is now rejected.

**Caveats:** one model, two corpora, word-level matching against human references. JFLEG is learner English, not native writing; the books are 100 years old.

# Real documents, in the real apps (2026-10-22, local model)

What people will actually run Margin on, with Harper installed next to it and the local model (`gemma4:26b-a4b-it-qat` on Ollama 0.40.7, RX 9070 XT 16 GB). Fetch the documents with `pnpm -F @margin/eval fetch-real`; they're downloaded at run time and never committed.

- **Docs** (VS Code, Obsidian, margin-ls): 12 READMEs, contributing guides and docs pages from Ollama, VS Code, Node.js, Deno, Zed, uv, Excalidraw, Vite, Docusaurus, MDN, the Rust Book and Obsidian's help. 11,000 words.
- **Issues** (browser): 20 recent GitHub issues from Ollama, VS Code, Excalidraw and Home Assistant, typed into a comment box. 4,600 words.

## What Margin flags, labelled

Every Margin underline on the docs and issues was labelled by hand (by the maintainer's AI assistant, not checked by a second person): a real error fixed, an optional style change, or wrong. Run headless (`pnpm -F @margin/eval eval-real`), Harper first as in the apps.

| prompt | Margin underlines | real fixes | optional style | wrong |
|---|---|---|---|---|
| v2, before the splitter fixes | 39 | 17 (44%) | 15 (38%) | 7 (18%) |
| v2, after the splitter fixes | 33 | 15 (45%) | 16 (48%) | 2 (6%) |
| **v3 (current)** | **23** | **13 (57%)** | **7 (30%)** | **3 (13%)** |

Harper made 714 flags on the same text. Real fixes look like "following instructions are" → "the following instructions are", "Translate your site in multiple locales" → "into", "both … provides" → "provide", "ease to set up" → "ease of setup", "It like a lock mechanism" → "It is like". Wrong ones: "The series are named `Series 1` and `Series 2`" → "is"; "uv extends their interfaces" → "its" ("their" meant the tools uv replaces); "Confirming interest early and following this guide give" → "gives".

**Fixed because of this run:** the sentence splitter split inside a link target (`/showcase?…`), and Vite's `:::` admonition fences were treated as part of a sentence, so two "fixes" deleted an emoji and a fence. **Prompt v3** tells the model not to add optional punctuation (commas after introductory phrases, hyphens, dashes), not to edit names or technical terms, and to leave headings and list items alone. On the synthetic fixtures it scored 100% precision, 92.1% recall, 0 of 71 correct sentences changed ([report](2026-10-22-local-v3-b8-c1.md)), against 93.7% before.

## In each app

| app | documents | Harper | Margin | same spot as Harper | first Margin underline |
|---|---|---|---|---|---|
| [VS Code](2026-10-22-app-vscode-local.json) | 12 docs | 425 | 17 | **0** | 2.4–19 s after opening (longer docs take longer) |
| [Obsidian](2026-10-22-app-obsidian-local.json) | 12 docs | 425 | 15 | **0** | note fully checked 1.8–19 s after opening |
| [Chrome](2026-10-22-app-chrome-local.json) | 20 issues | 661 | 6 | 1 | 4–7 s after the text arrived |
| [Firefox](2026-10-22-app-firefox-local.json) | 20 issues | 35 | 4 | 1 | 4–9 s |

- VS Code and Obsidian read Harper's own results, so Margin never marks a spot Harper marks. The browser extension can't read another extension's results; it checks with its bundled copy of harper.js, which can disagree with Harper's extension (here once, on "information").
- Times include Margin's 2 s pause before checking. The first check after Ollama starts also loads the model (20–40 s).
- Harper's Firefox extension showed no underlines on 11 of the 20 issues (Chrome's on 1). We didn't investigate.
- The Chrome run may have used the build from before prompt v3; the other three used v3.
- In the browser, Markdown is plain text, so Harper flags code and logs too (661 flags vs 289 when the same issues are linted as Markdown).

# Rewrite and tone (2026-10-22, local model)

40 real prose paragraphs from the docs and issues above, each rewritten with every preset ([numbers](2026-10-22-rewrite-local-gemma4-26b.json), `pnpm -F @margin/eval rewrite-bench`). A rewrite has no single right answer, so this measures what can be checked.

| preset | finished | length (median) | words changed (median) | Harper errors, 52 before → after | contractions, 8 before → after | "!" 1 before → after | time (median) |
|---|---|---|---|---|---|---|---|
| Improve | 40/40 | 100% | 7% | 44 | 6 | 0 | 1.4 s |
| Concise | 40/40 | 80% | 30% | 41 | 1 | 0 | 1.2 s |
| Formal | 40/40 | 104% | 23% | 39 | 0 | 0 | 1.4 s |
| Friendly | 40/40 | 112% | 27% | 42 | 41 | 11 | 1.5 s |
| Fix only | 40/40 | 100% | 0% | 44 | 11 | 1 | 1.3 s |

- Each preset does what it says: Concise cuts a fifth, Formal drops every contraction, Friendly adds them (and exclamation marks). No rewrite added errors that Harper catches.
- Margin warns before you accept a rewrite that changed negation or numbers: 1–6 times per 40 paragraphs. The ones we read were false alarms ("can't really focus" → "too busy to focus"), so this check is noisier than it should be.
- "Fix only" left the median paragraph untouched, but its added contractions show it still makes small changes.
