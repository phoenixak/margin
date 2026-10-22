# Margin

**An optional AI second pass for [Harper](https://writewithharper.com).** Harper's fast, rule-based checks stay in charge. Margin uses an LLM only for what rules can't catch: agreement across clauses, tense, wrong-but-real words, missing or repeated words, run-ons and comma splices. It also rewrites or changes tone when you ask.

Margin is an independent project. It is not made by or affiliated with Harper or Automattic.

![Margin in VS Code: Harper underlines in blue, Margin in yellow; hovering "stay" shows Margin's suggestion, and the quick fix changes it to "stays"](https://raw.githubusercontent.com/phoenixak/margin/main/packages/vscode/images/demo.gif)

*Harper's suggestions in blue, Margin's in yellow (`"margin.severity": "warning"`; the default is the same blue as Harper). Local Gemma 4 on Ollama.*

> **Status: early, and everything is published or in store review.** Built: the core, a CLI, a VS Code extension, a Chrome/Firefox extension, a language server ([margin-ls](packages/ls/README.md): Neovim, Helix, Sublime, Emacs) and an [Obsidian plugin](packages/obsidian/README.md). See [docs/PLAN.md](docs/PLAN.md).

## What's tested, honestly

Both paths use the same model, Gemma 4 26B A4B: on your own machine through Ollama (`gemma4:26b-a4b-it-qat`), or hosted through the Gemini API. Every app below was tested with Harper installed next to Margin.

| | Local (Ollama) | Hosted (Gemini API) |
|---|---|---|
| Synthetic eval (140 items we wrote) | **100% precision, 92.1% recall, 0 of 71 correct sentences changed** | 100% precision, 80.6% recall, 0 of 70 changed (137 items, earlier prompt) |
| Real docs: 12 READMEs and docs pages from popular projects | Harper: 425 flags. **Margin: 17 more; 57% fix real errors, 30% optional style, 13% wrong** | Not run (we don't send other people's documents to a hosted API) |
| Real learner writing ([JFLEG](https://github.com/keisks/jfleg), 747 sentences) | Harper alone catches 23.7% of the human corrections; **with Margin, 39.5%**. Margin's own edits: 74.9% precision | With Margin, 35.7% (earlier prompt) |
| Published books (16,600 words of edited prose) | Suggests a change in 5.0% of sentences, mostly to deliberate style | 4.2% (earlier prompt) |
| Speed | ~0.75 s per sentence on learner text, ~0.1 s on docs (code and lists are skipped); RX 9070 XT (16 GB). The first call loads the model (20–40 s) | ~1.1 s per sentence on the free tier |
| CLI | Tested | Tested |
| VS Code | **Tested** on the 12 docs: first underline 2–19 s after opening, never on a spot Harper marks | Tested in VS Code 1.142 (check, quick fixes, rewrite) |
| Obsidian | **Tested** on the 12 docs with Harper's plugin: no duplicates | Not run |
| Chrome | **Tested** on 20 real GitHub issues: underlines 4–7 s after typing; 1 duplicate of Harper's in 6 | Tested alongside Grammarly (check, Apply, rewrite, undo) |
| Firefox | **Tested** on the same issues: 4–9 s | Tested (check, rewrite) |
| margin-ls | Protocol tests + a real stdio run; editor configs written from docs, not tried | Same |
| LM Studio, other models | Not tested. Please post a [model review](https://github.com/phoenixak/margin/issues/new?template=model-review.yml) | |

Full numbers, how they were measured, and what changed because of them: [eval results](packages/eval/results/README.md). "Wrong" and "optional style" were labelled by the maintainer's AI assistant, not by a second person. Local and hosted runs differ even with the same weights, so each is measured separately. Smaller models (under ~9B) tend to over-correct.

## Where your text goes

- **Gemini provider:** the sentences being checked are sent to Google's Gemini API with your key. On the free tier, Google may use content to improve its products. Code blocks, URLs, emails and similar are masked before sending.
- **Local provider:** nothing leaves your machine.
- Margin has no server, no accounts and no telemetry. It never logs your text.

## Install

Margin needs Harper installed alongside it.

- **VS Code:** [Margin on the Marketplace](https://marketplace.visualstudio.com/items?itemName=phoenixak.margin-ai) or [Open VSX](https://open-vsx.org/extension/phoenixak/margin-ai) (VSCodium, Cursor, Windsurf), or `code --install-extension phoenixak.margin-ai`. It installs Harper's extension too.
- **Chrome:** [Margin on the Chrome Web Store](https://chromewebstore.google.com/detail/margin-ai-second-pass-for/bjpeephdhfhplfapahlnnjdkgmejnpfl). Use it alongside Harper's browser extension.
- **Firefox:** in review on Firefox Add-ons. Until then, build from source (below).
- **Obsidian:** **Margin AI Proofreader** in the [community plugins](https://community.obsidian.md/plugins/margin-ai-proofreader) (Settings → Community plugins → Browse). Needs Harper's Obsidian plugin.
- **Neovim, Helix, Emacs, Sublime, Zed:** [margin-ls](packages/ls/README.md), from source.

## Use a local model (text never leaves your computer)

1. Install [Ollama](https://ollama.com) (or [LM Studio](https://lmstudio.ai)).
2. Pull the recommended model (15.6 GB download; wants a 16 GB GPU, or a smaller GPU plus plenty of RAM, which is slower):
   `ollama pull gemma4:26b-a4b-it-qat`
3. In VS Code: **Margin: Choose where text is checked… → Local model**. Margin finds Ollama/LM Studio and lists your models.
4. In the browser extension, Ollama refuses extension requests by default. Allow them once:
   - Windows: `setx OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*"`, then quit Ollama from the tray and start it again
   - macOS: `launchctl setenv OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*"`, then restart Ollama
   - Linux: `OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*" ollama serve`
   - LM Studio: turn on **Enable CORS** in the server settings

   The options page detects this and shows the right command.
5. Check what you have: `node packages/cli/dist/cli.js models`.

Tried another model or different hardware? Run the two evals and post a [model review](https://github.com/phoenixak/margin/issues/new?template=model-review.yml):

```sh
pnpm -F @margin/eval eval -- --provider local --model <model> --label <name>
pnpm -F @margin/eval fetch-human
pnpm -F @margin/eval eval-human -- --provider local --model <model> --label <name>
```

## Browser extension (Chrome, Firefox)

Build it with `pnpm -F @margin/browser build`, then load `packages/browser/dist/chrome` (chrome://extensions → Developer mode → Load unpacked) or `packages/browser/dist/firefox` (about:debugging → Load Temporary Add-on → manifest.json).

- It checks text fields only on sites you turn on from its toolbar button; nothing runs elsewhere.
- The right-click **Margin: rewrite** menu works on any page.
- Use it alongside [Harper's browser extension](https://writewithharper.com). Browser extensions can't read each other's results, so Margin bundles Harper's engine ([harper.js](https://www.npmjs.com/package/harper.js), Apache-2.0) only to skip what Harper already flags; it never shows Harper's errors itself.
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
node packages/cli/dist/cli.js check notes.md --provider local
```

## Roadmap and support

Margin's focus is the local-model experience (Ollama, LM Studio) with Harper. More providers (OpenAI, Anthropic, …) are added when people ask for them: 👍 the [provider requests](https://github.com/phoenixak/margin/issues?q=is%3Aissue+label%3Aprovider) you'd use, [request another one](https://github.com/phoenixak/margin/issues/new?template=provider-request.yml), or send a PR. Gemini (`packages/core/src/model.ts`) shows the pattern.

If Margin helps you, you can support it on [GitHub Sponsors](https://github.com/sponsors/phoenixak) or [Ko-fi](https://ko-fi.com/phoenixak).

## License

MIT. The browser extension and CLI include [harper.js](https://github.com/Automattic/harper) (Apache-2.0, by Automattic) to skip errors Harper already flags; the browser build ships its license in `THIRD_PARTY_NOTICES.txt`. Thanks to the Harper team for publishing it.
