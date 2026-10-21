import { diffText, type RewritePreset, shiftSuggestions, type Suggestion } from '@margin/core';
import { caretIn, editableRoot, type Field, isTextArea, rangeAt, readField, replaceText, selectionIn } from './field.js';
import { changeLine, closeCard, highlight, Mirror, showCard } from './overlay.js';
import type { CheckResponse, Request, RewritePortIn, RewritePortOut, Settings, TabMessage } from './settings.js';

/*
 * Runs only on sites the user enabled (and once on a page where they used the
 * rewrite menu). Watches text fields, asks the background to check them after a
 * pause, and draws the results. It never sends anything itself.
 */

declare global {
  interface Window {
    __margin?: boolean;
  }
}

const MIN_CHARS = 15;
const WARNINGS: Record<string, string> = {
  placeholders: 'code, links or URLs may have changed',
  negation: 'a “not”/“never” was added or removed',
  numbers: 'numbers changed',
};

interface FieldState {
  text: string;
  suggestions: (Suggestion & { before: string })[];
  timer?: ReturnType<typeof setTimeout>;
  requestId?: string;
  mirror?: Mirror;
}

const states = new WeakMap<Field, FieldState>();
let idleDelayMs = 2000;
let setupShown = false;

const send = <T>(req: Request) => chrome.runtime.sendMessage(req) as Promise<T>;

function state(field: Field): FieldState {
  let s = states.get(field);
  if (!s) {
    s = { text: readField(field).text, suggestions: [] };
    states.set(field, s);
    field.addEventListener('input', () => onInput(field));
    field.addEventListener('click', () => maybeShowSuggestion(field));
    field.addEventListener('keyup', (e) => (e as KeyboardEvent).key.startsWith('Arrow') && maybeShowSuggestion(field));
  }
  return s;
}

function render(field: Field) {
  const s = state(field);
  if (isTextArea(field)) {
    if (!s.suggestions.length) {
      s.mirror?.dispose();
      s.mirror = undefined;
      return;
    }
    s.mirror ??= new Mirror(field);
    s.mirror.render(s.text, s.suggestions.map((x) => x.range));
    return;
  }
  const text = readField(field);
  highlight(
    field,
    s.suggestions.flatMap((x) => {
      const start = x.range.start === x.range.end ? Math.max(0, x.range.start - 1) : x.range.start;
      const r = rangeAt(text, start, x.range.end === x.range.start ? x.range.start : x.range.end);
      return r ? [r] : [];
    }),
  );
}

function onInput(field: Field) {
  const s = state(field);
  const text = readField(field).text;
  const change = diffText(s.text, text);
  s.text = text;
  if (change && s.suggestions.length) {
    // Keep underlines on the right words until the next check; drop ones in edited sentences.
    const shifted = shiftSuggestions(s.suggestions, [change]) as FieldState['suggestions'];
    s.suggestions = shifted.filter((x) => text.slice(x.range.start, x.range.end) === x.before);
    render(field);
  }
  if (s.requestId) void send({ type: 'cancel', id: s.requestId });
  clearTimeout(s.timer);
  s.timer = setTimeout(() => void runCheck(field), idleDelayMs);
}

async function runCheck(field: Field) {
  const s = state(field);
  const text = readField(field).text;
  if (text.trim().length < MIN_CHARS) return;
  const id = crypto.randomUUID();
  s.requestId = id;
  const res = await send<CheckResponse>({ type: 'check', id, text });
  if (s.requestId !== id) return;
  s.requestId = undefined;
  if (!res.ok) {
    if (res.setup && !setupShown) {
      setupShown = true;
      const r = field.getBoundingClientRect();
      showCard(r, (b) => (b.textContent = res.error), [
        { label: 'Open options', primary: true, onClick: () => void chrome.runtime.sendMessage({ type: 'open-options' }) },
        { label: 'Not now', onClick: closeCard },
      ]);
    }
    if (!res.cancelled) console.debug('[Margin]', res.error);
    return;
  }
  if (readField(field).text !== text) return; // stale: the user kept typing
  s.text = text;
  s.suggestions = res.suggestions.map((x) => ({ ...x, before: text.slice(x.range.start, x.range.end) }));
  render(field);
}

function rectFor(field: Field, index: number): DOMRect {
  const s = state(field);
  const x = s.suggestions[index]!;
  if (isTextArea(field)) {
    const sorted = [...s.suggestions].sort((a, b) => a.range.start - b.range.start);
    return s.mirror?.rect(sorted.indexOf(x)) ?? field.getBoundingClientRect();
  }
  const r = rangeAt(readField(field), x.range.start, Math.max(x.range.end, x.range.start));
  const rect = r?.getBoundingClientRect();
  return rect && rect.width + rect.height > 0 ? rect : field.getBoundingClientRect();
}

function maybeShowSuggestion(field: Field) {
  const s = state(field);
  const caret = caretIn(field);
  if (caret === undefined) return;
  const index = s.suggestions.findIndex((x) => caret >= Math.max(0, x.range.start - (x.range.start === x.range.end ? 1 : 0)) && caret <= x.range.end);
  if (index < 0) return;
  const x = s.suggestions[index]!;
  const card = showCard(
    rectFor(field, index),
    (body) => {
      body.append(changeLine(x.before, x.replacement));
      if (x.why) {
        const why = document.createElement('div');
        why.className = 'why';
        why.textContent = x.why;
        body.append(why);
      }
    },
    [
      { label: 'Ignore', onClick: () => void ignore(field, x).then(card.close) },
      {
        label: 'Apply',
        primary: true,
        onClick: () => {
          card.close();
          if (readField(field).text.slice(x.range.start, x.range.end) !== x.before) return;
          s.suggestions = s.suggestions.filter((y) => y !== x);
          replaceText(field, x.range.start, x.range.end, x.replacement);
        },
      },
    ],
  );
}

async function ignore(field: Field, x: Suggestion) {
  await send({ type: 'ignore', original: x.sentence.original, fixed: x.sentence.fixed });
  const s = state(field);
  s.suggestions = s.suggestions.filter((y) => y.sentence.start !== x.sentence.start);
  render(field);
}

/** Context menu → Margin: rewrite. Streams into a card; Accept replaces the selection if it's unchanged. */
async function rewriteSelection(preset: RewritePreset) {
  const field = editableRoot(document.activeElement);
  const sel = field && selectionIn(field);
  const anchor = field?.getBoundingClientRect() ?? new DOMRect(16, 16, 0, 0);
  if (!field || !sel) {
    showCard(anchor, (b) => (b.textContent = 'Select some text in a text field, then choose Margin: rewrite.'), [{ label: 'OK', onClick: closeCard }]);
    return;
  }
  const original = readField(field).text.slice(sel.start, sel.end);

  const start = (instruction?: string) => {
    const port = chrome.runtime.connect({ name: 'rewrite' });
    let result: { text: string } | undefined;
    const card = showCard(anchor, (b) => (b.textContent = '…'), [{ label: 'Cancel', onClick: () => (port.disconnect(), card.close()) }]);
    port.onMessage.addListener((m: RewritePortOut) => {
      if (m.type === 'delta') card.body.textContent = m.text;
      if (m.type === 'error') {
        card.body.textContent = m.error;
        card.setButtons([{ label: 'Close', onClick: card.close }]);
      }
      if (m.type === 'done') {
        result = { text: m.text };
        card.body.textContent = m.text;
        if (m.warnings.length) {
          const w = document.createElement('div');
          w.className = 'warn';
          w.textContent = `Check before accepting: ${m.warnings.map((x) => WARNINGS[x] ?? x).join('; ')}.`;
          card.body.append(w);
        }
        card.setButtons([
          { label: 'Reject', onClick: card.close },
          {
            label: 'Accept',
            primary: true,
            onClick: () => {
              card.close();
              if (readField(field).text.slice(sel.start, sel.end) !== original) {
                showCard(anchor, (b) => (b.textContent = 'The text changed, so the rewrite was not applied.'), [{ label: 'OK', onClick: closeCard }]);
                return;
              }
              replaceText(field, sel.start, sel.end, result!.text);
            },
          },
        ]);
        port.disconnect();
      }
    });
    port.postMessage({ type: 'start', text: original, preset, ...(instruction ? { instruction } : {}) } satisfies RewritePortIn);
  };

  if (preset !== 'custom') return start();
  let input: HTMLInputElement;
  const card = showCard(
    anchor,
    (b) => {
      input = document.createElement('input');
      input.placeholder = 'How should it be rewritten?';
      input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
      b.append(input);
      setTimeout(() => input.focus(), 0);
    },
    [{ label: 'Rewrite', primary: true, onClick: () => go() }],
  );
  const go = () => {
    const text = input.value.trim();
    if (!text) return;
    card.close();
    start(text);
  };
}

if (!window.__margin && !/(^|\.)docs\.google\.com$/.test(location.hostname)) {
  window.__margin = true;
  void chrome.storage.local.get('settings').then((r) => {
    idleDelayMs = (r.settings as Partial<Settings> | undefined)?.idleDelayMs ?? 2000;
  });
  document.addEventListener('focusin', (e) => {
    const field = editableRoot(e.target);
    if (field && !states.has(field)) {
      state(field);
      void runCheck(field);
    }
  });
  chrome.runtime.onMessage.addListener((msg: TabMessage) => {
    if (msg.type === 'rewrite-selection') void rewriteSelection(msg.preset);
  });
}
