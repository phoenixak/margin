import { describe, expect, it } from 'vitest';
import { detokenize, gutenbergParagraphs, isSpellingEdit, scoreSentence, summarizeHuman, tokenize, wordEdits } from '../src/human-score.ts';

describe('detokenize', () => {
  it('joins JFLEG tokens back into ordinary text', () => {
    expect(detokenize("I do n't think it 's true , but we ca n't say ( yet ) .")).toBe("I don't think it's true, but we can't say (yet).");
    expect(detokenize('He said " hello " to me .')).toBe('He said "hello" to me.');
  });
});

describe('wordEdits', () => {
  it('finds replacements, insertions and deletions over tokens', () => {
    expect(wordEdits(tokenize('He go to school.'), tokenize('He goes to school.'))).toEqual(['1-2:goes']);
    expect(wordEdits(tokenize('I like the cats.'), tokenize('I like cats.'))).toEqual(['2-3:']);
    expect(wordEdits(tokenize('She went store.'), tokenize('She went to the store.'))).toEqual(['2-2:to the']);
    expect(wordEdits(tokenize('Same text.'), tokenize('Same text.'))).toEqual([]);
  });
});

describe('isSpellingEdit', () => {
  it('treats a one-word fix with a close spelling or only a case change as spelling', () => {
    const src = tokenize('I recieve a lot of mail in london.');
    expect(isSpellingEdit('1-2:receive', src)).toBe(true);
    expect(isSpellingEdit('7-8:London', src)).toBe(true);
    expect(isSpellingEdit('1-2:got', src)).toBe(false);
    expect(isSpellingEdit('2-2:the', src)).toBe(false);
  });
});

describe('scoreSentence', () => {
  it('scores against the reference that matches best', () => {
    const s = scoreSentence('He go to school yesterday.', 'He went to school yesterday.', ['He goes to school yesterday.', 'He went to school yesterday.']);
    expect(s).toMatchObject({ tp: 1, fp: 0, fn: 0, changed: true, needsChange: true });
  });

  it('counts an unneeded change on a sentence every reference leaves alone', () => {
    const s = scoreSentence('This is fine.', 'This is good.', ['This is fine.']);
    expect(s).toMatchObject({ tp: 0, fp: 1, fn: 0, changed: true, needsChange: false });
  });

  it('separates spelling edits (Harper’s job) from the rest', () => {
    const s = scoreSentence('He recieve a letter yesterday.', 'He recieve a letter yesterday.', ['He received a letter yesterday.']);
    expect(s).toMatchObject({ tp: 0, fn: 1, fnSpelling: 0 });
    const t = scoreSentence('I recieve letters.', 'I recieve letters.', ['I receive letters.']);
    expect(t).toMatchObject({ fn: 1, fnSpelling: 1 });
  });
});

describe('summarizeHuman', () => {
  it('computes precision, recall and F0.5', () => {
    const sum = summarizeHuman([
      { tp: 2, fp: 1, fn: 1, tpSpelling: 0, fnSpelling: 0, changed: true, needsChange: true },
      { tp: 0, fp: 1, fn: 0, tpSpelling: 0, fnSpelling: 0, changed: true, needsChange: false },
    ]);
    expect(sum.precision).toBeCloseTo(0.5);
    expect(sum.recall).toBeCloseTo(2 / 3);
    expect(sum.cleanChanged).toBe(1);
  });
});

describe('gutenbergParagraphs', () => {
  it('keeps the book body, unwraps lines and drops headings', () => {
    const book = [
      'Title: Test',
      '*** START OF THE PROJECT GUTENBERG EBOOK TEST ***',
      'CHAPTER I',
      '',
      'It was a bright cold day in April, and the clocks were',
      'striking thirteen. Winston walked home slowly in the rain.',
      '',
      '*** END OF THE PROJECT GUTENBERG EBOOK TEST ***',
      'License text.',
    ].join('\r\n');
    expect(gutenbergParagraphs(book, 20)).toEqual([
      'It was a bright cold day in April, and the clocks were striking thirteen. Winston walked home slowly in the rain.',
    ]);
  });
});
