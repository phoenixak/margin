import type { Suggestion } from '@margin/core';
import { describe, expect, it } from 'vitest';
import { layout, scoreItem, summarize } from '../src/score.js';

const sug = (start: number, end: number, replacement: string): Suggestion => ({
  range: { start, end },
  replacement,
  sentence: { start, end, original: '', fixed: '' },
  kind: 'grammar',
  why: '',
  model: 'm',
});

describe('scoring', () => {
  const items = [
    { id: 'e', text: 'They was late.', accept: ['They were late.'] },
    { id: 'c', text: 'The sky is blue.' },
  ];
  const { text, ranges } = layout(items);

  it('lays items out as paragraphs with exact ranges', () => {
    expect(text.slice(ranges[1]!.start, ranges[1]!.end)).toBe('The sky is blue.');
  });

  it('classifies correct, wrong, missed, untouched and false positives', () => {
    const was = text.indexOf('was');
    expect(scoreItem(items[0]!, ranges[0]!, text, [sug(was, was + 3, 'were')], [], false).outcome).toBe('correct');
    expect(scoreItem(items[0]!, ranges[0]!, text, [sug(was, was + 3, 'are')], [], false).outcome).toBe('wrong');
    expect(scoreItem(items[0]!, ranges[0]!, text, [], [], false).outcome).toBe('missed');
    expect(scoreItem(items[1]!, ranges[1]!, text, [], [], false).outcome).toBe('untouched');
    const blue = text.indexOf('blue');
    expect(scoreItem(items[1]!, ranges[1]!, text, [sug(blue, blue + 4, 'azure')], [], false).outcome).toBe('false-positive');
  });

  it('precision counts wrong fixes and false positives against Margin; debatable items are excluded', () => {
    const s = summarize([
      { id: '1', expectsFix: true, debatable: false, outcome: 'correct', output: '', rejected: [], harper: false },
      { id: '2', expectsFix: true, debatable: false, outcome: 'wrong', output: '', rejected: [], harper: true },
      { id: '3', expectsFix: false, debatable: false, outcome: 'false-positive', output: '', rejected: ['edit-ratio'], harper: false },
      { id: '4', expectsFix: false, debatable: false, outcome: 'untouched', output: '', rejected: [], harper: false },
      { id: '5', expectsFix: true, debatable: true, outcome: 'wrong', output: '', rejected: [], harper: false },
    ]);
    expect(s).toMatchObject({ errors: 2, clean: 2, correct: 1, wrong: 1, falsePositives: 1, harperFlagged: 1, combinedRecall: 1 });
    expect(s.precision).toBeCloseTo(1 / 3);
    expect(s.recall).toBeCloseTo(1 / 2);
    expect(s.falsePositiveRate).toBeCloseTo(1 / 2);
    expect(s.rejectedByReason).toEqual({ 'edit-ratio': 1 });
  });
});
