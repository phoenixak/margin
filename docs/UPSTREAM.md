# Upstream requests for ai-sdk-quota

> **Deferred, 2026-10-21:** Margin v1 is local-only and doesn't use ai-sdk-quota. These notes stay as feedback for the library and for a possible later cloud tier. The tests that backed them were in `spike/quota/` (removed; see git history at `2c460aa`).

Gaps Margin found in `ai-sdk-quota` (commit `ee9e776`). Margin doesn't edit the library; each entry has the need, why, an API sketch and a test that would prove it. Evidence: `spike/quota/quota.test.ts`, write-up in `QUOTA-NOTES.md`.

Ordered by how much they matter before the npm release (planned 2026-10-22). #1 and #4 change behavior, so they're cheaper to settle before 0.1.0.

## 1. Aborted calls shouldn't spend their full estimate

**Need.** When the caller aborts, release the reservation if nothing reached the provider, and otherwise commit only what was plausibly used.
**Why.** Editors abort constantly (every keystroke during a pending check). Today an abort commits the full estimate: 1 request + input + ~512 output tokens. That includes a signal that was already aborted before the call started. 100 aborts → `rpd.used = 100`, `tpd.used ≈ 55K`. On Groq's free 200K TPD, a few hundred aborts burn the day.
**Sketch.**
- `run()`: if `callOptions.abortSignal?.aborted` before reserving → throw the abort reason without reserving.
- In the `catch`: when `callerAborted` and the member threw before resolving (`doGenerate` pending / `doStream` not yet resolved), commit with `{ input: est.input, output: 0 }`: the request was likely sent and the prompt counted, but no output was produced. When aborting mid-stream, `holdUntilFirstChunk`'s `onSettle` already gets partial usage (or none); fall back to `output: tokens seen so far`.
- Optionally `abortCharge?: 'estimate' | 'input-only' | 'release'` (default `'input-only'`).
**Test.** 100 calls aborted right after start, with `limits: { rpd: 1000, tpd: 1e6 }`: `rpd.used === 100` (requests did go out), `tpd.used <= 100 × inputEstimate`. A pre-aborted signal: `rpd.used === 0` and the model's `doGenerateCalls.length === 0`.

## 2. A persistent, multi-process store for desktop apps

**Need.** A store that survives restarts and is shared safely by several processes on one machine (each VS Code window has its own extension host).
**Why.** `memoryStore()` loses daily windows on restart, and two windows double-spend the same key. Redis/Postgres/Upstash are server-side answers; a desktop editor has none of them.
**Sketch.** `ai-sdk-quota/stores/sqlite`: `sqliteStore(path)` on Node's built-in `node:sqlite` (`DatabaseSync`; available in the Node 24 here, **verify** in VS Code's Electron Node). WAL mode, `BEGIN IMMEDIATE` per backend op for cross-process atomicity, implemented as a `StoreBackend` for `createScriptedStore` (the same SQL as the Postgres store, minus the advisory lock). No new dependency.
**Test.** The store contract suite with `shared: true`, plus a two-process test: two `child_process`es each reserve 60 times against `rpd: 100` on one file → exactly 100 succeed in total.
**Margin fallback** if this doesn't go upstream: build the same `StoreBackend` in Margin (Phase 3).

## 3. Export the store contract suite

**Need.** `import { describeStoreContract } from 'ai-sdk-quota/testing'`.
**Why.** `createScriptedStore` and `StoreBackend` are public, so third parties can write stores, but they can't run the suite that defines a correct store (`test/store-contract.ts` isn't shipped).
**Sketch.** Move it to `src/testing.ts` (vitest as an optional peer), with an extra tsup entry and `exports["./testing"]`.
**Test.** Margin's own store (if #2 stays in Margin) runs `describeStoreContract('margin-file', make, { shared: true })` from the published package.

## 4. Structured output in a mixed pool

**Need.** (a) A call with `responseFormat.type === 'json'` requires `json` automatically, like tools do. (b) A 400 caused by an unsupported request feature shouldn't kill the whole call. (c) A hook to treat a bad 200 as a member failure.
**Why.** Margin's check mode uses `Output.object`. A member that rejects `response_format` returns 400 → rethrown, and the other members are never tried. Bad JSON in a 200 → `NoObjectGeneratedError` *after* the pool returned, so it's counted as a success and the member stays sticky.
**Sketch.**
- (a) In `run()`: `if (callOptions.responseFormat?.type === 'json' && !require.includes('json')) require.push('json')`.
- (b) `PoolMember.capabilities` already exists, so (a) mostly covers it. Optionally classify a 400 whose body mentions `response_format`/`json_schema` as `retryable` with a `capability` failure reason.
- (c) `pool.model({ validate?: (result: LanguageModelV4GenerateResult) => boolean | Promise<boolean> })`: if it returns false, record a `fail` (kind `'invalid-output'`), commit usage, apply a short cooldown, and try the next member. For `doGenerate` only (streams commit at the first chunk).
**Tests.** (a) `[{ json: false }, {}]` with `Output.object` → routes to the second. (c) First member returns `'not json'`, `validate` parses → the second member answers and events are `route, reconcile, fail, route, reconcile`.

## 5. Export `probe()`

**Need.** `import { probe } from 'ai-sdk-quota/probe'` (or from the main entry).
**Why.** An in-editor "Check my limits" command: probe each configured key and show the real limits. Today `probe` is only bundled into the CLI.
**Sketch.** Add `probe`, `formatReport` and `ProbeReport` to an entry point. It already takes `fetch` and `apiKey` as options, so it's library-ready.
**Test.** `typeof (await import('ai-sdk-quota/probe')).probe === 'function'`, and the existing probe tests run against the export.

## Not gaps (for the record)

- Unlimited members: omit `limits` (works).
- An include-by-tag filter: not needed; privacy modes are expressed with `exclude`.
