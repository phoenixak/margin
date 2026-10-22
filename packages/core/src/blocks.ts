import type { Offset } from './types.js';

/**
 * A run of prose. `view` has the same length as `text.slice(start, end)`: Markdown
 * markers (list bullets, `>` quote prefixes, heading `#`s) and line breaks are replaced
 * by spaces, so offsets in `view` are offsets in the original text.
 */
export interface Block {
  start: Offset;
  end: Offset;
  view: string;
}

export type Language = 'markdown' | 'plaintext';

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MATH = /^ {0,3}\$\$/;
const HTML = /^ {0,3}<(?:[a-zA-Z][\w-]*|\/[a-zA-Z][\w-]*|!--)/;
const TABLE = /^ {0,3}\|/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const HEADING = /^ {0,3}#{1,6}(?:\s+|$)/;
// Container directives (Docusaurus/VitePress admonitions, Pandoc divs): the fence line isn't prose, its content is.
const DIRECTIVE = /^ {0,3}:{3,}/;
const RULE = /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,}|=+\s*)$/;
const QUOTE = /^ {0,3}(?:>\s?)+/;
const LIST = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/;

interface Line {
  start: Offset;
  /** Line content without its line break. */
  text: string;
}

function lines(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (const m of text.matchAll(/\r?\n/g)) {
    out.push({ start, text: text.slice(start, m.index) });
    start = m.index + m[0].length;
  }
  out.push({ start, text: text.slice(start) });
  return out;
}

/** Splits text into prose blocks, skipping code, front matter, tables, HTML and math in Markdown. */
export function splitBlocks(text: string, language: Language = 'markdown'): Block[] {
  if (language === 'plaintext') return splitPlain(text);

  const blocks: Block[] = [];
  let current: { start: Offset; parts: string[]; end: Offset } | undefined;
  const flush = () => {
    if (current && current.parts.join('').trim()) blocks.push({ start: current.start, end: current.end, view: current.parts.join('') });
    current = undefined;
  };
  /** Adds a line to the current block (or a new one), with `prefixLength` marker characters blanked. */
  const add = (line: Line, prefixLength: number, fresh: boolean) => {
    if (fresh) flush();
    const view = ' '.repeat(prefixLength) + line.text.slice(prefixLength);
    if (!current) {
      current = { start: line.start, parts: [view], end: line.start + line.text.length };
      return;
    }
    // The line break(s) between the previous line and this one become spaces.
    current.parts.push(' '.repeat(line.start - current.end), view);
    current.end = line.start + line.text.length;
  };

  const all = lines(text);
  let i = 0;
  // Front matter: a leading `---` … `---` (or `...`) block.
  if (all[0]?.text.trim() === '---') {
    const close = all.findIndex((l, j) => j > 0 && /^(?:---|\.\.\.)\s*$/.test(l.text));
    if (close > 0) i = close + 1;
  }

  for (; i < all.length; i++) {
    const line = all[i]!;
    const t = line.text;
    const fence = FENCE.exec(t);
    if (fence) {
      flush();
      const marker = fence[1]!;
      i++;
      while (i < all.length && !new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`).test(all[i]!.text)) i++;
      continue;
    }
    if (MATH.test(t)) {
      flush();
      if (!/\$\$\s*$/.test(t.trim().slice(2))) {
        i++;
        while (i < all.length && !/\$\$\s*$/.test(all[i]!.text)) i++;
      }
      continue;
    }
    if (!t.trim()) {
      flush();
      continue;
    }
    if (HTML.test(t) && !current) {
      // HTML block: skip until a blank line.
      while (i + 1 < all.length && all[i + 1]!.text.trim()) i++;
      continue;
    }
    if (TABLE.test(t) || RULE.test(t) || DIRECTIVE.test(t)) {
      flush();
      continue;
    }
    if (INDENTED_CODE.test(t) && !current) continue;

    const heading = HEADING.exec(t);
    if (heading) {
      add(line, heading[0].length, true);
      flush();
      continue;
    }
    const quote = QUOTE.exec(t);
    const afterQuote = quote ? t.slice(quote[0].length) : t;
    const list = LIST.exec(afterQuote);
    const prefix = (quote?.[0].length ?? 0) + (list?.[0].length ?? 0);
    add(line, prefix, list !== null);
  }
  flush();
  return blocks;
}

/** Plain text: paragraphs separated by blank lines. */
function splitPlain(text: string): Block[] {
  const blocks: Block[] = [];
  for (const m of text.matchAll(/[^\r\n]+(?:\r?\n[^\S\r\n]*[^\s][^\r\n]*)*/g)) {
    const raw = m[0];
    if (raw.trim()) blocks.push({ start: m.index, end: m.index + raw.length, view: raw.replace(/\r?\n/g, (s) => ' '.repeat(s.length)) });
  }
  return blocks;
}
