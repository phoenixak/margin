// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { editableRoot, offsetOf, pointAt, rangeAt, readField, replaceText, widenSelection } from '../src/field.js';

function ce(html: string): HTMLElement {
  document.body.innerHTML = `<div contenteditable="true">${html}</div>`;
  return document.body.firstElementChild as HTMLElement;
}

describe('readField (contenteditable)', () => {
  it('joins blocks and <br> with newlines and keeps inline formatting inline', () => {
    const el = ce('<p>They <b>was</b> late.</p><p>Second line<br>third</p><script>x()</script>');
    expect(readField(el).text).toBe('They was late.\nSecond line\nthird\n');
  });

  it('maps offsets to DOM points and back, across inline elements', () => {
    const el = ce('<p>They <b>was</b> late.</p><p>Next one.</p>');
    const f = readField(el);
    const start = f.text.indexOf('was');
    const p = pointAt(f, start)!;
    expect(p.node.data).toBe('was');
    expect(p.offset).toBe(0);
    expect(offsetOf(f, p.node, 2)).toBe(start + 2);
    expect(rangeAt(f, start, start + 3)!.toString()).toBe('was');
    const next = f.text.indexOf('Next');
    expect(rangeAt(f, next, next + 4)!.toString()).toBe('Next');
  });

  it('maps element-boundary points, as triple-click selections produce', () => {
    const el = ce('<p>First one here.</p><p>Second <b>bold</b> end.</p>');
    const f = readField(el);
    const [p1, p2] = el.querySelectorAll('p');
    // Before the first child of p2 = start of "Second".
    expect(offsetOf(f, p2!, 0)).toBe(f.text.indexOf('Second'));
    // After all of p1's children = end of "First one here."
    expect(offsetOf(f, p1!, p1!.childNodes.length)).toBe('First one here.'.length);
    // A point in the root, between the paragraphs.
    expect(offsetOf(f, el, 1)).toBe(f.text.indexOf('Second'));
    // At the very end of the root.
    expect(offsetOf(f, el, el.childNodes.length)).toBe(f.text.indexOf(' end.') + ' end.'.length);
  });

  it('handles emoji (UTF-16 offsets, same as Margin)', () => {
    const el = ce('<p>😀 They was late.</p>');
    const f = readField(el);
    expect(rangeAt(f, f.text.indexOf('was'), f.text.indexOf('was') + 3)!.toString()).toBe('was');
  });
});

describe('replaceText', () => {
  it('replaces inside contenteditable without touching formatting elsewhere', () => {
    const el = ce('<p>They <b>was</b> late, <i>truly</i>.</p>');
    const f = readField(el);
    const start = f.text.indexOf('was');
    expect(replaceText(el, start, start + 3, 'were')).toBe(true);
    expect(readField(el).text).toBe('They were late, truly.\n');
    expect(el.querySelector('i')!.textContent).toBe('truly');
  });

  it('replaces in a textarea and fires input', () => {
    document.body.innerHTML = '<textarea>They was late.</textarea>';
    const ta = document.querySelector('textarea')!;
    let inputs = 0;
    ta.addEventListener('input', () => inputs++);
    replaceText(ta, 5, 8, 'were');
    expect(ta.value).toBe('They were late.');
    expect(inputs).toBe(1);
  });
});

describe('editableRoot', () => {
  it('accepts textareas and contenteditable roots; skips code editors, opt-outs and read-only', () => {
    document.body.innerHTML = `
      <textarea id="a"></textarea>
      <textarea id="b" spellcheck="false"></textarea>
      <textarea id="c" readonly></textarea>
      <div id="d" contenteditable="true"><p><span id="e">x</span></p></div>
      <div class="cm-editor"><div id="f" contenteditable="true">code</div></div>
      <textarea id="g" data-gramm="false"></textarea>
      <div id="h" contenteditable="true" data-margin="false">no</div>`;
    const $ = (id: string) => document.getElementById(id);
    expect(editableRoot($('a'))?.id).toBe('a');
    // Grammarly sets spellcheck="false" on fields it manages, so it must not hide them from Margin.
    expect(editableRoot($('b'))?.id).toBe('b');
    expect(editableRoot($('c'))).toBeUndefined();
    expect(editableRoot($('e'))?.id).toBe('d');
    expect(editableRoot($('f'))).toBeUndefined();
    expect(editableRoot($('g'))).toBeUndefined();
    expect(editableRoot($('h'))).toBeUndefined();
  });
});

describe('widenSelection', () => {
  const text = 'She said hi. We went to the the station. Next one.';
  const slice = (r?: { start: number; end: number }) => (r ? text.slice(r.start, r.end) : undefined);
  it('widens mid-word ends to whole words and takes the sentence-ending period', () => {
    expect(slice(widenSelection(text, text.indexOf('he said'), text.indexOf('ation.')))).toBe('She said hi. We went to the the station.');
  });
  it('trims surrounding whitespace and keeps an exact selection', () => {
    expect(slice(widenSelection(text, text.indexOf(' We'), text.indexOf('station.') + 'station.'.length + 1))).toBe('We went to the the station.');
  });
  it('leaves a following comma alone', () => {
    const t = 'The results were surprising, the team decided.';
    const r = widenSelection(t, 4, t.indexOf(','));
    expect(t.slice(r!.start, r!.end)).toBe('results were surprising');
  });
  it('returns undefined for whitespace only', () => {
    expect(widenSelection('a   b', 1, 4)).toBeUndefined();
  });
});
