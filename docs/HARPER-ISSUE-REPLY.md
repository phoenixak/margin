# Draft reply for Automattic/harper#2622 ("Incorporate AI")

Posted 2026-10-21: https://github.com/Automattic/harper/issues/2622#issuecomment-6322516802

---

For anyone who wants this without it touching Harper itself: I built a separate, optional companion, **Margin** (https://github.com/phoenixak/margin). Harper stays exactly as it is. Margin runs after it and only looks for what rules can't catch (agreement across clauses, tense, wrong-but-real words, run-ons), and it drops anything Harper already flags.

- Local models first (Ollama / LM Studio); nothing leaves your machine. Google's Gemini API with your own key is the other option.
- A VS Code extension (Marketplace: `phoenixak.margin-ai`). A browser extension (the Chrome Web Store version is in review), a language server for Neovim/Helix/Sublime/Emacs, and an Obsidian plugin are in the repo.
- On a 137-sentence eval it changed none of the 70 correct sentences.

Honest caveat: I've only tested it with hosted Gemma 4; the local path is implemented but untested on my side. If anyone runs it locally, a report would help a lot.

It's not affiliated with Harper, and I'm not suggesting any of this go into Harper. It's for the people in this thread who asked for it as an add-on.
