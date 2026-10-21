# Margin

**An optional AI second pass for [Harper](https://writewithharper.com).** Harper's fast, rule-based checks stay in charge. Margin uses an LLM only for what rules can't catch: agreement across clauses, tense, wrong-but-real words, missing or repeated words, run-ons and comma splices. It also rewrites or changes tone when you ask.

Margin is an independent project. It is not made by or affiliated with Harper or Automattic.

> **Status: early.** Built: the core, a CLI, a VS Code extension, a Chrome/Firefox extension, a language server ([margin-ls](packages/ls/README.md): Neovim, Helix, Sublime, Emacs) and an [Obsidian plugin](packages/obsidian/README.md). Tested in real apps so far: VS Code, Chrome. See [docs/PLAN.md](docs/PLAN.md).

## What's tested, honestly

| | Hosted Gemma 4 26B A4B (Gemini API) | Local model (Ollama / LM Studio) |
|---|---|---|
| Check quality | **Eval: 100% precision, 82% recall, 0 of 70 correct sentences changed** on 137 synthetic items ([report](packages/eval/results/README.md)) | Not run. Same weights as the hosted model, so it should be close. Please [report](.github/ISSUE_TEMPLATE/local-model-report.yml) |
| CLI | Tested | Error handling tested (no server); a real run is not |
| VS Code | Tested in VS Code 1.142 (check, quick fixes, rewrite) | Model picker built; not run |
| Chrome | Tested alongside Grammarly (check, Apply, rewrite, undo) | Not run |
| Firefox | Built, not run | Not run |
| margin-ls | Protocol tests + a real stdio run; editor configs written from docs, not tried | Not run |
| Obsidian | Bundle loads; not run inside Obsidian | Not run |

Small models (under ~9B) tend to over-correct, according to research and the eval's design. Margin only lets models that pass its eval check automatically while you type.

## Where your text goes

- **Gemini provider:** the sentences being checked are sent to Google's Gemini API with your key. On the free tier, Google may use content to improve its products. Code blocks, URLs, emails and similar are masked before sending.
- **Local provider:** nothing leaves your machine.
- Margin has no server, no accounts and no telemetry. It never logs your text.

## Install

- **VS Code:** [Margin on the Marketplace](https://marketplace.visualstudio.com/items?itemName=phoenixak.margin-ai), or `code --install-extension phoenixak.margin-ai`. It installs Harper's extension too.
- **Browser, margin-ls, Obsidian, CLI:** from source for now (see below and each package's README).

## Use a local model (text never leaves your computer)

1. Install [Ollama](https://ollama.com) (or [LM Studio](https://lmstudio.ai)).
2. Pull the recommended model (about 18 GB; needs a ~16 GB GPU, or a smaller GPU plus plenty of RAM):
   `ollama pull gemma4:26b-a4b-it-qat`
3. In VS Code: **Margin: Choose where text is checked… → Local model**. Margin finds Ollama/LM Studio and lists your models.
4. In the browser extension, Ollama refuses extension requests by default. Allow them once:
   - Windows: `setx OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*"`, then quit Ollama from the tray and start it again
   - macOS: `launchctl setenv OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*"`, then restart Ollama
   - Linux: `OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*" ollama serve`
   - LM Studio: turn on **Enable CORS** in the server settings

   The options page detects this and shows the right command.
5. Check what you have: `node packages/cli/dist/cli.js models`.

**Honest status:** this path is implemented but the maintainer hasn't been able to test it (limited bandwidth for multi-GB downloads). `gemma4:26b-a4b-it-qat` has the same weights as the hosted model that passed the eval, so it should behave the same. **If you run it, please run the eval and open an issue with the results:**

```sh
node packages/eval/src/run.ts --provider local --model gemma4:26b-a4b-it-qat --label local-test
```

Smaller models (under ~9B) tend to over-correct; the eval will show it.

## Browser extension (Chrome, Firefox)

Build it with `pnpm -F @margin/browser build`, then load `packages/browser/dist/chrome` (chrome://extensions → Developer mode → Load unpacked) or `packages/browser/dist/firefox` (about:debugging → Load Temporary Add-on → manifest.json).

- It checks text fields only on sites you turn on from its toolbar button; nothing runs elsewhere.
- The right-click **Margin: rewrite** menu works on any page.
- Harper runs inside the extension for dedup (browser extensions can't read each other), so Margin never repeats what Harper flags.
- The Gemini key, if you use Gemini, is stored in the browser's extension storage, which is not encrypted.
- Google Docs isn't supported.

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
