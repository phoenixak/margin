# Margin for Obsidian

An AI second pass for [Harper](https://writewithharper.com) in Obsidian: purple underlines for what Harper's rules can't catch (agreement, tense, wrong-but-real words, run-ons), with a hover card to Apply or Ignore, and **Rewrite selection…** (command palette or right-click). It never repeats what Harper flags. Not affiliated with Harper or Automattic.

## Install (from source, for now)

```sh
pnpm install && pnpm -F @margin/obsidian build
```

Copy `packages/obsidian/dist/` (main.js, manifest.json, styles.css) to `<your vault>/.obsidian/plugins/margin-proofreader/`, then enable **Margin Proofreader** under Settings → Community plugins. (In Obsidian it's called "Margin Proofreader" because another plugin already uses "Margin".)

## Where your text goes

- **Local model** (Ollama / LM Studio): text stays on this device. Obsidian's own network API is used, so **no OLLAMA_ORIGINS or CORS setup is needed**. Use **Find models** in Margin's settings. Implemented, **not yet tested by the maintainer**.
- **Gemini API**: sent to Google with your key; on the free tier Google may use it to improve its products. The key is kept in Obsidian's secret storage (device-local, not synced, never in `data.json`); needs Obsidian 1.11.4+.
- Nothing is sent until you choose. Folders listed under "Never check these folders" are never sent.

## Honest status

Built and its bundle loads, but it hasn't been run inside Obsidian yet. `main.js` is about 28 MB because Harper's engine (for dedup) has to be inlined: Obsidian installs only main.js, manifest.json and styles.css. Harper's own Obsidian plugin is the same size for the same reason.
