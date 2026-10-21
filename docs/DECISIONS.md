# Decisions

Newest first. Each entry: the decision, why, and what it changed.

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

- **Output format (A vs B), capability tags and starting members:** wait on the format spike. `spike/format/run.ts` and its synthetic fixture are ready. It needs a local server (Ollama is not installed on the dev machine yet). Cloud runs need Phoenix's OK and keys, after quotas reset.
