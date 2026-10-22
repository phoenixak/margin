# Changelog

## 0.1.4

- Same as 0.1.3; republished so the Open VSX listing matches the VS Code Marketplace.

## 0.1.3

- README: a short demo of Harper and Margin together (hover, quick fix). No code changes.

## 0.1.2

- Tested with a local model: Ollama and gemma4:26b-a4b-it-qat, with Harper installed. On 12 real READMEs and docs it added 17 underlines next to Harper's 425, never on a spot Harper marks.
- Fewer optional edits: the model no longer adds optional commas, hyphens or dashes, edits product names, or adds periods to list items and headings.
- Sentences are no longer split inside links, URLs or inline code, or after initials ("M. Dubois"), and quoted speech like “Stop!” he said stays one sentence.
- `:::` admonition fences (Docusaurus, VitePress) are no longer treated as part of a sentence.
- A fix whose own reason says nothing was wrong is dropped.

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
