# Changelog

## 0.1.1

- A sentence that starts with a lowercase letter after a period is now checked on its own (it used to be merged into the previous sentence, which hid its errors).
- When the model points out an error but returns the sentence unchanged, Margin asks again for just that sentence.
- The check prompt now says to fix grammar even when the sentence also has a capitalization slip (which Harper handles). Margin's eval: precision still 100%, 0 of 70 correct sentences changed.

## 0.1.0

First release.

- Check mode: an AI second pass after Harper for agreement, tense, wrong-but-real words, missing or repeated words, run-ons and comma splices. Errors Harper already flags are left to Harper.
- Quick fixes: apply a change, fix the whole sentence, or ignore (remembered).
- Rewrite selection: Improve, Concise, Formal, Friendly, Fix only, or your own instruction, shown as a diff to accept or reject.
- Providers: a local model (Ollama / LM Studio, found automatically; not yet tested by the maintainer) or Google's Gemini API with your own key (tested).
- Nothing is sent until you choose a provider. Excluded files are never sent; Margin is off in untrusted workspaces. No telemetry.
