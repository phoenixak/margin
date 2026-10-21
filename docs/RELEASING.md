# Releasing

Build everything with `pnpm build`. Release files go in `release/` (gitignored).

| Target | Status | What's needed |
|---|---|---|
| GitHub repo | ✅ https://github.com/phoenixak/margin | |
| VS Code Marketplace | ✅ `phoenixak.margin-ai` 0.1.0 | Next version: `npx @vscode/vsce publish --no-dependencies` in `packages/vscode`. Global Azure DevOps tokens stop working on 2026-12-01; after that use vsce's Entra ID sign-in. |
| Open VSX (VSCodium, Cursor, Windsurf) | Not yet | Free account at open-vsx.org (signs in with GitHub), create the `phoenixak` namespace, make a token, then `npx ovsx publish release/margin-ai-0.1.0.vsix -p <token>` |
| Chrome Web Store | ⏳ 0.1.0 submitted for review 2026-10-21 | Store assets in `release/store/` (screenshots from `http://localhost:5173/demo`). Privacy policy: `PRIVACY.md`. |
| Firefox Add-ons | ⏳ 0.1.0 submitted 2026-10-21 as `margin-ai` (Firefox 140+, desktop only) | Source zip from `git archive` + `packages/browser/BUILD.md`; reviewer notes cover build and testing. |
| Obsidian community plugins | Not yet | First run it inside Obsidian once. Then make a GitHub release whose tag is exactly `0.1.0` with `main.js`, `manifest.json`, `styles.css` attached, and open a PR to `obsidianmd/obsidian-releases` adding Margin to `community-plugins.json`. Obsidian requires `manifest.json` at the repo root for the plugin; copy `packages/obsidian/dist/manifest.json` there before the PR. |
| npm (`@phoenixak/margin-*`) | Not yet | Only worth it once margin-ls has users; `npm publish --access public` per package. |

## Store listing (Chrome and Firefox)

**Name:** Margin: AI second pass for Harper

**Short description (≤ 132 chars):** Catches what grammar rules can't, in web text fields. Local model (Ollama, LM Studio) or Gemini. Rewrite on request.

**Description:**

> Margin is an optional AI companion to Harper, the private grammar checker. Harper's fast rules stay in charge of spelling and mechanical grammar; Margin adds what rules can't catch: agreement across clauses, tense, wrong-but-real words ("effect" for "affect"), missing or repeated words, run-ons and comma splices. It never repeats what Harper already flags.
>
> - Purple underlines in text fields; click one to Apply or Ignore.
> - Rewrite a selection (Alt+Shift+R or right-click): Improve, Concise, Formal, Friendly, Fix only, or your own instruction, with Accept / Reject.
> - Off on every site until you turn it on for that site.
>
> Where your text goes: with a local model (Ollama or LM Studio), nothing leaves your computer. With Google's Gemini API and your own key, the text being checked is sent to Google; on the free tier Google may use it to improve its products. Code, URLs and emails are masked first. No account, no server, no telemetry.
>
> Honest status: tested with hosted Gemma 4 (100% precision on Margin's 137-sentence eval). The local path is implemented but hasn't been tested by the maintainer yet; reports welcome on GitHub.
>
> Not affiliated with Harper or Automattic. Open source (MIT): https://github.com/phoenixak/margin

**Single purpose (Chrome):** Suggest grammar fixes and rewrites for text the user writes in web text fields.

**Permission reasons (Chrome review):**

| Permission | Why |
|---|---|
| `storage` | Settings, the list of enabled sites, ignored suggestions, and a cache of sentence hashes (no text). |
| `contextMenus` | The right-click "Margin: rewrite" menu. |
| `scripting` | Registers the content script only on sites the user enables, and injects it once when the user uses the rewrite menu or shortcut on another site. |
| `activeTab` | Lets the rewrite menu/shortcut work on the current page after a user gesture, without access to all sites. |
| Host `localhost`, `127.0.0.1` | Talking to the user's local model server (Ollama, LM Studio). |
| Host `generativelanguage.googleapis.com` | Google's Gemini API, only if the user chooses it and gives a key. |
| Optional host access (`http(s)://*/*`) | Requested one site at a time when the user turns checking on for that site. |
| Remote code | None. Harper's WebAssembly ships inside the extension. |

**Data disclosure (Chrome):** "Website content" (the text in fields the user is checking) is sent only to the AI provider the user selects (a local server, or Google's Gemini API). It isn't sold, used for anything else, or sent to the developer.

**Firefox data collection:** declared as `required: ["none"]`, `optional: ["websiteContent"]`; Margin asks for `websiteContent` through Firefox's own prompt when the user picks Gemini.
