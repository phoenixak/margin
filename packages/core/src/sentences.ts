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
// A single capital and a period is an initial ("M. Dubois", "J. Smith"); "I." can end a sentence.
const INITIAL = /(?:^|[\s(])[A-HJ-Z]\.$/;
const endsInAbbreviation = (s: string) => ABBREVIATION.test(s) || INITIAL.test(s);
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

export const countWords = (s: string) => s.match(WORD)?.length ?? 0;

/**
 * Splits a block into sentences with `Intl.Segmenter`. Fragments under three words
 * (false splits after "e.g.", "Dr.") are merged into the previous sentence.
 */
export function splitSentences(block: Block, locale = 'en'): Sentence[] {
  const out: Sentence[] = [];
  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
  for (const seg of [...segmenter.segment(block.view)].flatMap(splitBeforeLowercase)) {
    const lead = seg.segment.length - seg.segment.trimStart().length;
    const trimmed = seg.segment.trim();
    if (!trimmed) continue;
    const start = block.start + seg.index + lead;
    const end = start + trimmed.length;
    const prev = out.at(-1);
    // A false split ("Dr. Smith", "e.g. this", a short fragment): keep it with the previous sentence.
    // A lowercase start is NOT a reason: "missing. is how was you" is two sentences (Harper flags the capital).
    // Quoted speech ending in "!" or "?" that continues in lowercase (“You promised!” he said) is one sentence.
    const continues = /[!?]["”’')\]]+$/.test(prev?.text ?? '') && /^\p{Ll}/u.test(trimmed);
    if (prev && (countWords(trimmed) < MIN_WORDS || endsInAbbreviation(prev.text) || continues)) {
      merge(prev, block, end);
      continue;
    }
    out.push({ start, end, text: block.view.slice(start - block.start, end - block.start) });
  }
  return out.filter((s) => /\p{L}/u.test(s.text));
}

/**
 * ICU doesn't break before a lowercase letter ("missing. is how was you"), but in
 * prose that's usually a new sentence with a capitalization slip (Harper flags it).
 * Split there, unless the period belongs to an abbreviation ("e.g. this"). Only after a period:
 * after "!" or "?" a lowercase word continues the sentence (“You promised!” he said).
 */
function splitBeforeLowercase(seg: { segment: string; index: number }): { segment: string; index: number }[] {
  const out: { segment: string; index: number }[] = [];
  let from = 0;
  for (const m of seg.segment.matchAll(/\.["”’')\]]*\s+(?=\p{Ll})/gu)) {
    const cut = m.index + m[0].length;
    if (endsInAbbreviation(seg.segment.slice(from, m.index + 1))) continue;
    out.push({ segment: seg.segment.slice(from, cut), index: seg.index + from });
    from = cut;
  }
  out.push({ segment: seg.segment.slice(from), index: seg.index + from });
  return out;
}

function merge(prev: Sentence, block: Block, end: Offset) {
  prev.end = end;
  prev.text = block.view.slice(prev.start - block.start, end - block.start);
}
