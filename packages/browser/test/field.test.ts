// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { editableRoot, offsetOf, pointAt, rangeAt, readField, replaceText } from '../src/field.js';

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
  it('accepts textareas and contenteditable roots, skips spellcheck=false and read-only', () => {
    document.body.innerHTML = `
      <textarea id="a"></textarea>
      <textarea id="b" spellcheck="false"></textarea>
      <textarea id="c" readonly></textarea>
      <div id="d" contenteditable="true"><p><span id="e">x</span></p></div>
      <div id="f" contenteditable="true" spellcheck="false">code</div>`;
    const $ = (id: string) => document.getElementById(id);
    expect(editableRoot($('a'))?.id).toBe('a');
    expect(editableRoot($('b'))).toBeUndefined();
    expect(editableRoot($('c'))).toBeUndefined();
    expect(editableRoot($('e'))?.id).toBe('d');
    expect(editableRoot($('f'))).toBeUndefined();
  });
});
