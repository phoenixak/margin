import type { Block } from './blocks.js';
import type { Offset } from './types.js';

export interface Sentence {
  start: Offset;
  end: Offset;
  /** The sentence as seen by the model: `view` characters, same length as the original slice. */
  text: string;
}

const MIN_WORDS = 3;
const ABBREVIATION = /\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|cf|approx|No|Fig|Eq)\.$/i;
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

export const countWords = (s: string) => s.match(WORD)?.length ?? 0;

/**
 * Splits a block into sentences with `Intl.Segmenter`. Fragments under three words
 * (false splits after "e.g.", "Dr.") are merged into the previous sentence.
 */
export function splitSentences(block: Block, locale = 'en'): Sentence[] {
  const out: Sentence[] = [];
  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
  for (const seg of segmenter.segment(block.view)) {
    const lead = seg.segment.length - seg.segment.trimStart().length;
    const trimmed = seg.segment.trim();
    if (!trimmed) continue;
    const start = block.start + seg.index + lead;
    const end = start + trimmed.length;
    const prev = out.at(-1);
    if (prev && (countWords(trimmed) < MIN_WORDS || ABBREVIATION.test(prev.text) || /^\p{Ll}/u.test(trimmed))) {
      // A false split ("Dr. Smith", "e.g. this", a short fragment): keep it with the previous sentence.
      merge(prev, block, end);
      continue;
    }
    out.push({ start, end, text: block.view.slice(start - block.start, end - block.start) });
  }
  return out.filter((s) => /\p{L}/u.test(s.text));
}

function merge(prev: Sentence, block: Block, end: Offset) {
  prev.end = end;
  prev.text = block.view.slice(prev.start - block.start, end - block.start);
}
