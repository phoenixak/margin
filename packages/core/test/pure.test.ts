import { describe, expect, it } from 'vitest';
import {
  applyHunks,
  batches,
  checkSystemPrompt,
  guardFix,
  saysNoError,
  mask,
  overlaps,
  parseJsonLenient,
  parseTags,
  PROMPT_VERSION,
  splitBlocks,
  splitSentences,
  toHunks,
  unmask,
} from '../src/index.js';

const views = (text: string, lang?: 'markdown' | 'plaintext') => splitBlocks(text, lang).map((b) => b.view.trim().replace(/\s+/g, ' '));

describe('splitBlocks', () => {
  it('drops admonition fences (:::) but keeps the prose inside', () => {
    // Found on Vite's docs: ":::" was part of the last sentence and the model's fix deleted it.
    const md = '::: tip Compatibility Note\nSome templates need a newer Node.js, please upgrade.\n:::\n';
    const blocks = splitBlocks(md);
    expect(blocks.map((b) => md.slice(b.start, b.end))).toEqual(['Some templates need a newer Node.js, please upgrade.']);
  });

  it('keeps prose and skips code, front matter, tables, HTML and math', () => {
    const md = [
      '---',
      'title: x',
      '---',
      '# A heading here',
      '',
      'First paragraph,',
      'wrapped.',
      '',
      '```js',
      'const a = 1;',
      '```',
      '',
      '| a | b |',
      '|---|---|',
      '',
      '<div>',
      'html stuff',
      '</div>',
      '',
      '$$',
      'x^2',
      '$$',
      '',
      '    indented code',
      '',
      '- item one is here',
      '- [ ] task two is here',
      '',
      '> quoted text',
      '> continues',
    ].join('\n');
    expect(views(md)).toEqual([
      'A heading here',
      'First paragraph, wrapped.',
      'item one is here',
      'task two is here',
      'quoted text continues',
    ]);
  });

  it('view has the same length as the source slice, so offsets carry over', () => {
    const md = '- a list item\r\n  continued\n\n> quote\n> more';
    for (const b of splitBlocks(md)) expect(b.view.length).toBe(b.end - b.start);
  });

  it('plaintext: paragraphs separated by blank lines', () => {
    expect(views('One line.\nSame para.\n\nNew para.', 'plaintext')).toEqual(['One line. Same para.', 'New para.']);
  });
});

describe('splitSentences', () => {
  it('splits and keeps absolute offsets', () => {
    const text = 'Intro.\n\nThey was late. The sky is blue today.';
    const block = splitBlocks(text)[1]!;
    const s = splitSentences(block);
    expect(s.map((x) => text.slice(x.start, x.end))).toEqual(['They was late.', 'The sky is blue today.']);
  });

  it('does not merge a sentence just because it starts lowercase', () => {
    const [block] = splitBlocks('Let me know if anything is missing. is howdy how was you');
    expect(splitSentences(block!).length).toBe(2);
  });

  it('merges short fragments into the previous sentence', () => {
    const [block] = splitBlocks('We met Dr. Smith yesterday at noon. It went well overall.');
    expect(splitSentences(block!).length).toBe(2);
  });

  it('keeps quoted speech with its lowercase continuation', () => {
    // Found on The Great Gatsby: the split made "into his ear." a fragment the model "fixed".
    const [block] = splitBlocks('She hissed: “You promised!” into his ear. He did not answer her.');
    expect(splitSentences(block!).map((s) => s.text)).toEqual(['She hissed: “You promised!” into his ear.', 'He did not answer her.']);
    const [b2] = splitBlocks('“Where are you going?” she asked quietly. Nobody knew the answer.');
    expect(splitSentences(b2!).length).toBe(2);
  });

  it('never splits inside a link target, URL or inline code', () => {
    // Found on Docusaurus's docs: a split at the "?" of "/showcase?…" left half a link, and the "fix" deleted an emoji.
    const [block] = splitBlocks('💅 Check the **[best Docusaurus sites](/showcase?tags=favorite)** for ideas today. See https://example.com/a.b?c=1 for more about it. Run `a.b()` now please.');
    expect(splitSentences(block!).map((s) => s.text)).toEqual([
      '💅 Check the **[best Docusaurus sites](/showcase?tags=favorite)** for ideas today.',
      'See https://example.com/a.b?c=1 for more about it.',
      'Run `a.b()` now please.',
    ]);
  });

  it('does not split after an initial', () => {
    // Found on The Economic Consequences of the Peace: "M. Loucheur were made…" became its own sentence.
    const [block] = splitBlocks('The statements of M. Dubois and M. Loucheur were made in the early spring. They mattered a great deal.');
    expect(splitSentences(block!).length).toBe(2);
  });
});

describe('mask / unmask', () => {
  it('masks code, URLs, emails, link targets, wiki links, math and HTML; keeps link text', () => {
    const s = 'Run `npm i` then see [the docs](https://x.dev/a) or [[Page]] at https://a.b/c, mail a@b.co, $x+1$ and <br/>.';
    const m = mask(s);
    expect(m.text).toBe('Run ⟦0⟧ then see ⟦1⟧the docs⟦2⟧ or ⟦3⟧ at ⟦4⟧, mail ⟦5⟧, ⟦6⟧ and ⟦7⟧.');
    expect(unmask(m.text, m.originals)).toBe(s);
  });

  it('rejects lost, duplicated or reordered placeholders', () => {
    const { originals } = mask('Use `a` and `b` here.');
    expect(unmask('Use ⟦0⟧ and here.', originals)).toBeUndefined();
    expect(unmask('Use ⟦0⟧ and ⟦0⟧ and ⟦1⟧.', originals)).toBeUndefined();
    expect(unmask('Use ⟦1⟧ and ⟦0⟧ here.', originals)).toBeUndefined();
    expect(unmask('Uses ⟦0⟧ and ⟦1⟧ here.', originals)).toBe('Uses `a` and `b` here.');
  });
});

describe('toHunks', () => {
  it('maps word changes to absolute offsets', () => {
    const s = 'They was late to the the meeting.';
    const hunks = toHunks(s, 'They were late to the meeting.', 100);
    expect(hunks.map((h) => [h.start - 100, h.end - 100, h.replacement])).toEqual([
      [5, 8, 'were'],
      [21, 25, ''],
    ]);
    expect(applyHunks(s, hunks.map((h) => ({ ...h, start: h.start - 100, end: h.end - 100 })))).toBe('They were late to the meeting.');
  });

  it('drops whitespace-only changes and never swallows shared whitespace', () => {
    expect(toHunks('a  b', 'a b', 0)).toEqual([]);
    const h = toHunks('He go home now.', 'He goes home now.', 0);
    expect(h).toEqual([{ start: 3, end: 5, replacement: 'goes' }]);
  });

  it('handles insertions (comma splice fixed with "so")', () => {
    const s = 'It rained, we stayed in.';
    const h = toHunks(s, 'It rained, so we stayed in.', 0);
    expect(applyHunks(s, h)).toBe('It rained, so we stayed in.');
  });
});

describe('guardFix', () => {
  const g = (a: string, b: string) => guardFix(a, b, toHunks(a, b, 0));
  it('accepts a minimal fix', () => expect(g('They was late.', 'They were late.')).toBeUndefined());
  it('rejects negation flips', () => expect(g('She did go.', 'She did not go.')).toBe('negation'));
  it('allows "don\'t" → "doesn\'t"', () => expect(g("He don't care.", "He doesn't care.")).toBeUndefined());
  it('rejects changed numbers', () => expect(g('It takes 40 seconds.', 'It takes 45 seconds.')).toBe('numbers'));
  it('rejects changes inside quotes', () => expect(g('He said "we was there" loudly.', 'He said "we were there" loudly.')).toBe('quotes'));
  it('rejects serial-comma-only edits (Harper owns style)', () => expect(g('Red, blue and green.', 'Red, blue, and green.')).toBe('harper-style'));
  it('rejects rewrites above the edit ratio', () =>
    expect(g('The meeting could have been an email.', 'That gathering might simply have been a message.')).toBe('edit-ratio'));
  it('rejects broken Markdown emphasis', () => expect(g('This is **very** bad.', 'This is very bad.')).toBe('markdown'));
  it('rejects leaked markup characters', () => expect(g("Don't loose the backup drive.", "Don't lose the[]backup drive.")).toBe('markdown'));
});

describe('overlaps', () => {
  it('ranges and insertions', () => {
    expect(overlaps({ start: 0, end: 5 }, { start: 4, end: 8 })).toBe(true);
    expect(overlaps({ start: 0, end: 5 }, { start: 5, end: 8 })).toBe(false);
    expect(overlaps({ start: 5, end: 5 }, { start: 3, end: 5 })).toBe(true);
  });
});

describe('parsers', () => {
  it('tags', () => {
    expect(parseTags('<fix id="2" kind="word">They\'re here.</fix><why>Contraction.</why>')).toEqual([
      { id: 2, kind: 'word', text: "They're here.", why: 'Contraction.' },
    ]);
    expect(parseTags('<none/>')).toEqual([]);
    expect(parseTags('')).toBeUndefined();
    expect(parseTags('I think everything is fine.')).toBeUndefined();
  });
  it('lenient JSON strips code fences', () => {
    expect(parseJsonLenient('```json\n{"fixes":[{"id":1,"text":"A b.","kind":"grammar","why":"x"}]}\n```')).toHaveLength(1);
    expect(parseJsonLenient('nope')).toBeUndefined();
  });
});

describe('batches', () => {
  it('splits by count and size', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ text: 'x'.repeat(i === 3 ? 3000 : 10) }));
    expect(batches(items, { maxSentences: 4 }).map((b) => b.length)).toEqual([3, 1, 4, 2]);
  });
});

describe('prompts', () => {
  it('are byte-stable for a PROMPT_VERSION (bump the version when this snapshot changes)', () => {
    expect(PROMPT_VERSION).toBe(3);
    expect(checkSystemPrompt('American', 'json')).toMatchSnapshot();
    expect(checkSystemPrompt('British', 'tags')).toMatchSnapshot();
  });
});

describe('saysNoError', () => {
  it('spots a reason that says the sentence was fine', () => {
    expect(saysNoError('No changes needed.')).toBe(true);
    expect(saysNoError('No changes needed. Sentence is correct.')).toBe(true);
    expect(saysNoError('The sentence is already grammatically correct.')).toBe(true);
    expect(saysNoError('Subject-verb agreement.')).toBe(false);
    expect(saysNoError('Added a missing article; no other errors.')).toBe(false);
    expect(saysNoError(undefined)).toBe(false);
  });
});
