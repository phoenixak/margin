import { overlaps } from './guards.js';
import type { Range, Suggestion } from './types.js';

/** One text change, in offsets of the text before the change (VS Code's `rangeOffset` / `rangeLength`). */
export interface TextChange {
  offset: number;
  length: number;
  inserted: number;
}

/**
 * Moves suggestions with edits so their underlines stay on the right words until the
 * next check. A suggestion whose sentence the edit touched is dropped: it may no longer apply.
 * VS Code reports multiple changes against the original text, sorted last-to-first.
 */
export function shiftSuggestions(suggestions: Suggestion[], changes: TextChange[]): Suggestion[] {
  const sorted = [...changes].sort((a, b) => b.offset - a.offset);
  const out: Suggestion[] = [];
  outer: for (const s of suggestions) {
    let delta = 0;
    for (const c of sorted) {
      const end = c.offset + c.length;
      if (overlaps(s.sentence, { start: c.offset, end })) continue outer;
      if (c.offset >= s.sentence.end) continue; // after the sentence: no effect
      delta += c.inserted - c.length; // before the sentence
    }
    if (!delta) {
      out.push(s);
      continue;
    }
    out.push({ ...s, range: move(s.range, delta), sentence: { ...s.sentence, ...move(s.sentence, delta) } });
  }
  return out;
}

const move = (r: Range, d: number): Range => ({ start: r.start + d, end: r.end + d });

/** Drops suggestions whose edits overlap ranges Harper now flags (Harper re-lints after our check). */
export function withoutHarperOverlaps(suggestions: Suggestion[], harper: Range[]): Suggestion[] {
  return suggestions.filter((s) => !harper.some((h) => overlaps(s.range, h)));
}

/** The single change that turns `before` into `after` (common prefix and suffix), for editors that don't report changes. */
export function diffText(before: string, after: string): TextChange | undefined {
  if (before === after) return undefined;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start++;
  let end = 0;
  while (end < max - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { offset: start, length: before.length - start - end, inserted: after.length - start - end };
}
