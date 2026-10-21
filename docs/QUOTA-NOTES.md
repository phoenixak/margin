# ai-sdk-quota notes

> **Deferred, 2026-10-21:** Margin v1 is local-only and doesn't use ai-sdk-quota. These notes stay as feedback for the library and for a possible later cloud tier. The tests that backed them were in `spike/quota/` (removed; see git history at `2c460aa`).

Phase 0, 2026-10-21. Library at `../../ai-sdk-quota` commit `ee9e776`, installed from a `pnpm pack` tarball (`vendor/ai-sdk-quota-0.0.0.tgz`, gitignored). Tests: `spike/quota/quota.test.ts` (mock models, no network; 13 passing).

Single copy check: `ai@7.0.148`, `@ai-sdk/provider@4.0.31`, one copy each in the lockfile. No "LanguageModelV4 is not assignable" errors.

## Answers to PLAN §6.6

**1. A member with no limits (local server).** Omit `limits`. The member is unlimited: 500 calls go through, `headroom` stays 1, `usage` is `{}`. No `UNLIMITED` constant is needed. *Test: Q1.*

**2. Order and filters.** Default strategy `'priority'` = the order of `models` (also `'most-headroom'`, `'weighted'`). Filters per call: `exclude: string[]` (tags) and `require: ('tools'|'vision'|'json')[]` (capabilities, where `capabilities.json === false` means unsupported; missing means supported). There is **no include-by-tag filter**; privacy modes only need `exclude`, so that's fine. *Tests: Q2.*

**3. Aborts. Gap.** A caller abort is classified `fatal`: no cooldown, no fall-through to the next member (good). But the reservation is **committed at its estimate**, not released: 100 aborted calls → `rpd.used = 100` and `tpd.used ≈ 100 × (input + ~512)`. That happens even when the signal was already aborted before the call (`rpd.used = 1` for a call that never left the process). On Groq's 200K TPD, about 400 editor aborts would burn the day. *Tests: Q3.* → UPSTREAM #1.
Margin workaround: never call the pool with an already-aborted signal; always pass `maxOutputTokens` (the pool reserves `min(running average, maxOutputTokens)` output tokens); debounce so aborts are rare.

**4. Persistence across restarts and windows. Gap.** `memoryStore()` is per process. There are shared stores for Redis, Upstash and Postgres, but nothing suitable for a desktop app. `createScriptedStore(backend: StoreBackend)` is exported, so a file- or SQLite-backed store can be built outside the library, but the store contract suite (`test/store-contract.ts`) isn't exported, so a third-party store can't prove itself against it. → UPSTREAM #2 and #3.
Note: cooldowns, sticky members and adaptive factors also live in the store, so a persistent shared store carries them across windows too.

**5. Two pools, one store.** Yes: counters are keyed `m:<memberId>` (groups `g:<id>`, budgets `b:<key>`), so two pools with the same member ids share counters, cooldowns and stickiness. Margin must keep member ids stable and unique per provider account. *Test: Q5.*

**6. Which member answered.** `result.providerMetadata.aiSdkQuota = { memberId, provider, modelId }` on `generateText`, and on streams via the `finish` part (`await result.providerMetadata`). Also the `route` event. *Tests: Q6.*

**7. Structured output in a mixed pool. Gap.**
- A 400/422 is `fatal`: rethrown, next member never tried. A member that rejects `response_format` kills the call. *Test.*
- A call with `Output.object` (`responseFormat.type === 'json'`) does **not** automatically `require: ['json']` the way tool calls require `tools`. Margin can pass `require: ['json']` itself, so this is a convenience gap. *Test.*
- `NoObjectGeneratedError` (bad JSON in a 200) happens in `generateText` after the pool returned: to the pool it's a success (`route`, `reconcile`, no `fail`), sticky is set, and no other member is tried. *Test.* → UPSTREAM #4.

**8. `probe` as a library. Gap (small).** `probe()` exists in `src/probe.ts` but is only bundled into the CLI; it's not exported from any entry point. *Test: Q8.* → UPSTREAM #5.

## Other facts Margin relies on

- `maxRetries: 0` is required (the AI SDK retries around the pool otherwise).
- Streams switch members only before the first visible chunk, and the first-token timeout (20 s default) doesn't apply to the last candidate.
- Output tokens are estimated as `min(running average per member, maxOutputTokens)`, starting at 512 (`expectedOutputTokens`).
- `budgets.perKey` + `budgetKey` implements the daily cap (PLAN §6.5) as planned; `pool.remaining('margin')` reads it.
- Registry ids for limits: `'groq:free'`, `'gemini:free'`, `'openrouter:free'` (resolved by model id; OpenRouter members also charge the shared `openrouter:free-daily` group).
