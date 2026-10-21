# Eval results

Fixtures: `../fixtures/` (synthetic, MIT): 59 sentences with one error each (several acceptable fixes listed per item), 68 correct sentences (many are deliberate bait: informal style, negation, numbers, quotes, British spellings), and 10 Markdown cases (code, links, URLs, emails, math, HTML, emoji, CJK). Debatable items are reported but not scored.

Scoring: **precision** = correct fixes / every change Margin made (wrong fixes and changes to correct sentences both count against it). **Recall** = correct fixes / errors. A fix counts as correct only if it matches one of the accepted versions. Harper's ranges are not passed to Margin here, so this measures Margin alone; "+ Harper recall" counts errors fixed by Margin *or* already flagged by Harper.

## 2026-10-21, hosted Gemma 4 26B A4B (Gemini API)

| run | batch | parallel calls | precision | recall | F0.5 | correct sentences changed | correct / wrong / missed | + Harper recall | calls | time |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline (commit 8a58e91)  | 8 | 2 | 98.1% | 82.3% | 0.944 | 0 / 70 | 51 / 1 / 10 | 85.5% | 18 | 30.7 s |
| b8-c2 #1 (07fc072) | 8 | 2 | **100%** | **82.3%** | **0.959** | **0 / 70** | 51 / 0 / 11 | 85.5% | 18 | 31.9 s |
| b8-c2 #2 (07fc072) | 8 | 2 | 100% | 82.3% | 0.959 | 0 / 70 | 51 / 0 / 11 | 85.5% | 18 | 30.5 s |
| b4-c2 (07fc072) | 4 | 2 | 98.1% | 82.3% | 0.944 | 0 / 70 | 51 / 1 / 10 | 85.5% | 35 | 44.9 s |
| b15-c1 (07fc072) | 15 | 1 | 100% | 69.4% | 0.919 | 0 / 70 | 43 / 0 / 19 | 75.8% | 10 | 75.5 s |

**Decisions:** batch 8, 2 calls in parallel. Larger batches cost recall (matching arXiv 2609.10810); smaller ones cost time with no gain.

**What it misses:** mostly missing articles ("postpone launch", "before meeting", "due end of the month"), and "Between you and I" / "could care less" in some runs. It never changed a correct sentence.

**The one wrong fix (baseline):** the model leaked a stray `[]` into a corrected sentence ("lose the[]backup drive"). A comma-splice fix elsewhere was blocked by the Markdown guard for a similar stray character. The guard now also rejects added or removed `[ ] < > | #` (commit 07fc072), and later runs had no wrong fixes.

**Rate limits:** running evals back to back with 2 parallel calls hit Gemini's per-minute quota for Gemma (the daily quota was fine). Margin's VS Code engine waits 30 s on a 429; the AI SDK's own retries alone are too short for per-minute quotas.

**Caveats:** one model, one fixture set we wrote ourselves, 137 items. These numbers say the approach works on this model; they aren't a benchmark. The local path (same weights, 4-bit) was not evaluated.
