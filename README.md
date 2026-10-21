# Margin

**An optional AI second pass for [Harper](https://writewithharper.com).** Harper's fast, rule-based checks stay in charge. Margin uses an LLM only for what rules can't catch: agreement across clauses, tense, wrong-but-real words, missing or repeated words, run-ons and comma splices. It also rewrites or changes tone when you ask.

Margin is an independent project. It is not made by or affiliated with Harper or Automattic.

> **Status: early.** The core and a CLI work. The VS Code extension, browser extension, language server and Obsidian plugin are planned ([docs/PLAN.md](docs/PLAN.md)).

## What's tested, honestly

| Path | Status |
|---|---|
| **Hosted Gemma 4 26B A4B** through Google's Gemini API, with your own key | **Tested.** On Margin's eval (137 synthetic items) it scored 100% precision and 82% recall, and changed **0 of 70** correct sentences. See [the eval report](packages/eval/results/README.md). |
| **Local models** (Ollama / LM Studio, e.g. `gemma4:26b-a4b-it-qat`) | **Implemented, not tested.** The maintainer couldn't download the multi-GB weights. It should behave like the hosted model, but nobody has checked. Turning Gemma 4's "thinking" off locally is unverified. If you try it, please open an issue with your model, hardware and results. |
| Small models (under ~9B) | Research shows they over-correct noticeably. Margin will only allow automatic checking for models that pass its eval. |

## Where your text goes

- **Gemini provider:** the sentences being checked are sent to Google's Gemini API with your key. On the free tier, Google may use content to improve its products. Code blocks, URLs, emails and similar are masked before sending.
- **Local provider:** nothing leaves your machine.
- Margin has no server, no accounts and no telemetry. It never logs your text.

## How it works

Margin splits Markdown into prose sentences (skipping code, tables and front matter), masks protected spans, and asks the model to return only the sentences it changed. The model never gives positions. Margin diffs each sentence itself, so underlines are always exact. Guards reject over-edits, negation flips, changed numbers or quotes, and style changes Harper owns. Anything Harper already flagged is left to Harper.

## Try the CLI

```sh
pnpm install && pnpm build
echo "GEMINI_API_KEY=..." > .env       # gitignored
node packages/cli/dist/cli.js check fixtures/sample.md
node packages/cli/dist/cli.js rewrite fixtures/sample.md --preset concise --lines 6-8
node packages/cli/dist/cli.js check notes.md --provider local   # untested path
```

## License

MIT
