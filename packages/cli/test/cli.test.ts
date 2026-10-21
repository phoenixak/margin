import { describe, expect, it } from 'vitest';
import { formatSuggestion, lineCol } from '../src/format.js';
import { harperRanges } from '../src/harper.js';

describe('lineCol', () => {
  it('1-based line and column', () => {
    expect(lineCol('ab\ncd', 0)).toEqual({ line: 1, col: 1 });
    expect(lineCol('ab\ncd', 4)).toEqual({ line: 2, col: 2 });
  });
});

describe('formatSuggestion', () => {
  it('prints a replacement', () => {
    const text = 'They was late.';
    const line = formatSuggestion('a.md', text, {
      range: { start: 5, end: 8 },
      replacement: 'were',
      sentence: { start: 0, end: 14, original: text, fixed: 'They were late.' },
      kind: 'grammar',
      why: 'Agreement.',
      model: 'm',
    });
    expect(line).toBe('a.md:1:6  grammar  "was" → "were"  (Agreement.)');
  });
});

describe('harperRanges', () => {
  it('returns UTF-16 ranges from harper.js (runs locally, no network)', async () => {
    const text = '😀 This is a example.';
    const ranges = await harperRanges(text, 'American', 'markdown');
    expect(ranges.some((r) => text.slice(r.start, r.end) === 'a')).toBe(true);
  });
});
