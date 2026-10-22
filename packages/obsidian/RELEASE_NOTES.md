Margin AI Proofreader for Obsidian: an AI second pass after Harper.

- Tested with a local model (Ollama and gemma4:26b-a4b-it-qat) alongside Harper's plugin: on 12 real READMEs and docs it added 15 underlines next to Harper's 425, none on the same spot.
- Fewer optional edits: no added optional commas, hyphens or dashes, no edits to product names, and headings and list items are left alone.
- Sentences are no longer split inside links, URLs or inline code, or after initials; `:::` callout-style fences aren't treated as prose.

Desktop only for now. See the README for what's tested.
