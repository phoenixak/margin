import { PassThrough } from 'node:stream';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import type { MarginModel } from '@margin/core';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CodeAction,
  createConnection,
  createMessageConnection,
  type MessageConnection,
  type PublishDiagnosticsParams,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import { globToRegExp, startServer } from '../src/server.js';

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };

function promptText(options: LanguageModelV4CallOptions): string {
  return options.prompt.flatMap((m) => (typeof m.content === 'string' ? [m.content] : m.content.flatMap((p) => (p.type === 'text' ? [p.text] : [])))).join('\n');
}

/** Fixes "They was" → "They were" in check mode; rewrites to a fixed sentence when streaming. */
const mock = new MockLanguageModelV4({
  provider: 'mock',
  modelId: 'm',
  doGenerate: async (options) => {
    const input = promptText(options).slice(promptText(options).lastIndexOf('Example output:'));
    const fixes = [...input.matchAll(/<s id="(\d+)">(.*?)<\/s>/g)]
      .filter((m) => m[2]!.includes('They was'))
      .map((m) => ({ id: Number(m[1]), text: m[2]!.replace('They was', 'They were'), kind: 'grammar', why: 'Agreement.' }));
    return { content: [{ type: 'text', text: JSON.stringify({ fixes }) }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] };
  },
  doStream: async () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: 'text-start' as const, id: 't' },
        { type: 'text-delta' as const, id: 't', delta: 'The sky is a lovely blue today.' },
        { type: 'text-end' as const, id: 't' },
        { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: 'stop' }, usage },
      ],
    }),
  }),
});
const model: MarginModel = { id: 'mock:m', model: mock, foldSystem: false, structured: true, tested: true, parallel: 1, provider: 'local', modelId: 'm' };

let client: MessageConnection | undefined;
afterEach(() => client?.dispose());

async function start() {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  startServer(createConnection(toServer, toClient), { model: () => ({ ok: true, model }), harperRanges: async () => [] });
  const c = createMessageConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer));
  client = c;
  const diagnostics: PublishDiagnosticsParams[] = [];
  let waiter: (() => void) | undefined;
  c.onNotification('textDocument/publishDiagnostics', (p: PublishDiagnosticsParams) => {
    diagnostics.push(p);
    waiter?.();
  });
  const edits: unknown[] = [];
  c.onRequest('workspace/applyEdit', (p: unknown) => {
    edits.push(p);
    return { applied: true };
  });
  c.onNotification('window/showMessage', () => {});
  c.onNotification('window/logMessage', () => {});
  c.listen();
  await c.sendRequest('initialize', { processId: null, rootUri: null, capabilities: {}, initializationOptions: { margin: { provider: 'local', idleDelayMs: 10 } } });
  c.sendNotification('initialized', {});
  const nextDiagnostics = () => new Promise<PublishDiagnosticsParams>((resolve) => (waiter = () => resolve(diagnostics.at(-1)!)));
  return { c, diagnostics, edits, nextDiagnostics };
}

const uri = 'file:///notes/a.md';
const text = 'They was late. The sky is blue today.\n';

describe('margin-ls', () => {
  it('publishes diagnostics, offers quick fixes, and honours ignore', async () => {
    const { c, nextDiagnostics } = await start();
    const first = nextDiagnostics();
    c.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'markdown', version: 1, text } });
    const d = await first;
    expect(d.diagnostics).toHaveLength(1);
    expect(d.diagnostics[0]).toMatchObject({ source: 'Margin', code: 'grammar', range: { start: { line: 0, character: 5 }, end: { line: 0, character: 8 } } });
    expect(d.diagnostics[0]!.message).toContain('"was" → "were"');

    const actions = (await c.sendRequest('textDocument/codeAction', {
      textDocument: { uri },
      range: d.diagnostics[0]!.range,
      context: { diagnostics: d.diagnostics },
    })) as CodeAction[];
    expect(actions.map((a) => a.title)).toEqual(['Margin: Change "was" to "were"', 'Margin: Fix the whole sentence', 'Margin: Ignore this suggestion']);
    expect(actions[0]!.edit!.changes![uri]![0]!.newText).toBe('were');

    const cleared = nextDiagnostics();
    await c.sendRequest('workspace/executeCommand', { command: actions[2]!.command!.command, arguments: actions[2]!.command!.arguments });
    expect((await cleared).diagnostics).toEqual([]);
  });

  it('rewrites a selection through workspace/applyEdit', async () => {
    const { c, edits, nextDiagnostics } = await start();
    const opened = nextDiagnostics();
    c.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'markdown', version: 1, text } });
    await opened;
    const range = { start: { line: 0, character: 15 }, end: { line: 0, character: 37 } };
    const actions = (await c.sendRequest('textDocument/codeAction', { textDocument: { uri }, range, context: { diagnostics: [] } })) as CodeAction[];
    const formal = actions.find((a) => a.title === 'Margin: Rewrite (Formal)')!;
    await c.sendRequest('workspace/executeCommand', { command: formal.command!.command, arguments: formal.command!.arguments });
    expect(edits).toHaveLength(1);
    expect(JSON.stringify(edits[0])).toContain('The sky is a lovely blue today.');
  });
});

describe('globToRegExp', () => {
  it('matches the default exclude globs', () => {
    expect(globToRegExp('**/.env*').test('/home/u/project/.env.local')).toBe(true);
    expect(globToRegExp('**/secrets/**').test('/p/secrets/a.md')).toBe(true);
    expect(globToRegExp('**/*.pem').test('/p/notes.md')).toBe(false);
  });
});
