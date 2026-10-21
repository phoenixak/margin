/**
 * A web text field as plain text with exact offsets. Textareas are easy (`value`);
 * contenteditable is walked node by node, with block boundaries and <br> as "\n",
 * so every offset maps back to a DOM point.
 */

export interface Segment {
  node: Text;
  /** Offset of the node's first character in the field text. */
  start: number;
}

export interface FieldText {
  text: string;
  segments: Segment[];
}

const BLOCK = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

export type Field = HTMLTextAreaElement | HTMLElement;

export const isTextArea = (el: Element): el is HTMLTextAreaElement => el.tagName === 'TEXTAREA';

/** The editable root for an event target, or undefined if Margin shouldn't touch it. */
export function editableRoot(target: EventTarget | null): Field | undefined {
  if (!(target instanceof Element)) return undefined;
  if (isTextArea(target)) return target.readOnly || target.disabled || target.getAttribute('spellcheck') === 'false' ? undefined : target;
  const host = target.closest('[contenteditable]:not([contenteditable="false"])');
  if (!(host instanceof HTMLElement) || !host.isContentEditable) return undefined;
  // The outermost editing host, so a whole editor is one field.
  let root: HTMLElement = host;
  while (root.parentElement?.isContentEditable) root = root.parentElement;
  // Code editors and similar opt out of spellcheck; respect that.
  return root.getAttribute('spellcheck') === 'false' ? undefined : root;
}

export function readField(el: Field): FieldText {
  if (isTextArea(el)) return { text: el.value, segments: [] };
  let text = '';
  const segments: Segment[] = [];
  const newline = () => {
    if (text && !text.endsWith('\n')) text += '\n';
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node as Text;
      if (t.data) {
        segments.push({ node: t, start: text.length });
        text += t.data;
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (SKIP.has(el.tagName) || el.getAttribute('contenteditable') === 'false') return;
    if (el.tagName === 'BR') {
      text += '\n';
      return;
    }
    const block = BLOCK.has(el.tagName);
    if (block) newline();
    for (const child of el.childNodes) walk(child);
    if (block) newline();
  };
  for (const child of el.childNodes) walk(child);
  return { text, segments };
}

/** The DOM point for a text offset (contenteditable only). Offsets inside a virtual "\n" snap to the next text node. */
export function pointAt(field: FieldText, offset: number): { node: Text; offset: number } | undefined {
  let best: Segment | undefined;
  for (const s of field.segments) {
    if (offset >= s.start && offset <= s.start + s.node.data.length) {
      best = s;
      if (offset < s.start + s.node.data.length) break; // prefer the node that contains the character
    } else if (s.start > offset) {
      return best ? { node: best.node, offset: offset - best.start } : { node: s.node, offset: 0 };
    }
  }
  return best ? { node: best.node, offset: offset - best.start } : undefined;
}

/** The text offset of a DOM point inside the field (contenteditable), or undefined. */
export function offsetOf(field: FieldText, node: Node, offset: number): number | undefined {
  const seg = field.segments.find((s) => s.node === node);
  if (seg) return seg.start + offset;
  // An element point: use the first text segment at or after it.
  const target = node.childNodes[offset] ?? node;
  const after = field.segments.find((s) => target === s.node || target.contains(s.node) || (target.compareDocumentPosition(s.node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  return after?.start;
}

export function rangeAt(field: FieldText, start: number, end: number): Range | undefined {
  const a = pointAt(field, start);
  const b = pointAt(field, end);
  if (!a || !b) return undefined;
  const range = a.node.ownerDocument.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

/**
 * Replaces [start, end) with `replacement`, as a user edit (undoable, and seen by
 * frameworks like React through the input event). Returns false if it couldn't.
 */
export function replaceText(el: Field, start: number, end: number, replacement: string): boolean {
  const doc = el.ownerDocument;
  if (isTextArea(el)) {
    el.focus();
    el.setSelectionRange(start, end);
    // execCommand keeps the undo stack; setRangeText is the fallback.
    if (!doc.execCommand?.('insertText', false, replacement)) {
      el.setRangeText(replacement, start, end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  }
  const range = rangeAt(readField(el), start, end);
  if (!range) return false;
  el.focus();
  const selection = doc.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  if (!doc.execCommand?.('insertText', false, replacement)) {
    range.deleteContents();
    if (replacement) range.insertNode(doc.createTextNode(replacement));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: replacement }));
  }
  return true;
}

/** The selection inside a field as offsets, or undefined if nothing is selected there. */
export function selectionIn(el: Field): { start: number; end: number } | undefined {
  if (isTextArea(el)) return el.selectionStart !== el.selectionEnd ? { start: el.selectionStart, end: el.selectionEnd } : undefined;
  const sel = el.ownerDocument.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return undefined;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.commonAncestorContainer)) return undefined;
  const field = readField(el);
  const start = offsetOf(field, r.startContainer, r.startOffset);
  const end = offsetOf(field, r.endContainer, r.endOffset);
  return start !== undefined && end !== undefined && end > start ? { start, end } : undefined;
}

/** The caret offset inside a field. */
export function caretIn(el: Field): number | undefined {
  if (isTextArea(el)) return el.selectionStart;
  const sel = el.ownerDocument.getSelection();
  if (!sel?.rangeCount || !el.contains(sel.anchorNode)) return undefined;
  return offsetOf(readField(el), sel.anchorNode!, sel.anchorOffset);
}
