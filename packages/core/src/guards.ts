import { countWords } from './sentences.js';
import type { Hunk, Range, RejectReason } from './types.js';

export interface GuardOptions {
  /** Changed words / sentence words above this (with more than one word changed) rejects the fix. Default 0.35. */
  maxEditRatio?: number;
}

const NEGATION = /\b(?:not|no|never|none|nobody|nothing|nowhere|neither|nor|cannot)\b|n['’]t\b/gi;
const NUMBER = /\d+(?:[.,:/]\d+)*/g;
const QUOTED = /"[^"\n]*"|“[^”\n]*”/g;
// Markup characters a grammar fix never needs to add or remove (models sometimes leak stray `[]` or `*`).
const MARKDOWN = /[*_~`[\]<>|#]/g;

const all = (re: RegExp, s: string) => s.match(re) ?? [];
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameMultiset = (a: string[], b: string[]) => sameList([...a].sort(), [...b].sort());

/**
 * Over-edit guard for check mode (PLAN §3.3). `hunks` are relative to `original`
 * (offset 0 = start of the sentence). Returns why the fix is rejected, or undefined.
 */
export function guardFix(original: string, fixed: string, hunks: Hunk[], options: GuardOptions = {}): RejectReason | undefined {
  const maxRatio = options.maxEditRatio ?? 0.35;

  if (all(NEGATION, original).length !== all(NEGATION, fixed).length) return 'negation';
  if (!sameMultiset(all(NUMBER, original), all(NUMBER, fixed))) return 'numbers';
  if (!sameList(all(QUOTED, original), all(QUOTED, fixed))) return 'quotes';
  if (all(MARKDOWN, original).length !== all(MARKDOWN, fixed).length) return 'markdown';
  if (hunks.length && hunks.every((h) => isSerialComma(original, h))) return 'harper-style';

  const changed = hunks.reduce((n, h) => n + Math.max(countWords(original.slice(h.start, h.end)), countWords(h.replacement)), 0);
  const total = Math.max(1, countWords(original));
  if (changed > 1 && changed / total > maxRatio) return 'edit-ratio';
  return undefined;
}

/**
 * The model's own reason says nothing was wrong ("No changes needed.") although it changed the
 * sentence. Seen on published prose: the change is then a polish, not a fix.
 */
export const saysNoError = (why: string | undefined) =>
  /\bno (?:changes?|corrections?|errors?|fix(?:es)?) (?:are |is )?(?:needed|required|necessary|found)\b|\b(?:sentence|it|this) is (?:already )?(?:grammatically )?correct\b/i.test(why ?? '');

/** A hunk that only adds or removes the comma before "and"/"or" (the serial comma is a style choice Harper owns). */
function isSerialComma(original: string, h: Hunk): boolean {
  const removed = original.slice(h.start, h.end).trim();
  const added = h.replacement.trim();
  const commaOnly = (removed === '' && added === ',') || (removed === ',' && added === '');
  return commaOnly && /^,?\s+(?:and|or)\b/i.test(original.slice(h.end));
}

/** True when two ranges overlap. A zero-length range (an insertion) overlaps a range it touches. */
export function overlaps(a: Range, b: Range): boolean {
  if (a.start === a.end) return b.start <= a.start && a.start <= b.end;
  if (b.start === b.end) return a.start <= b.start && b.start <= a.end;
  return a.start < b.end && b.start < a.end;
}
