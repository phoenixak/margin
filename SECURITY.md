# Security

Please report security problems privately, not in a public issue: use **Report a vulnerability** on this repository's [Security tab](https://github.com/phoenixak/margin/security).

Things that count: a way for Margin to send text somewhere the user didn't choose, to leak an API key, to run code from a web page or document, or to write document text into logs or files.

Margin has no server and no telemetry. Keys are kept in each platform's secret store (VS Code SecretStorage, Obsidian secret storage); the browser extension keeps the Gemini key in extension storage, which is not encrypted, as its options page says.

Only the latest release of each app gets fixes.
