# Margin privacy policy

Last updated: 2026-10-21. Applies to the Margin VS Code extension, browser extension (Chrome, Firefox), language server (margin-ls) and Obsidian plugin.

**Short version:** Margin has no server, no accounts and no telemetry. The text you check goes only to the AI provider *you* choose, and nowhere else.

## What Margin sends, and where

- **Nothing is sent until you choose a provider** in Margin's settings.
- **Local model (Ollama, LM Studio, or another server you run):** the sentences being checked go to that server, normally on your own computer. Nothing leaves your device unless you point Margin at a server elsewhere.
- **Google Gemini API:** the sentences being checked (or the text you ask to rewrite) are sent to Google with your own API key, under [Google's terms](https://ai.google.dev/gemini-api/terms). On Google's free tier, Google may use this content to improve its products. Before sending, Margin replaces code, URLs, email addresses and similar with placeholders.
- In the browser extension, checking runs only on sites you turn on, one by one. Files or folders you exclude (and, in VS Code, untrusted workspaces) are never sent.

The developer of Margin never receives your text, your keys or any usage data.

## What Margin stores on your device

- Your settings, and your API key if you use Gemini (VS Code and Obsidian: their secure secret storage; browser: the extension's local storage, which isn't encrypted; margin-ls: read from the `GEMINI_API_KEY` environment variable, never stored).
- A cache of **hashes** of sentences that needed no change, with dates (no text), kept for up to 30 days.
- Hashes of suggestions you chose to ignore.

You can clear the cache and the ignore list from Margin's settings at any time, or uninstall Margin to remove everything.

## Contact

Questions or concerns: open an issue at https://github.com/phoenixak/margin/issues.
