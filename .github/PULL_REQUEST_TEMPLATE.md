## What and why

<!-- What this changes, and the problem it solves. Link the issue if there is one. -->

## Checks

- [ ] `pnpm typecheck` and `pnpm test` pass (unit tests use mock models, no network)
- [ ] If this changes what Margin suggests (prompt, guards, sentence splitting): `pnpm -F @margin/eval eval -- --provider local` before and after, numbers below
- [ ] No document text in logs, tests or fixtures; no API keys anywhere
- [ ] README's "What's tested" still matches reality

## Eval (if relevant)

<!-- Paste the before/after table. -->
