# Margin: AI second pass for Harper

Margin catches what [Harper](https://writewithharper.com)'s rules can't: agreement across clauses, tense, wrong-but-real words ("effect" for "affect" in context), missing or repeated words, run-ons and comma splices. Harper stays in charge of spelling and mechanical grammar; Margin never repeats what Harper already flags. This extension installs Harper too.

Margin is independent and not affiliated with Harper or Automattic.

## Setup

Run **Margin: Choose where text is checked…** (or click "Margin" in the status bar):

- **Gemini API (Gemma 4), tested.** Paste a Gemini API key (stored in VS Code's secret storage). The sentences being checked are sent to Google; on the free tier Google may use them to improve its products. Code, URLs and emails are masked first.
- **Local server (Ollama / LM Studio), untested.** Text stays on your machine. It's implemented, but the maintainer hasn't been able to test it. Please report how it goes.

Nothing is sent until you choose. Files matching `margin.excludeGlobs` are never sent, and Margin is off in untrusted workspaces.

## Use

Suggestions appear as underlines a couple of seconds after you stop typing (`margin.trigger`: idle, save or manual). The quick fix (Ctrl+.) offers: apply the change, fix the whole sentence, or ignore.

## Honest status

Early. Tested with hosted Gemma 4 26B A4B on synthetic text. The local path is untested. Margin has no telemetry and never logs your text.
