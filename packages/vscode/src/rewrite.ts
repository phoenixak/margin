import { type Dialect, type ModelState, REWRITE_PRESETS, type RewritePreset, rewrite } from '@margin/core';
import * as vscode from 'vscode';

const SCHEME = 'margin-rewrite';
const WARNINGS: Record<string, string> = {
  placeholders: 'code, links or URLs may have changed',
  negation: 'a "not"/"never" was added or removed',
  numbers: 'numbers changed',
};

export interface RewriteDeps {
  model: () => ModelState;
  dialect: (doc: vscode.TextDocument) => Dialect;
  isProse: (doc: vscode.TextDocument) => boolean;
  setup: () => Promise<void>;
  log: (line: string) => void;
}

/**
 * "Margin: Rewrite selection": pick a preset, stream the result into a diff view,
 * then accept or reject. Accept applies only if the selected text is unchanged.
 */
export function registerRewrite(deps: RewriteDeps): vscode.Disposable[] {
  const contents = new Map<string, string>();
  const changed = new vscode.EventEmitter<vscode.Uri>();
  let next = 0;

  const provider: vscode.TextDocumentContentProvider = {
    onDidChange: changed.event,
    provideTextDocumentContent: (uri) => contents.get(uri.toString()) ?? '',
  };

  async function run(presetArg?: RewritePreset) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty || !deps.isProse(editor.document)) {
      void vscode.window.showInformationMessage('Margin: select some Markdown or plain text to rewrite.');
      return;
    }
    const m = deps.model();
    if (!m.ok) {
      if (m.reason === 'off') return void vscode.window.showInformationMessage('Margin is turned off.');
      return deps.setup();
    }

    const preset = presetArg ?? (await pickPreset());
    if (!preset) return;
    let instruction: string | undefined;
    if (preset === 'custom') {
      instruction = await vscode.window.showInputBox({ title: 'Margin: how should it be rewritten?', placeHolder: 'e.g. make it sound more confident' });
      if (!instruction?.trim()) return;
    }

    const doc = editor.document;
    const range = editor.selection;
    const original = doc.getText(range);
    const ext = doc.languageId === 'markdown' ? 'md' : 'txt';
    const id = ++next;
    const left = vscode.Uri.from({ scheme: SCHEME, path: `/${id}/original.${ext}` });
    const right = vscode.Uri.from({ scheme: SCHEME, path: `/${id}/rewritten.${ext}` });
    contents.set(left.toString(), original);
    contents.set(right.toString(), '');
    const label = preset === 'custom' ? 'Custom' : REWRITE_PRESETS[preset].label;
    await vscode.commands.executeCommand('vscode.diff', left, right, `Margin: ${label} rewrite`, { preview: true, viewColumn: vscode.ViewColumn.Beside });

    const cleanup = async () => {
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.toString() === right.toString()) await vscode.window.tabGroups.close(tab);
        }
      }
      contents.delete(left.toString());
      contents.delete(right.toString());
    };

    const started = Date.now();
    let result: { text: string; warnings: string[] } | undefined;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Margin: ${label} rewrite…`, cancellable: true },
      async (_progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        try {
          const r = rewrite({ text: original, model: m.model, preset, dialect: deps.dialect(doc), signal: controller.signal, ...(instruction ? { instruction } : {}) });
          let buffer = '';
          let lastFire = 0;
          for await (const part of r.textStream) {
            buffer += part;
            contents.set(right.toString(), buffer);
            if (Date.now() - lastFire > 100) {
              changed.fire(right);
              lastFire = Date.now();
            }
          }
          result = await r.done;
          contents.set(right.toString(), result.text);
          changed.fire(right);
        } catch (error) {
          if (!controller.signal.aborted) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Margin: rewrite failed: ${message}`);
            deps.log(`rewrite failed: ${message}`);
          }
        }
      },
    );
    if (!result) return cleanup();
    deps.log(`rewrite ${preset}: ${original.length} → ${result.text.length} chars, ${Date.now() - started} ms, warnings: ${result.warnings.join(',') || 'none'}`);

    const caution = result.warnings.length ? ` Check before accepting: ${result.warnings.map((w) => WARNINGS[w] ?? w).join('; ')}.` : '';
    const choice = await vscode.window.showInformationMessage(`Margin: ${label} rewrite ready.${caution}`, 'Accept', 'Reject');
    if (choice === 'Accept') {
      if (doc.isClosed || doc.getText(range) !== original) {
        void vscode.window.showWarningMessage('Margin: the selected text changed, so the rewrite was not applied.');
      } else {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, range, result.text);
        await vscode.workspace.applyEdit(edit);
      }
    }
    await cleanup();
  }

  return [
    changed,
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    vscode.commands.registerCommand('margin.rewriteSelection', (preset?: RewritePreset) => run(preset)),
  ];
}

async function pickPreset(): Promise<RewritePreset | undefined> {
  const items = [
    ...Object.entries(REWRITE_PRESETS).map(([id, p]) => ({ label: p.label, detail: p.instruction, id: id as RewritePreset })),
    { label: 'Custom…', detail: 'Describe the change yourself', id: 'custom' as const },
  ];
  return (await vscode.window.showQuickPick(items, { title: 'Margin: rewrite selection' }))?.id;
}
