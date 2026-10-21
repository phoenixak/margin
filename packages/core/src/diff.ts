import { diffWordsWithSpace } from 'diff';
import type { Hunk, Offset } from './types.js';

/**
 * Word-diffs a sentence against its corrected version and returns the changes as
 * hunks in absolute offsets (`base` is the sentence's offset in the document).
 * Changes separated only by whitespace are grouped; whitespace-only changes are
 * dropped (the model normalizing line breaks or double spaces isn't a fix).
 */
export function toHunks(original: string, fixed: string, base: Offset): Hunk[] {
  const hunks: Hunk[] = [];
  let pos = 0;
  let open: { start: number; end: number; replacement: string } | undefined;
  let gap = ''; // whitespace that was equal between two changes

  const close = () => {
    if (open) {
      let { start, end, replacement } = open;
      // Shrink whitespace both sides share, so a hunk never rewrites line breaks it didn't need to.
      while (start < end && replacement && /\s/.test(original[start]!) && original[start] === replacement[0]) {
        start++;
        replacement = replacement.slice(1);
      }
      while (start < end && replacement && /\s/.test(original[end - 1]!) && original[end - 1] === replacement.at(-1)) {
        end--;
        replacement = replacement.slice(0, -1);
      }
      if (original.slice(start, end).trim() || replacement.trim()) hunks.push({ start: base + start, end: base + end, replacement });
    }
    open = undefined;
    gap = '';
  };

  for (const part of diffWordsWithSpace(original, fixed)) {
    if (!part.added && !part.removed) {
      if (open && !part.value.trim()) {
        gap += part.value;
      } else {
        close();
      }
      pos += part.value.length;
      continue;
    }
    if (open && gap) {
      // Bridge a whitespace-only gap so "was  late" → "were late" stays one hunk.
      open.end = pos;
      open.replacement += gap;
      gap = '';
    }
    open ??= { start: pos, end: pos, replacement: '' };
    if (part.removed) {
      pos += part.value.length;
      open.end = pos;
    } else {
      open.replacement += part.value;
    }
  }
  close();
  return hunks;
}

/** Applies hunks (absolute offsets) to `text`. */
export function applyHunks(text: string, hunks: Hunk[]): string {
  let out = text;
  for (const h of [...hunks].sort((a, b) => b.start - a.start)) out = out.slice(0, h.start) + h.replacement + out.slice(h.end);
  return out;
}
