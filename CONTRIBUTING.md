# Contributing to Margin

Thanks for helping. Margin is a small project, so issues and pull requests both get read.

## Ways to help that need no code

- **Try another model or LM Studio** and post a [model review](https://github.com/phoenixak/margin/issues/new?template=model-review.yml). Local models other than `gemma4:26b-a4b-it-qat` are untested, and this is the most useful thing anyone can do right now.
- **Report wrong or missed suggestions** with a made-up sentence that shows the problem ([template](https://github.com/phoenixak/margin/issues/new?template=suggestion.yml)).
- **👍 a [provider request](https://github.com/phoenixak/margin/issues?q=is%3Aissue+label%3Aprovider)** you'd use.

## Setup

Node 22 or newer and pnpm.

```sh
pnpm install
pnpm build        # every package
pnpm typecheck
pnpm test         # unit tests: mock models only, never the network
```

- `packages/core`: the editor-agnostic pipeline (sentence splitting, masking, prompts, guards, diffing). Most changes land here, with tests in `packages/core/test`.
- `packages/vscode`, `packages/browser`, `packages/obsidian`, `packages/ls`, `packages/cli`: the adapters. Each has a README.
- `packages/eval`: the benchmarks. See its [results README](packages/eval/results/README.md).
- The Obsidian plugin is published from a generated repo, [margin-obsidian](https://github.com/phoenixak/margin-obsidian). Edit `packages/obsidian` here, not there.

## Changing what Margin suggests

The prompt, the guards and the sentence splitter decide what users see, so changes there need numbers:

```sh
pnpm -F @margin/eval eval -- --provider local --label before   # on main
pnpm -F @margin/eval eval -- --provider local --label after    # on your branch
```

Precision comes first: a change that finds more errors but also changes correct sentences usually isn't worth it. The human-text and real-document evals (`fetch-human` / `eval-human`, `fetch-real` / `eval-real`) are slower but closer to real use.

## Rules the code keeps

- Nothing is sent anywhere until the user picks a provider, and Margin never logs, stores or commits document text. Tests and fixtures use made-up or public-domain text.
- API keys live only in each platform's secret store.
- The model returns corrected sentences; Margin computes the edits itself. Models never produce positions.
- Margin doesn't repeat Harper's lints and never polishes correct text in check mode.
- The README's "What's tested" table must match what was actually tested.

## Adding a model provider

`createModel()` in `packages/core/src/model.ts` shows the pattern (Gemini and OpenAI-compatible). Open a [provider request](https://github.com/phoenixak/margin/issues/new?template=provider-request.yml) first, so we can agree on how keys and data use are shown to the user.
