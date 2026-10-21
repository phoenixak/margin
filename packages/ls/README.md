# margin-ls

Margin as a language server: an AI second pass for [Harper](https://writewithharper.com) in any editor that speaks LSP. Run it **next to** `harper-ls`: Harper keeps spelling and mechanical grammar; margin-ls adds what rules can't catch (agreement across clauses, tense, wrong-but-real words, run-ons) and rewrites on request. It never repeats what Harper flags (it runs harper.js internally only to know what to skip).

Not affiliated with Harper or Automattic.

## Install

From this repo (an npm package comes later):

```sh
pnpm install && pnpm build
node packages/ls/dist/margin-ls.js --version     # margin-ls 0.0.1
```

Put `margin-ls` on your `PATH` (e.g. a small wrapper script that runs `node /path/to/packages/ls/dist/margin-ls.js "$@"`).

## Choose where text is checked

Nothing is sent until you set `margin.provider`:

| `provider` | What happens | Status |
|---|---|---|
| `"local"` | Ollama / LM Studio on `localBaseUrl` (default `http://localhost:11434/v1`). Text stays on your machine. | Implemented, **not yet tested by the maintainer** |
| `"gemini"` | Google's Gemini API (Gemma 4) with your key. Text is sent to Google; on the free tier Google may use it to improve its products. | Tested |
| `"off"` | Nothing (default). | |

**Keys come only from the environment:** set `GEMINI_API_KEY` for the editor process. margin-ls never reads keys from settings, so they never end up in dotfiles.

Settings (all under `margin`):

| Setting | Default | |
|---|---|---|
| `provider` | `"off"` | `"local"`, `"gemini"` or `"off"` |
| `model` | provider default | `gemma4:26b-a4b-it-qat` (local) / `gemma-4-26b-a4b-it` (Gemini) |
| `localBaseUrl` | `http://localhost:11434/v1` | LM Studio: `http://localhost:1234/v1` |
| `trigger` | `"idle"` | `"idle"`, `"save"` or `"manual"` (then run the `margin.check` command) |
| `idleDelayMs` | `2000` | |
| `dialect` | `"American"` | `British`, `Australian`, `Canadian`, `Indian` |
| `excludeGlobs` | `.env*`, `secrets/**`, `*.pem`, `*.key` | never sent |
| `severity` | `"information"` | `error`, `warning`, `information`, `hint` |

Code actions: apply a fix, fix the whole sentence, ignore (remembered), and, on a selection of a few words or more, **Rewrite (Improve / Concise / Formal / Friendly / Fix only)**. Margin keeps only hashes on disk (`~/.cache/margin`, or `%LOCALAPPDATA%\margin` on Windows), never text.

## Neovim (0.11+)

```lua
vim.lsp.config('margin_ls', {
  cmd = { 'margin-ls', '--stdio' },
  filetypes = { 'markdown', 'text' },
  init_options = { margin = { provider = 'local' } },
})
vim.lsp.enable('margin_ls')   -- alongside harper_ls
```

Rewrite: select text and run `vim.lsp.buf.code_action()`.

## Helix

```toml
# languages.toml
[language-server.margin-ls]
command = "margin-ls"
args = ["--stdio"]

[language-server.margin-ls.config.margin]
provider = "local"

[[language]]
name = "markdown"
language-servers = ["marksman", "harper-ls", "margin-ls"]
```

## Sublime Text (LSP package)

```json
// Preferences > Package Settings > LSP > Settings
{
  "clients": {
    "margin-ls": {
      "enabled": true,
      "command": ["margin-ls", "--stdio"],
      "selector": "text.html.markdown | text.plain",
      "initializationOptions": { "margin": { "provider": "local" } }
    }
  }
}
```

## Emacs

Eglot runs **one** language server per buffer, so it can't run harper-ls and margin-ls together on its own. Use `lsp-mode` (which supports several servers per buffer) or an LSP multiplexer in front of Eglot. With Eglot alone you'd have to choose one; margin-ls doesn't show Harper's own lints.

```elisp
;; lsp-mode
(with-eval-after-load 'lsp-mode
  (lsp-register-client
   (make-lsp-client :new-connection (lsp-stdio-connection '("margin-ls" "--stdio"))
                    :activation-fn (lsp-activate-on "markdown" "plaintext")
                    :add-on? t
                    :initialization-options '(:margin (:provider "local"))
                    :server-id 'margin-ls)))
```

## Zed

Not supported yet. Zed launches custom language servers only through an extension, which hasn't been written.

## Honest status

Tested: the protocol (in-process tests with a mock model) and a real stdio run against hosted Gemma with Harper dedup. Not tested: each editor's configuration above (written from each editor's docs), and the local model path.
