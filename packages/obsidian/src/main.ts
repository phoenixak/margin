import {
  type CacheStorage,
  createModel,
  DEFAULT_LOCAL_MODEL,
  DEFAULT_LOCAL_URLS,
  type Dialect,
  detectLocalServers,
  Engine,
  explainError,
  ignoreKey,
  type ModelState,
  modelAdvice,
  modelInfo,
  REWRITE_PRESETS,
  type RewritePreset,
  type Range as Span,
  rewrite,
  type Status,
  storedCache,
  type Suggestion,
} from '@margin/core';
import type { EditorView } from '@codemirror/view';
import { Dialect as HarperDialect, LocalLinter } from 'harper.js';
import { slimBinaryInlined } from 'harper.js/slimBinaryInlined';
import { type App, type Editor, editorInfoField, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { marginEditor, removeSuggestions, setSuggestions } from './editor.js';
import { obsidianFetch } from './fetch.js';

interface Settings {
  /** `off` until the user chooses; nothing is sent before that. */
  provider: 'off' | 'local' | 'gemini';
  localBaseUrl: string;
  model: string;
  geminiConsent: boolean;
  dialect: Dialect;
  trigger: 'idle' | 'save' | 'manual';
  idleDelayMs: number;
  /** Folders whose notes are never sent (e.g. "Private"). */
  excludeFolders: string[];
  /** Hashes of ignored fixes (no text). */
  ignored: string[];
}

const DEFAULTS: Settings = {
  provider: 'off',
  localBaseUrl: 'http://localhost:11434/v1',
  model: '',
  geminiConsent: false,
  dialect: 'American',
  trigger: 'idle',
  idleDelayMs: 2000,
  excludeFolders: [],
  ignored: [],
};

/** The key lives in Obsidian's secret storage (device-local, not synced), never in data.json. */
const SECRET_ID = 'margin-gemini-key';

export default class MarginPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  private engine!: Engine;
  private status!: HTMLElement;
  private readonly views = new Map<string, EditorView>();
  private readonly versions = new WeakMap<EditorView, number>();
  private linter?: { dialect: Dialect; linter: LocalLinter };

  async onload() {
    this.settings = { ...DEFAULTS, ...((await this.loadData()) as Partial<Settings> | null) };
    this.status = this.addStatusBarItem();
    this.status.addClass('margin-status');
    this.status.onClickEvent(() => this.openSettings());

    const dir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
    const adapter = this.app.vault.adapter;
    const cacheFile: CacheStorage = {
      read: async () => ((await adapter.exists(`${dir}/check-cache.json`)) ? adapter.read(`${dir}/check-cache.json`) : undefined),
      write: (data) => adapter.write(`${dir}/check-cache.json`, data),
    };
    const cache = await storedCache(cacheFile);
    this.register(() => void cache.flush());

    this.engine = new Engine({
      cache,
      ignored: () => new Set(this.settings.ignored),
      settings: () => ({ trigger: this.settings.trigger, idleDelayMs: this.settings.idleDelayMs }),
      host: {
        snapshot: (key) => {
          const view = this.views.get(key);
          return view ? { text: view.state.doc.toString(), version: this.versions.get(view) ?? 0, language: 'markdown' } : undefined;
        },
        harperRanges: (key) => {
          const view = this.views.get(key);
          return view ? this.harperRanges(view.state.doc.toString()) : [];
        },
        model: () => this.modelState(),
        dialect: () => this.settings.dialect,
        excluded: (key) => this.settings.excludeFolders.some((f) => f.trim() && (key === f.trim() || key.startsWith(`${f.trim().replace(/\/$/, '')}/`))),
        publish: (key, version, suggestions) => {
          const view = this.views.get(key);
          if (view && (this.versions.get(view) ?? 0) === version) view.dispatch({ effects: setSuggestions.of(suggestions) });
        },
        status: (s) => this.showStatus(s),
        log: (line) => console.debug(`[Margin] ${line}`),
      },
    });
    this.register(() => this.engine.dispose());

    this.registerEditorExtension(
      marginEditor({
        attach: (view) => {
          const key = this.keyOf(view);
          this.views.set(key, view);
          this.versions.set(view, 0);
          this.engine.onOpen(key);
        },
        detach: (view) => {
          const key = this.keyOf(view);
          if (this.views.get(key) === view) {
            this.views.delete(key);
            this.engine.onClose(key);
          }
        },
        changed: (view) => {
          this.versions.set(view, (this.versions.get(view) ?? 0) + 1);
          const key = this.keyOf(view);
          this.views.set(key, view);
          this.engine.onEdit(key);
        },
        apply: (view, s) => removeSuggestions(view, (x) => x !== s),
        ignore: (view, s) => void this.ignore(view, s),
      }),
    );

    this.addCommand({ id: 'check-note', name: 'Check this note', editorCallback: (_e, ctx) => ctx.file && void this.engine.checkNow(ctx.file.path) });
    this.addCommand({ id: 'rewrite-selection', name: 'Rewrite selection…', editorCallback: (editor) => this.rewriteSelection(editor) });
    this.addCommand({ id: 'choose-provider', name: 'Choose where text is checked…', callback: () => this.openSettings() });
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        if (editor.somethingSelected()) menu.addItem((item) => item.setTitle('Margin: rewrite…').setIcon('pencil').onClick(() => this.rewriteSelection(editor)));
      }),
    );
    this.addSettingTab(new MarginSettingTab(this.app, this));

    const initial = this.modelState();
    this.showStatus(initial.ok ? { state: 'ready', model: initial.model.id, tested: initial.model.tested } : { state: initial.reason });
  }

  private keyOf(view: EditorView): string {
    // Obsidian's types resolve @codemirror/state as CommonJS and ours as ESM; at runtime there's one copy.
    const info = view.state.field(editorInfoField as unknown as Parameters<typeof view.state.field>[0], false) as { file?: { path: string } } | undefined;
    return info?.file?.path ?? 'untitled';
  }

  modelState(): ModelState {
    const s = this.settings;
    if (s.provider === 'off') return { ok: false, reason: 'needs-setup' };
    if (s.provider === 'gemini') {
      const apiKey = this.app.secretStorage?.getSecret(SECRET_ID);
      if (!apiKey || !s.geminiConsent) return { ok: false, reason: 'no-key' };
      return { ok: true, model: createModel({ provider: 'gemini', apiKey, fetch: obsidianFetch, ...(s.model ? { model: s.model } : {}) }) };
    }
    return { ok: true, model: createModel({ provider: 'local', baseURL: s.localBaseUrl, fetch: obsidianFetch, ...(s.model ? { model: s.model } : {}) }) };
  }

  /** Harper's lint ranges for dedup (Margin can't read Harper's plugin). */
  private async harperRanges(text: string): Promise<Span[]> {
    try {
      if (this.linter?.dialect !== this.settings.dialect) {
        await this.linter?.linter.dispose();
        this.linter = { dialect: this.settings.dialect, linter: new LocalLinter({ binary: slimBinaryInlined, dialect: HarperDialect[this.settings.dialect] }) };
      }
      return (await this.linter.linter.lint(text, { language: 'markdown' })).map((l) => {
        const span = l.span();
        return { start: span.start, end: span.end };
      });
    } catch {
      this.linter = undefined;
      return [];
    }
  }

  private showStatus(s: Status) {
    const text: Record<Status['state'], string> = {
      off: 'Margin: off',
      'needs-setup': 'Margin: set up',
      'no-key': 'Margin: needs key',
      ready: 'Margin ✓',
      checking: 'Margin …',
      busy: 'Margin: busy',
      error: 'Margin ⚠',
    };
    this.status.setText(text[s.state]);
    this.status.setAttr(
      'aria-label',
      s.state === 'ready' || s.state === 'checking'
        ? `${s.model}${s.tested ? '' : ' (not yet tested by the maintainer)'}${s.model.startsWith('gemini:') ? ' · text is sent to Google' : ' · text stays on this device'}`
        : s.state === 'error'
          ? s.message
          : s.state === 'busy'
            ? `Busy or rate-limited; retrying in ${Math.round(s.retryInMs / 1000)} s`
            : 'Open Margin settings',
    );
  }

  private async ignore(view: EditorView, s: Suggestion) {
    this.settings.ignored = [...new Set([...this.settings.ignored, await ignoreKey(s.sentence.original, s.sentence.fixed)])];
    await this.saveSettings();
    removeSuggestions(view, (x) => x.sentence.start !== s.sentence.start);
  }

  private rewriteSelection(editor: Editor) {
    const m = this.modelState();
    if (!m.ok) {
      new Notice('Margin isn’t set up yet: choose where text is checked in its settings.');
      return this.openSettings();
    }
    if (!editor.somethingSelected()) return void new Notice('Margin: select some text to rewrite.');
    new RewriteModal(this.app, editor, m, this.settings.dialect).open();
  }

  openSettings() {
    const setting = (this.app as App & { setting?: { open(): void; openTabById(id: string): void } }).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** Re-checks open notes after a settings change. */
  refresh() {
    for (const key of this.views.keys()) this.engine.onOpen(key);
    const m = this.modelState();
    this.showStatus(m.ok ? { state: 'ready', model: m.model.id, tested: m.model.tested } : { state: m.reason });
  }
}

class RewriteModal extends Modal {
  constructor(
    app: App,
    private readonly editor: Editor,
    private readonly m: Extract<ModelState, { ok: true }>,
    private readonly dialect: Dialect,
  ) {
    super(app);
  }

  onOpen() {
    this.setTitle('Margin: rewrite selection');
    const row = this.contentEl.createDiv({ cls: 'margin-presets' });
    for (const [id, p] of Object.entries(REWRITE_PRESETS)) {
      row.createEl('button', { text: p.label }).addEventListener('click', () => void this.run(id as RewritePreset));
    }
    const custom = this.contentEl.createEl('input', { type: 'text', placeholder: 'Or describe the change and press Enter…' });
    custom.addClass('margin-custom');
    custom.addEventListener('keydown', (e) => e.key === 'Enter' && custom.value.trim() && void this.run('custom', custom.value.trim()));
  }

  private async run(preset: RewritePreset, instruction?: string) {
    const from = this.editor.getCursor('from');
    const to = this.editor.getCursor('to');
    const original = this.editor.getRange(from, to);
    this.contentEl.empty();
    const out = this.contentEl.createDiv({ cls: 'margin-rewrite', text: 'Rewriting…' });
    const controller = new AbortController();
    this.onClose = () => controller.abort();
    try {
      const r = rewrite({ text: original, model: this.m.model, preset, dialect: this.dialect, signal: controller.signal, ...(instruction ? { instruction } : {}) });
      let text = '';
      for await (const part of r.textStream) {
        text += part;
        out.setText(text);
      }
      const done = await r.done;
      out.setText(done.text);
      if (done.warnings.length) this.contentEl.createDiv({ cls: 'margin-warn', text: `Check before accepting: ${done.warnings.join(', ')} changed.` });
      const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
      buttons.createEl('button', { text: 'Reject' }).addEventListener('click', () => this.close());
      const accept = buttons.createEl('button', { text: 'Accept', cls: 'mod-cta' });
      accept.addEventListener('click', () => {
        if (this.editor.getRange(from, to) !== original) new Notice('Margin: the text changed, so the rewrite was not applied.');
        else this.editor.replaceRange(done.text, from, to);
        this.close();
      });
    } catch (error) {
      if (!controller.signal.aborted) out.setText(explainError(error, this.m.model));
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

class MarginSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: MarginPlugin,
  ) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = async () => {
      await this.plugin.saveSettings();
      this.plugin.refresh();
    };
    containerEl.empty();
    containerEl.createEl('p', {
      text: 'An AI second pass for Harper: catches what rules can’t (agreement, tense, wrong-but-real words, run-ons) and rewrites on request. Not affiliated with Harper or Automattic.',
    });

    new Setting(containerEl)
      .setName('Where your text is checked')
      .setDesc('Local: Ollama or LM Studio, text stays on this device (implemented, not yet tested by the maintainer). Gemini: Google’s API with your key (tested; text is sent to Google).')
      .addDropdown((d) =>
        d
          .addOptions({ off: 'Off (send nothing)', local: 'Local model (Ollama / LM Studio)', gemini: 'Google Gemini API' })
          .setValue(s.provider)
          .onChange(async (v) => {
            s.provider = v as Settings['provider'];
            await save();
            this.display();
          }),
      );

    if (s.provider === 'local') {
      new Setting(containerEl).setName('Server URL').addText((t) =>
        t.setValue(s.localBaseUrl).onChange(async (v) => {
          s.localBaseUrl = v.trim() || DEFAULTS.localBaseUrl;
          await save();
        }),
      );
      const models = new Setting(containerEl).setName('Model').setDesc(`Recommended: ${DEFAULT_LOCAL_MODEL} (16 GB GPU; same weights as the model that passed Margin’s eval).`);
      models.addText((t) =>
        t.setPlaceholder(DEFAULT_LOCAL_MODEL).setValue(s.model).onChange(async (v) => {
          s.model = v.trim();
          await save();
        }),
      );
      models.addButton((b) =>
        b.setButtonText('Find models').onClick(async () => {
          const probes = await detectLocalServers({ urls: [...new Set([s.localBaseUrl, ...DEFAULT_LOCAL_URLS])], fetch: obsidianFetch });
          const found = probes.find((p) => p.server);
          if (!found?.server) return void new Notice('Margin found no local model server. Start Ollama or LM Studio’s server.');
          s.localBaseUrl = found.server.baseURL;
          s.model = found.server.models.find((m) => modelInfo('local', m)?.autoCheck) ?? s.model ?? found.server.models[0] ?? '';
          await save();
          new Notice(`Margin found: ${found.server.models.join(', ')}${s.model ? `. Using ${s.model}.` : ''}`);
          this.display();
        }),
      );
      const note = modelAdvice('local', s.model || DEFAULT_LOCAL_MODEL).note;
      if (note) containerEl.createEl('p', { cls: 'setting-item-description', text: note });
    }

    if (s.provider === 'gemini') {
      if (!this.app.secretStorage) {
        containerEl.createEl('p', { text: 'Gemini needs Obsidian 1.11.4 or later (for secure key storage).' });
      } else {
        new Setting(containerEl)
          .setName('Gemini API key')
          .setDesc('Kept in Obsidian’s secret storage on this device (not synced, not in data.json).')
          .addText((t) => {
            t.inputEl.type = 'password';
            t.setPlaceholder(this.app.secretStorage.getSecret(SECRET_ID) ? '•••••••• (saved)' : 'from aistudio.google.com').onChange((v) => {
              if (v.trim()) {
                this.app.secretStorage.setSecret(SECRET_ID, v.trim());
                this.plugin.refresh();
              }
            });
          });
        new Setting(containerEl)
          .setName('I understand that the text Margin checks is sent to Google')
          .setDesc('On the free tier, Google may use it to improve its products. Code, URLs and emails are masked first.')
          .addToggle((t) =>
            t.setValue(s.geminiConsent).onChange(async (v) => {
              s.geminiConsent = v;
              await save();
            }),
          );
      }
    }

    new Setting(containerEl).setName('English dialect').addDropdown((d) =>
      d
        .addOptions({ American: 'American', British: 'British', Australian: 'Australian', Canadian: 'Canadian', Indian: 'Indian' })
        .setValue(s.dialect)
        .onChange(async (v) => {
          s.dialect = v as Dialect;
          await save();
        }),
    );
    new Setting(containerEl).setName('When to check').addDropdown((d) =>
      d
        .addOptions({ idle: 'After a pause in typing', save: 'Only on command (Check this note)', manual: 'Only on command' })
        .setValue(s.trigger)
        .onChange(async (v) => {
          s.trigger = v as Settings['trigger'];
          await save();
        }),
    );
    new Setting(containerEl)
      .setName('Never check these folders')
      .setDesc('One per line. Notes in them are never sent.')
      .addTextArea((t) =>
        t.setValue(s.excludeFolders.join('\n')).onChange(async (v) => {
          s.excludeFolders = v.split('\n').map((x) => x.trim()).filter(Boolean);
          await save();
        }),
      );
    new Setting(containerEl).setName('Ignored suggestions').addButton((b) =>
      b.setButtonText(`Clear (${s.ignored.length})`).onClick(async () => {
        s.ignored = [];
        await save();
        this.display();
      }),
    );
  }
}

