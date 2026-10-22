# Margin: AI second pass for Harper

Margin catches what [Harper](https://writewithharper.com)'s rules can't: agreement across clauses, tense, wrong-but-real words ("effect" for "affect" in context), missing or repeated words, run-ons and comma splices. Harper stays in charge of spelling and mechanical grammar; Margin never repeats what Harper already flags. This extension installs Harper too.

Margin is independent and not affiliated with Harper or Automattic.

![Margin in VS Code: Harper underlines in blue, Margin in yellow; hovering "stay" shows Margin's suggestion, and the quick fix changes it to "stays"](https://raw.githubusercontent.com/phoenixak/margin/main/packages/vscode/images/demo.gif)

*Harper's suggestions in blue, Margin's in yellow (`"margin.severity": "warning"`; the default is the same blue as Harper). Local Gemma 4 on Ollama.*

## Setup

Run **Margin: Choose where text is checked…** (or click "Margin" in the status bar):

- **Gemini API (Gemma 4), tested.** Paste a Gemini API key (stored in VS Code's secret storage). The sentences being checked are sent to Google; on the free tier Google may use them to improve its products. Code, URLs and emails are masked first.
- **Local server (Ollama / LM Studio).** Text stays on your machine. Tested with Ollama and `gemma4:26b-a4b-it-qat` (16 GB GPU): 100% precision on Margin's eval, and on 12 real READMEs and docs it added 17 underlines next to Harper's 425, with no duplicates. LM Studio and other models: please [post a model review](https://github.com/phoenixak/margin/issues/new?template=model-review.yml).

Nothing is sent until you choose. Files matching `margin.excludeGlobs` are never sent, and Margin is off in untrusted workspaces.

## Use

Suggestions appear as underlines a couple of seconds after you stop typing (`margin.trigger`: idle, save or manual). The quick fix (Ctrl+.) offers: apply the change, fix the whole sentence, or ignore.

**Rewrite selection** (right-click, or the command palette): Improve, Concise, Formal, Friendly, Fix only, or your own instruction. The result streams into a side-by-side diff; accept or reject it. Margin warns you if a rewrite changed numbers, negation or code/links.

**Cache.** To avoid re-sending text, Margin remembers which sentences needed no change: only a hash and a date, stored in VS Code's extension storage, kept for 30 days. Fixes are kept in memory only. **Margin: Clear cache** removes it.

## Honest status

Early. Tested with Gemma 4 26B A4B, local (Ollama) and hosted (Gemini API), on synthetic and real text; results in the [repository](https://github.com/phoenixak/margin/blob/main/packages/eval/results/README.md). Margin has no telemetry and never logs your text.
