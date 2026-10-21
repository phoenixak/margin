/**
 * Protected spans (code, URLs, link targets, math, HTML, wiki links, footnotes) are
 * replaced with `⟦n⟧` before a sentence goes to the model, and restored afterwards.
 * Link text stays editable: only `[` and `](url)` are masked.
 */

export interface Masked {
  text: string;
  /** Original text of each placeholder, by index. */
  originals: string[];
}

const PROTECTED = new RegExp(
  [
    /(`+)[^`]*?\1/.source, // inline code
    /\[\[[^\]]*\]\]/.source, // wiki link
    /\[\^[^\]]+\]/.source, // footnote reference
    /!?\[(?=[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\))/.source, // link/image opening bracket (text follows)
    /\]\([^)\s]+(?:\s+"[^"]*")?\)/.source, // link/image target
    /(?<![\\$\w])\$(?!\s)[^$\n]+?(?<!\s)\$(?![\w$])/.source, // inline math
    /<https?:\/\/[^>\s]+>/.source, // autolink
    /<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/.source, // HTML tag
    /\bhttps?:\/\/[^\s<>()]*[^\s<>().,;:!?'"]/.source, // bare URL (no trailing punctuation)
    /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/.source, // email
  ].join('|'),
  'g',
);

const PLACEHOLDER = /⟦(\d+)⟧/g;

export function mask(text: string): Masked {
  const originals: string[] = [];
  const masked = text.replace(PROTECTED, (m) => {
    originals.push(m);
    return `⟦${originals.length - 1}⟧`;
  });
  return { text: masked, originals };
}

/**
 * Restores placeholders. Every placeholder must appear exactly once and in its
 * original order; otherwise the model damaged protected content and `undefined` is returned.
 */
export function unmask(text: string, originals: string[]): string | undefined {
  const seen = [...text.matchAll(PLACEHOLDER)].map((m) => Number(m[1]));
  if (seen.length !== originals.length || seen.some((n, i) => n !== i)) return undefined;
  return text.replace(PLACEHOLDER, (_, n: string) => originals[Number(n)]!);
}
