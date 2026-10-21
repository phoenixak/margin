import {
  type CacheStorage,
  createModel,
  type Dialect,
  diffText,
  Engine,
  explainError,
  ignoreKey,
  lruCache,
  type ModelState,
  modelAdvice,
  REWRITE_PRESETS,
  type RewritePreset,
  type Range as Span,
  rewrite,
  shiftSuggestions,
  storedCache,
  type Suggestion,
} from '@margin/core';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  type CodeAction,
  CodeActionKind,
  type Connection,
  type Diagnostic,
  DiagnosticSeverity,
  type Range,
  TextDocuments,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';

/** Editor settings under `margin` (initializationOptions or workspace/didChangeConfiguration). */
export interface Settings {
  /** `off` until the user chooses: nothing is sent before that. */
  provider: 'off' | 'local' | 'gemini';
  model: string;
  localBaseUrl: string;
  trigger: 'idle' | 'save' | 'manual';
  idleDelayMs: number;
  dialect: Dialect;
  excludeGlobs: string[];
  severity: 'error' | 'warning' | 'information' | 'hint';
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'off',
  model: '',
  localBaseUrl: 'http://localhost:11434/v1',
  trigger: 'idle',
  idleDelayMs: 2000,
  dialect: 'American',
  excludeGlobs: ['**/.env*', '**/secrets/**', '**/*.pem', '**/*.key'],
  severity: 'information',
};

export interface ServerDeps {
  /** Overrides model creation (tests). */
  model?: (settings: Settings) => ModelState;
  /** Harper's lint ranges for dedup (harper.js in production; tests stub it). */
  harperRanges: (text: string, dialect: Dialect, language: 'markdown' | 'plaintext') => Promise<Span[]>;
  /** Where the hash-only check cache and the ignore list are kept. Absent: memory only. */
  storage?: { cache: CacheStorage; ignored: CacheStorage };
  env?: Record<string, string | undefined>;
}

const SEVERITY: Record<Settings['severity'], DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  information: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
};

interface DocState {
  text: string;
  suggestions: (Suggestion & { before: string })[];
}

/** Turns `**` / `*` / `?` globs into a RegExp over forward-slash paths. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') {
      re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

export function startServer(connection: Connection, deps: ServerDeps): void {
  const env = deps.env ?? process.env;
  const documents = new TextDocuments(TextDocument);
  const states = new Map<string, DocState>();
  let settings: Settings = { ...DEFAULT_SETTINGS };
  let ignored = new Set<string>();
  let cache: Awaited<ReturnType<typeof storedCache>> | ReturnType<typeof lruCache> = lruCache();
  const shownErrors = new Set<string>();

  const languageOf = (doc: TextDocument): 'markdown' | 'plaintext' => (doc.languageId === 'markdown' ? 'markdown' : 'plaintext');

  function modelState(): ModelState {
    if (deps.model) return deps.model(settings);
    if (settings.provider === 'off') return { ok: false, reason: 'needs-setup' };
    if (settings.provider === 'gemini') {
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) return { ok: false, reason: 'no-key' };
      return { ok: true, model: createModel({ provider: 'gemini', apiKey, ...(settings.model ? { model: settings.model } : {}) }) };
    }
    return { ok: true, model: createModel({ provider: 'local', baseURL: settings.localBaseUrl, ...(settings.model ? { model: settings.model } : {}) }) };
  }

  function toDiagnostic(doc: TextDocument, s: Suggestion & { before: string }): Diagnostic {
    const change = s.before ? (s.replacement ? `"${s.before}" → "${s.replacement}"` : `remove "${s.before}"`) : `insert "${s.replacement.trim()}"`;
    let range: Range = { start: doc.positionAt(s.range.start), end: doc.positionAt(s.range.end) };
    if (s.range.start === s.range.end) range = { start: doc.positionAt(Math.max(0, s.range.start - 1)), end: range.end };
    return { range, severity: SEVERITY[settings.severity], source: 'Margin', code: s.kind, message: `${change}${s.why ? ` — ${s.why}` : ''}` };
  }

  function publish(uri: string) {
    const doc = documents.get(uri);
    if (!doc) return;
    const st = states.get(uri);
    void connection.sendDiagnostics({ uri, version: doc.version, diagnostics: (st?.suggestions ?? []).map((s) => toDiagnostic(doc, s)) });
  }

  function excluded(uri: string): boolean {
    const path = decodeURIComponent(uri.replace(/^file:\/\/\/?/, '/')).replace(/\\/g, '/');
    return settings.excludeGlobs.some((g) => globToRegExp(g).test(path));
  }

  const engine = new Engine({
    cache: { get: (k) => cache.get(k), set: (k, v) => cache.set(k, v) },
    ignored: () => ignored,
    settings: () => ({ trigger: settings.trigger, idleDelayMs: settings.idleDelayMs }),
    host: {
      snapshot(uri) {
        const doc = documents.get(uri);
        return doc ? { text: doc.getText(), version: doc.version, language: languageOf(doc) } : undefined;
      },
      harperRanges: async (uri) => {
        const doc = documents.get(uri);
        return doc ? deps.harperRanges(doc.getText(), settings.dialect, languageOf(doc)) : [];
      },
      model: modelState,
      dialect: () => settings.dialect,
      excluded,
      publish(uri, version, suggestions) {
        const doc = documents.get(uri);
        if (!doc || doc.version !== version) return;
        const text = doc.getText();
        states.set(uri, { text, suggestions: suggestions.map((s) => ({ ...s, before: text.slice(s.range.start, s.range.end) })) });
        publish(uri);
      },
      status(status) {
        // Tell the user once per distinct problem; editors have no status bar for us.
        const message =
          status.state === 'needs-setup'
            ? 'Margin is off. Set `margin.provider` to "local" (Ollama / LM Studio) or "gemini" in your editor’s LSP settings.'
            : status.state === 'no-key'
              ? 'Margin: set the GEMINI_API_KEY environment variable for the editor (keys are never read from settings files).'
              : status.state === 'error'
                ? `Margin: ${status.message}`
                : undefined;
        if (message && !shownErrors.has(message)) {
          shownErrors.add(message);
          void connection.window.showWarningMessage(message);
        }
      },
      log: (line) => connection.console.log(line),
    },
  });

  connection.onInitialize(async (params) => {
    const init = (params.initializationOptions ?? {}) as { margin?: Partial<Settings> } & Partial<Settings>;
    settings = { ...DEFAULT_SETTINGS, ...(init.margin ?? init) };
    if (deps.storage) {
      cache = await storedCache(deps.storage.cache);
      try {
        ignored = new Set(JSON.parse((await deps.storage.ignored.read()) ?? '[]') as string[]);
      } catch {
        ignored = new Set();
      }
    }
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.RefactorRewrite] },
        executeCommandProvider: { commands: ['margin.ignore', 'margin.check', 'margin.rewrite'] },
      },
      serverInfo: { name: 'margin-ls', version: '0.0.1' },
    };
  });

  connection.onInitialized(() => {
    const m = modelState();
    if (m.ok) {
      const note = modelAdvice(m.model.provider, m.model.modelId).note;
      connection.console.log(`margin-ls: ${m.model.id}${m.model.tested ? '' : ' (this path is not yet tested by Margin’s maintainers)'}${note ? `. ${note}` : ''}`);
    }
  });

  connection.onDidChangeConfiguration((change) => {
    const next = (change.settings as { margin?: Partial<Settings> } | undefined)?.margin;
    if (!next) return;
    settings = { ...settings, ...next };
    shownErrors.clear();
    for (const doc of documents.all()) engine.onOpen(doc.uri);
  });

  documents.onDidOpen((e) => {
    states.set(e.document.uri, { text: e.document.getText(), suggestions: [] });
    engine.onOpen(e.document.uri);
  });
  documents.onDidChangeContent((e) => {
    const uri = e.document.uri;
    const st = states.get(uri);
    const text = e.document.getText();
    if (st) {
      const change = diffText(st.text, text);
      if (change && st.suggestions.length) {
        // Keep diagnostics on the right words until the next check; drop ones in edited sentences.
        const kept = (shiftSuggestions(st.suggestions, [change]) as DocState['suggestions']).filter((s) => text.slice(s.range.start, s.range.end) === s.before);
        st.suggestions = kept;
        st.text = text;
        publish(uri);
      }
      st.text = text;
    }
    engine.onEdit(uri);
  });
  documents.onDidSave((e) => engine.onSave(e.document.uri));
  documents.onDidClose((e) => {
    engine.onClose(e.document.uri);
    states.delete(e.document.uri);
    void connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  });

  connection.onCodeAction((params) => {
    const doc = documents.get(params.textDocument.uri);
    const st = states.get(params.textDocument.uri);
    if (!doc) return [];
    const text = doc.getText();
    const from = doc.offsetAt(params.range.start);
    const to = doc.offsetAt(params.range.end);
    const actions: CodeAction[] = [];
    const sentencesDone = new Set<number>();
    for (const s of st?.suggestions ?? []) {
      const touches = s.sentence.start <= to && from <= s.sentence.end;
      if (!touches || text.slice(s.range.start, s.range.end) !== s.before) continue;
      const range = { start: doc.positionAt(s.range.start), end: doc.positionAt(s.range.end) };
      const label = s.replacement ? (s.before ? `Change "${s.before}" to "${s.replacement}"` : `Insert "${s.replacement.trim()}"`) : `Remove "${s.before}"`;
      actions.push({
        title: `Margin: ${label}`,
        kind: CodeActionKind.QuickFix,
        isPreferred: true,
        edit: { changes: { [doc.uri]: [{ range, newText: s.replacement }] } },
      });
      if (sentencesDone.has(s.sentence.start)) continue;
      sentencesDone.add(s.sentence.start);
      if (text.slice(s.sentence.start, s.sentence.end) === s.sentence.original && s.sentence.fixed !== s.sentence.original) {
        actions.push({
          title: 'Margin: Fix the whole sentence',
          kind: CodeActionKind.QuickFix,
          edit: { changes: { [doc.uri]: [{ range: { start: doc.positionAt(s.sentence.start), end: doc.positionAt(s.sentence.end) }, newText: s.sentence.fixed }] } },
        });
      }
      actions.push({
        title: 'Margin: Ignore this suggestion',
        kind: CodeActionKind.QuickFix,
        command: { title: 'Ignore', command: 'margin.ignore', arguments: [doc.uri, s.sentence.original, s.sentence.fixed] },
      });
    }
    // Rewrite presets for a real selection (a few words), not for a diagnostic's one-word range.
    if (to - from >= 10 && /\s/.test(text.slice(from, to).trim())) {
      for (const preset of Object.keys(REWRITE_PRESETS) as Exclude<RewritePreset, 'custom'>[]) {
        actions.push({
          title: `Margin: Rewrite (${REWRITE_PRESETS[preset].label})`,
          kind: CodeActionKind.RefactorRewrite,
          command: { title: 'Rewrite', command: 'margin.rewrite', arguments: [doc.uri, params.range, preset, doc.version] },
        });
      }
    }
    return actions;
  });

  connection.onExecuteCommand(async (params) => {
    const args = params.arguments ?? [];
    if (params.command === 'margin.ignore') {
      const [uri, original, fixed] = args as [string, string, string];
      ignored.add(await ignoreKey(original, fixed));
      await deps.storage?.ignored.write(JSON.stringify([...ignored]));
      const st = states.get(uri);
      if (st) st.suggestions = st.suggestions.filter((s) => !(s.sentence.original === original && s.sentence.fixed === fixed));
      publish(uri);
      return;
    }
    if (params.command === 'margin.check') {
      const [uri] = args as [string | undefined];
      for (const doc of uri ? [documents.get(uri)].filter(Boolean) : documents.all()) await engine.checkNow(doc!.uri);
      return;
    }
    if (params.command === 'margin.rewrite') {
      const [uri, range, preset, version] = args as [string, Range, RewritePreset, number];
      const doc = documents.get(uri);
      const m = modelState();
      if (!doc || !m.ok) return;
      const original = doc.getText(range);
      try {
        const r = rewrite({ text: original, model: m.model, preset, dialect: settings.dialect });
        for await (const _ of r.textStream); // `done` resolves once the stream has been read
        const done = await r.done;
        const now = documents.get(uri);
        if (!now || now.version !== version || now.getText(range) !== original) {
          void connection.window.showWarningMessage('Margin: the text changed, so the rewrite was not applied.');
          return;
        }
        await connection.workspace.applyEdit({ label: `Margin: ${preset}`, edit: { changes: { [uri]: [{ range, newText: done.text }] } } });
        if (done.warnings.length) void connection.window.showWarningMessage(`Margin: check the rewrite: ${done.warnings.join(', ')} changed.`);
      } catch (error) {
        void connection.window.showErrorMessage(`Margin: ${explainError(error, m.model)}`);
      }
    }
  });

  connection.onShutdown(async () => {
    engine.dispose();
    if ('flush' in cache) await cache.flush();
  });

  documents.listen(connection);
  connection.listen();
}
