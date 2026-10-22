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
| **Harper + Margin, local** | 60.2% | **45.7%** | 35.9% | 2 / 32 |
| Harper + Margin, hosted | 58.8% | 35.7% | 24.6% | 2 / 32 |

"Recall without spelling" leaves out one-word spelling and capitalization fixes, which Margin leaves to Harper. Precision here is a lower bound: an edit that differs from all four human corrections counts as wrong even when it is a valid fix.

**Published prose:**

| | Harper | Margin, local | Margin, hosted |
|---|---|---|---|
| flags per 1,000 words | 24.2 | 3.3 | 2.0 |
| sentences changed | | 46 of 719 (6.4%) | 30 of 719 (4.2%) |

**What this says:**
- Adding Margin roughly doubles what gets caught in learner writing (Harper alone 23.7% of the human corrections, with local Margin 45.7%), and Margin's own edits are more precise than Harper's.
- Margin never changed a JFLEG sentence that all four people left alone.
- On polished fiction, local Margin suggests a change in about 1 sentence in 16. Some are real (it found "ware" for "were" in the Keynes text, which Harper misses because "ware" is a word), but most "fix" deliberate style: comma splices in dialogue, dialect ("old Bingham Playfair, that died"), the subjunctive ("if my figure prove"), and optional commas after introductory clauses. Each report lists every changed sentence.
- Local finds more than hosted on the same weights, and also flags more on clean text.

**Fixed because of these runs (commit 4d09a2a):** the sentence splitter broke quoted speech like “You promised!” into his ear. and split after initials ("M. Loucheur"), so the model "fixed" fragments; and the model sometimes changed a sentence while saying "No changes needed", which is now rejected.

**Caveats:** one model, two corpora, word-level matching against human references. JFLEG is learner English, not native writing; the books are 100 years old.
