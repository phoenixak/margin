import { createModel, type Dialect, ignoreKey, type MarginModel, type Range as Span, type StoredCache, storedCache, type Suggestion } from '@margin/core';
import * as vscode from 'vscode';
import { Engine, type ModelState, type Status } from './engine.js';
import { registerRewrite } from './rewrite.js';
import { shiftSuggestions, withoutHarperOverlaps } from './shift.js';

let persistentCache: StoredCache | undefined;

const LANGUAGES = ['markdown', 'plaintext'];
const IGNORED_KEY = 'margin.ignored';
const SETUP_SHOWN_KEY = 'margin.setupShown';
const SECRET_GEMINI = 'margin.geminiApiKey';
const CONSENT =
  "Margin will send the sentences it checks to Google's Gemini API using your API key. " +
  'On the free tier, Google may use this content to improve its products. Code, URLs and emails are masked before sending. ' +
  'Files matching margin.excludeGlobs are never sent.';

interface Entry {
  suggestion: Suggestion;
  /** The text the hunk replaces, to check the document still matches before applying. */
  before: string;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Margin');
  const diagnostics = vscode.languages.createDiagnosticCollection('margin');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'margin.showStatus';
  const entries = new Map<string, Entry[]>();
  // "No change" answers survive restarts (hashes only, no text); see core/stored-cache.ts.
  const cacheFile = vscode.Uri.joinPath(context.globalStorageUri, 'check-cache.json');
  const cache = await storedCache({
    read: async () => {
      try {
        return new TextDecoder().decode(await vscode.workspace.fs.readFile(cacheFile));
      } catch {
        return undefined;
      }
    },
    write: async (data) => {
      await vscode.workspace.fs.createDirectory(context.globalStorageUri);
      await vscode.workspace.fs.writeFile(cacheFile, new TextEncoder().encode(data));
    },
  });
  persistentCache = cache;
  let ignored = new Set<string>(context.globalState.get<string[]>(IGNORED_KEY, []));
  let geminiKey = await context.secrets.get(SECRET_GEMINI);
  let cachedModel: { sig: string; model: MarginModel } | undefined;

  const config = () => vscode.workspace.getConfiguration('margin');
  const docFor = (key: string) => vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
  const isProse = (doc: vscode.TextDocument) => LANGUAGES.includes(doc.languageId) && ['file', 'untitled'].includes(doc.uri.scheme);

  function modelState(): ModelState {
    if (!config().get<boolean>('enabled', true)) return { ok: false, reason: 'off' };
    const provider = config().get<string>('provider', 'off');
    const modelId = config().get<string>('model', '').trim() || undefined;
    if (provider === 'off') return { ok: false, reason: 'needs-setup' };
    if (provider === 'gemini' && !geminiKey) return { ok: false, reason: 'no-key' };
    const baseURL = config().get<string>('local.baseUrl', 'http://localhost:11434/v1');
    const sig = JSON.stringify([provider, modelId, baseURL, geminiKey?.length, geminiKey?.slice(-4)]);
    if (cachedModel?.sig !== sig) {
      const model =
        provider === 'gemini'
          ? createModel({ provider: 'gemini', apiKey: geminiKey!, ...(modelId ? { model: modelId } : {}) })
          : createModel({ provider: 'local', baseURL, ...(modelId ? { model: modelId } : {}) });
      cachedModel = { sig, model };
    }
    return { ok: true, model: cachedModel.model };
  }

  function harperRanges(doc: vscode.TextDocument): Span[] {
    return vscode.languages
      .getDiagnostics(doc.uri)
      .filter((d) => d.source === 'Harper')
      .map((d) => ({ start: doc.offsetAt(d.range.start), end: doc.offsetAt(d.range.end) }));
  }

  function render(key: string) {
    const doc = docFor(key);
    if (!doc) return;
    const severity = SEVERITY[config().get<string>('severity', 'information')] ?? vscode.DiagnosticSeverity.Information;
    diagnostics.set(
      doc.uri,
      (entries.get(key) ?? []).map(({ suggestion: s, before }) => {
        let range = new vscode.Range(doc.positionAt(s.range.start), doc.positionAt(s.range.end));
        // An insertion has no width; underline the word before it so it's visible.
        if (range.isEmpty) range = doc.getWordRangeAtPosition(range.start.translate(0, range.start.character > 0 ? -1 : 0)) ?? range;
        const change = before ? (s.replacement ? `"${before}" → "${s.replacement}"` : `remove "${before}"`) : `insert "${s.replacement.trim()}"`;
        const d = new vscode.Diagnostic(range, `${change}${s.why ? ` — ${s.why}` : ''}`, severity);
        d.source = 'Margin';
        d.code = s.kind;
        return d;
      }),
    );
  }

  function setEntries(key: string, suggestions: Suggestion[]) {
    const doc = docFor(key);
    if (!doc) return;
    const text = doc.getText();
    entries.set(
      key,
      suggestions.map((s) => ({ suggestion: s, before: text.slice(s.range.start, s.range.end) })),
    );
    render(key);
  }

  const engine = new Engine({
    cache,
    ignored: () => ignored,
    settings: () => ({
      trigger: config().get<'idle' | 'save' | 'manual'>('trigger', 'idle'),
      idleDelayMs: config().get<number>('idleDelayMs', 2000),
    }),
    host: {
      snapshot(key) {
        const doc = docFor(key);
        return doc && isProse(doc) ? { text: doc.getText(), version: doc.version, language: doc.languageId === 'markdown' ? 'markdown' : 'plaintext' } : undefined;
      },
      harperRanges: (key) => {
        const doc = docFor(key);
        return doc ? harperRanges(doc) : [];
      },
      model: modelState,
      dialect: (key) => {
        const doc = docFor(key);
        return vscode.workspace.getConfiguration('harper', doc?.uri).get<Dialect>('dialect', 'American');
      },
      excluded(key) {
        const doc = docFor(key);
        if (!doc || !vscode.workspace.isTrusted) return true;
        return config()
          .get<string[]>('excludeGlobs', [])
          .some((pattern) => vscode.languages.match({ pattern }, doc) > 0);
      },
      publish(key, version, suggestions) {
        if (docFor(key)?.version === version) setEntries(key, suggestions);
      },
      status: showStatus,
      log: (line) => output.appendLine(`[${new Date().toISOString()}] ${line}`),
    },
  });

  let lastStatus: Status = { state: 'off' };
  function showStatus(s: Status) {
    lastStatus = s;
    const text: Record<Status['state'], string> = {
      off: '$(circle-slash) Margin',
      'needs-setup': '$(gear) Margin: set up',
      'no-key': '$(key) Margin: needs key',
      ready: '$(check) Margin',
      checking: '$(sync~spin) Margin',
      busy: '$(clock) Margin: busy',
      error: '$(warning) Margin',
    };
    status.text = text[s.state];
    status.tooltip =
      s.state === 'ready' || s.state === 'checking'
        ? `${s.model}${s.tested ? '' : ' (untested path)'}${s.model.startsWith('gemini:') ? '\nText is sent to Google Gemini.' : '\nText stays on this machine.'}`
        : s.state === 'busy'
          ? `${s.model} is busy or rate-limited; retrying in ${Math.round(s.retryInMs / 1000)} s`
          : s.state === 'error'
            ? s.message
            : s.state === 'off'
              ? 'Margin is turned off'
              : 'Click to set up Margin';
    status.show();
  }

  async function chooseProvider() {
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'Gemini API (Gemma 4)', description: 'tested · sends text to Google · needs your API key', id: 'gemini' },
        { label: 'Local server (Ollama / LM Studio)', description: 'untested · text stays on your machine', id: 'local' },
        { label: 'Off', description: 'send nothing', id: 'off' },
      ],
      { title: 'Margin: where should text be checked?' },
    );
    if (!pick) return;
    if (pick.id === 'gemini') {
      const ok = await vscode.window.showWarningMessage('Send text to Google Gemini?', { modal: true, detail: CONSENT }, 'I understand');
      if (ok !== 'I understand') return;
      if (!geminiKey && !(await setGeminiKey())) return;
    }
    if (pick.id === 'local') {
      const url = await vscode.window.showInputBox({
        title: 'Local server URL (OpenAI-compatible)',
        value: config().get<string>('local.baseUrl', 'http://localhost:11434/v1'),
      });
      if (!url) return;
      await config().update('local.baseUrl', url, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(
        "Margin's local path is implemented but untested by its maintainers. If you try it, please report how it went.",
      );
    }
    await config().update('provider', pick.id, vscode.ConfigurationTarget.Global);
  }

  async function setGeminiKey(): Promise<boolean> {
    const key = await vscode.window.showInputBox({
      title: 'Gemini API key',
      prompt: 'Stored in VS Code SecretStorage, never in settings. Get one at aistudio.google.com.',
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : 'Enter a key'),
    });
    if (!key) return false;
    await context.secrets.store(SECRET_GEMINI, key.trim());
    return true;
  }

  const recheckVisible = () => {
    for (const editor of vscode.window.visibleTextEditors) if (isProse(editor.document)) engine.onOpen(editor.document.uri.toString());
  };

  context.subscriptions.push(
    output,
    diagnostics,
    status,
    { dispose: () => engine.dispose() },
    context.secrets.onDidChange(async (e) => {
      if (e.key !== SECRET_GEMINI) return;
      geminiKey = await context.secrets.get(SECRET_GEMINI);
      recheckVisible();
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!isProse(e.document) || !e.contentChanges.length) return;
      const key = e.document.uri.toString();
      const list = entries.get(key);
      if (list?.length) {
        // Edits outside a sentence don't change its text, so `before` is re-read at the moved range.
        const changes = e.contentChanges.map((c) => ({ offset: c.rangeOffset, length: c.rangeLength, inserted: c.text.length }));
        setEntries(key, shiftSuggestions(list.map((x) => x.suggestion), changes));
      }
      engine.onEdit(key);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => isProse(doc) && engine.onSave(doc.uri.toString())),
    vscode.workspace.onDidOpenTextDocument((doc) => isProse(doc) && engine.onOpen(doc.uri.toString())),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      engine.onClose(key);
      entries.delete(key);
      diagnostics.delete(doc.uri);
    }),
    vscode.languages.onDidChangeDiagnostics((e) => {
      // Harper re-linted: drop our suggestions that now overlap its lints.
      for (const uri of e.uris) {
        const key = uri.toString();
        const doc = docFor(key);
        const list = entries.get(key);
        if (!doc || !list?.length) continue;
        const kept = new Set(withoutHarperOverlaps(list.map((x) => x.suggestion), harperRanges(doc)));
        if (kept.size !== list.length) {
          entries.set(key, list.filter((x) => kept.has(x.suggestion)));
          render(key);
        }
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('margin.severity')) for (const key of entries.keys()) render(key);
      if (e.affectsConfiguration('margin.enabled') && !config().get<boolean>('enabled', true)) {
        entries.clear();
        diagnostics.clear();
        showStatus({ state: 'off' });
      }
      if (e.affectsConfiguration('margin') || e.affectsConfiguration('harper.dialect')) recheckVisible();
    }),
    vscode.languages.registerCodeActionsProvider(
      LANGUAGES.map((language) => ({ language })),
      {
        provideCodeActions(doc, range) {
          const key = doc.uri.toString();
          const text = doc.getText();
          const actions: vscode.CodeAction[] = [];
          const sentencesDone = new Set<number>(); // one "whole sentence" and one "ignore" per sentence
          for (const { suggestion: s, before } of entries.get(key) ?? []) {
            const r = new vscode.Range(doc.positionAt(s.range.start), doc.positionAt(s.range.end));
            const sentence = new vscode.Range(doc.positionAt(s.sentence.start), doc.positionAt(s.sentence.end));
            if (!sentence.intersection(range) && !r.intersection(range)) continue;
            if (text.slice(s.range.start, s.range.end) !== before) continue; // the text moved on; wait for the next check
            const label = s.replacement ? (before ? `Change "${before}" to "${s.replacement}"` : `Insert "${s.replacement.trim()}"`) : `Remove "${before}"`;
            const fix = new vscode.CodeAction(`Margin: ${label}`, vscode.CodeActionKind.QuickFix);
            fix.edit = new vscode.WorkspaceEdit();
            fix.edit.replace(doc.uri, r, s.replacement);
            fix.isPreferred = true;
            actions.push(fix);
            if (sentencesDone.has(s.sentence.start)) continue;
            sentencesDone.add(s.sentence.start);
            if (text.slice(s.sentence.start, s.sentence.end) === s.sentence.original && s.sentence.fixed !== s.sentence.original) {
              const whole = new vscode.CodeAction('Margin: Fix the whole sentence', vscode.CodeActionKind.QuickFix);
              whole.edit = new vscode.WorkspaceEdit();
              whole.edit.replace(doc.uri, sentence, s.sentence.fixed);
              actions.push(whole);
            }
            const ignore = new vscode.CodeAction('Margin: Ignore this suggestion', vscode.CodeActionKind.QuickFix);
            ignore.command = { command: 'margin.ignore', title: 'Ignore', arguments: [key, s.sentence.original, s.sentence.fixed] };
            actions.push(ignore);
          }
          return actions;
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
    vscode.commands.registerCommand('margin.checkDocument', async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (doc && isProse(doc)) await engine.checkNow(doc.uri.toString());
    }),
    vscode.commands.registerCommand('margin.checkSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isProse(editor.document)) return;
      const doc = editor.document;
      const ranges = editor.selections.map((s) => ({ start: doc.offsetAt(s.start), end: doc.offsetAt(s.end) }));
      const result = await engine.checkNow(doc.uri.toString(), ranges);
      // A selection check replaces only the suggestions inside the selection.
      if (result) {
        const key = doc.uri.toString();
        const outside = (entries.get(key) ?? []).filter((x) => !ranges.some((r) => x.suggestion.sentence.start < r.end && r.start < x.suggestion.sentence.end));
        setEntries(key, [...outside.map((x) => x.suggestion), ...result.suggestions]);
      }
    }),
    vscode.commands.registerCommand('margin.chooseProvider', chooseProvider),
    ...registerRewrite({
      model: modelState,
      dialect: (doc) => vscode.workspace.getConfiguration('harper', doc.uri).get<Dialect>('dialect', 'American'),
      isProse,
      setup: chooseProvider,
      log: (line) => output.appendLine(`[${new Date().toISOString()}] ${line}`),
    }),
    vscode.commands.registerCommand('margin.setGeminiKey', setGeminiKey),
    vscode.commands.registerCommand('margin.clearCache', async () => {
      await cache.clear();
      void vscode.window.showInformationMessage('Margin: cache cleared.');
    }),
    vscode.commands.registerCommand('margin.clearIgnored', async () => {
      ignored = new Set();
      await context.globalState.update(IGNORED_KEY, []);
      recheckVisible();
    }),
    vscode.commands.registerCommand('margin.toggle', () => config().update('enabled', !config().get<boolean>('enabled', true), vscode.ConfigurationTarget.Global)),
    vscode.commands.registerCommand('margin.ignore', async (key: string, original: string, fixed: string) => {
      ignored.add(await ignoreKey(original, fixed));
      await context.globalState.update(IGNORED_KEY, [...ignored]);
      entries.set(key, (entries.get(key) ?? []).filter((x) => !(x.suggestion.sentence.original === original && x.suggestion.sentence.fixed === fixed)));
      render(key);
    }),
    vscode.commands.registerCommand('margin.showStatus', async () => {
      const s = lastStatus;
      const items = [
        { label: '$(play) Check this document', id: 'check' },
        { label: '$(edit) Rewrite selection…', id: 'rewrite' },
        { label: '$(server) Choose where text is checked…', id: 'provider' },
        { label: '$(key) Set Gemini API key…', id: 'key' },
        { label: config().get<boolean>('enabled', true) ? '$(circle-slash) Turn Margin off' : '$(check) Turn Margin on', id: 'toggle' },
        { label: '$(trash) Clear cache', id: 'cache' },
        { label: '$(output) Show log', id: 'log' },
      ];
      const pick = await vscode.window.showQuickPick(items, { title: `Margin: ${s.state}${'model' in s ? ` · ${s.model}` : ''}` });
      const commands: Record<string, string> = {
        check: 'margin.checkDocument',
        rewrite: 'margin.rewriteSelection',
        provider: 'margin.chooseProvider',
        key: 'margin.setGeminiKey',
        toggle: 'margin.toggle',
        cache: 'margin.clearCache',
      };
      if (pick?.id === 'log') output.show();
      else if (pick) await vscode.commands.executeCommand(commands[pick.id]!);
    }),
  );

  const initial = modelState();
  showStatus(initial.ok ? { state: 'ready', model: initial.model.id, tested: initial.model.tested } : { state: initial.reason });
  if (!initial.ok && initial.reason === 'needs-setup' && !context.globalState.get<boolean>(SETUP_SHOWN_KEY)) {
    void context.globalState.update(SETUP_SHOWN_KEY, true);
    void vscode.window
      .showInformationMessage('Margin adds an AI second pass to Harper. Choose where your text is checked to start.', 'Set up', 'Not now')
      .then((choice) => {
        if (choice === 'Set up') void chooseProvider();
      });
  }
  recheckVisible();
}

export async function deactivate(): Promise<void> {
  await persistentCache?.flush();
}

const SEVERITY: Record<string, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};
