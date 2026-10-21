/**
 * Drawing: underlines in contenteditable via the CSS Custom Highlight API (no DOM
 * changes to the page), a transparent mirror over textareas, and cards in Shadow DOM
 * so page styles can't leak in or out.
 */

const COLOR = '#7c3aed';
const HIGHLIGHT = 'margin-suggestion';
const Z = '2147483646';

let styleInjected = false;
const highlightRanges = new Map<Element, Range[]>();

/** Underlines ranges inside a contenteditable field (all fields share one highlight). */
export function highlight(field: Element, ranges: Range[]) {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
  if (!styleInjected) {
    const style = document.createElement('style');
    style.textContent = `::highlight(${HIGHLIGHT}) { text-decoration: underline wavy ${COLOR}; text-decoration-thickness: 1.5px; text-underline-offset: 3px; }`;
    document.documentElement.append(style);
    styleInjected = true;
  }
  if (ranges.length) highlightRanges.set(field, ranges);
  else highlightRanges.delete(field);
  CSS.highlights.set(HIGHLIGHT, new Highlight(...[...highlightRanges.values()].flat()));
}

const MIRRORED = [
  'boxSizing', 'width', 'height', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch', 'letterSpacing', 'lineHeight',
  'textTransform', 'textIndent', 'textAlign', 'wordSpacing', 'tabSize', 'direction',
] as const;

/** A transparent copy of a textarea's text, positioned over it, with the suggestions underlined. */
export class Mirror {
  private readonly host = document.createElement('div');
  private readonly box: HTMLDivElement;
  private readonly marks: HTMLSpanElement[] = [];
  private readonly observer: ResizeObserver;
  private readonly onScroll = () => this.sync();

  constructor(private readonly textarea: HTMLTextAreaElement) {
    this.host.style.cssText = `position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:${Z}`;
    const shadow = this.host.attachShadow({ mode: 'closed' });
    this.box = document.createElement('div');
    shadow.append(this.box);
    document.documentElement.append(this.host);
    this.observer = new ResizeObserver(() => this.sync());
    this.observer.observe(textarea);
    textarea.addEventListener('scroll', this.onScroll);
    window.addEventListener('scroll', this.onScroll, true);
    window.addEventListener('resize', this.onScroll);
  }

  render(text: string, ranges: { start: number; end: number }[]) {
    this.box.replaceChildren();
    this.marks.length = 0;
    let pos = 0;
    for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
      let { start, end } = r;
      if (start === end) {
        // An insertion: underline the word before it.
        while (start > 0 && /\S/.test(text[start - 1]!)) start--;
      }
      if (start < pos) continue;
      this.box.append(text.slice(pos, start));
      const mark = document.createElement('span');
      mark.textContent = text.slice(start, end) || ' ';
      mark.style.cssText = `text-decoration:underline wavy ${COLOR};text-decoration-thickness:1.5px;text-underline-offset:3px`;
      this.box.append(mark);
      this.marks.push(mark);
      pos = end;
    }
    this.box.append(`${text.slice(pos)}\n`);
    this.sync();
  }

  /** Screen rectangle of the n-th underline (sorted by position). */
  rect(index: number): DOMRect | undefined {
    return this.marks[index]?.getBoundingClientRect();
  }

  sync() {
    const cs = getComputedStyle(this.textarea);
    const r = this.textarea.getBoundingClientRect();
    const s = this.box.style;
    for (const p of MIRRORED) s[p] = cs[p];
    s.position = 'absolute';
    s.top = `${r.top + window.scrollY}px`;
    s.left = `${r.left + window.scrollX}px`;
    s.width = `${r.width}px`;
    s.height = `${r.height}px`;
    s.borderColor = 'transparent';
    s.color = 'transparent';
    s.background = 'transparent';
    s.whiteSpace = 'pre-wrap';
    s.overflowWrap = 'break-word';
    s.overflow = 'hidden';
    s.margin = '0';
    this.box.scrollTop = this.textarea.scrollTop;
    this.box.scrollLeft = this.textarea.scrollLeft;
  }

  dispose() {
    this.observer.disconnect();
    this.textarea.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('resize', this.onScroll);
    this.host.remove();
  }
}

export interface CardButton {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

/** A small floating card (one at a time). Returns handles to update or close it. */
export function showCard(
  anchor: DOMRect,
  build: (body: HTMLElement) => void,
  buttons: CardButton[],
): { body: HTMLElement; setButtons: (b: CardButton[]) => void; close: () => void } {
  closeCard();
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;z-index:${Z};top:0;left:0`;
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    .card{position:fixed;max-width:380px;min-width:240px;background:#fff;color:#1f2937;border:1px solid #e5e7eb;border-radius:10px;
      box-shadow:0 8px 24px rgba(0,0,0,.15);font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;padding:10px 12px}
    .title{font-weight:600;color:${COLOR};margin-bottom:4px;font-size:12px;letter-spacing:.02em}
    .body{white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto}
    .why{color:#6b7280;margin-top:4px}
    .warn{color:#b45309;margin-top:6px}
    del{color:#b91c1c} ins{color:#047857;text-decoration:none;font-weight:600}
    .row{display:flex;gap:6px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap}
    button{font:inherit;border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:3px 10px;cursor:pointer}
    button.primary{background:${COLOR};border-color:${COLOR};color:#fff}
    input{font:inherit;width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:6px;padding:4px 6px}
    @media (prefers-color-scheme: dark){.card{background:#1f2937;color:#f3f4f6;border-color:#374151}button{background:#111827;color:#f3f4f6;border-color:#4b5563}.why{color:#9ca3af}}
  </style><div class="card" role="dialog" aria-label="Margin"><div class="title">Margin</div><div class="body"></div><div class="row"></div></div>`;
  const card = shadow.querySelector('.card') as HTMLElement;
  const body = shadow.querySelector('.body') as HTMLElement;
  const row = shadow.querySelector('.row') as HTMLElement;
  build(body);
  const setButtons = (list: CardButton[]) => {
    row.replaceChildren(
      ...list.map((b) => {
        const el = document.createElement('button');
        el.textContent = b.label;
        if (b.primary) el.className = 'primary';
        el.addEventListener('mousedown', (e) => e.preventDefault()); // keep the field's focus and selection
        el.addEventListener('click', b.onClick);
        return el;
      }),
    );
  };
  setButtons(buttons);
  document.documentElement.append(host);
  // Above the anchor when there's room: Grammarly's and Harper's cards open below the same word.
  const h = card.offsetHeight || 120;
  const top = anchor.top - h - 6 >= 4 ? anchor.top - h - 6 : anchor.bottom + 6;
  card.style.top = `${top}px`;
  card.style.left = `${Math.min(Math.max(4, anchor.left), window.innerWidth - 390)}px`;
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  const onDown = (e: MouseEvent) => !e.composedPath().includes(host) && close();
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onDown, true);
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onDown, true);
    host.remove();
    if (current?.host === host) current = undefined;
  };
  current = { host, close };
  return { body, setButtons, close };
}

let current: { host: HTMLElement; close: () => void } | undefined;

export function closeCard() {
  current?.close();
}

/** "before → after" with del/ins styling, built with text nodes (never innerHTML with page or model text). */
export function changeLine(before: string, after: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (before) {
    const del = document.createElement('del');
    del.textContent = before;
    frag.append(del);
  }
  if (before && after) frag.append(' → ');
  if (after) {
    const ins = document.createElement('ins');
    ins.textContent = after;
    frag.append(ins);
  } else frag.append(' (remove)');
  return frag;
}
