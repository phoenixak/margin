Margin AI Proofreader for Obsidian: an AI second pass after Harper.

- New name "Margin AI Proofreader" and plugin id `margin-ai-proofreader`, the name and id it's listed under in Obsidian's community directory. If you installed an earlier build by hand, remove `.obsidian/plugins/margin-proofreader/` and set the plugin up again.
- Uses Harper's own Obsidian plugin for dedup instead of bundling a second copy of Harper, so main.js is about 1 MB. Install and enable Harper's plugin for dedup.
- Built by GitHub Actions from this tag, with signed build provenance for main.js, manifest.json and styles.css.

Desktop only for now. See the README for what's tested.
