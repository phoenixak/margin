// Phase 0: which units does harper.js use for Lint spans? Findings in docs/HARPER-NOTES.md.
import { Dialect, LocalLinter } from 'harper.js';
// harper.js/binary resolves its .wasm path as 'D:\D:\…' on Windows (see HARPER-NOTES); the inlined binary avoids the file read.
import { binaryInlined as binary } from 'harper.js/binaryInlined';
import { afterAll, describe, expect, it } from 'vitest';

const linter = new LocalLinter({ binary, dialect: Dialect.American });
afterAll(() => linter.dispose());

/** Index of `needle` in Unicode scalar values (Rust `char`s), not UTF-16 code units. */
const scalarIndex = (text: string, needle: string) => [...text.slice(0, text.indexOf(needle))].length;

async function spanOf(text: string, problem: string) {
  const lints = await linter.lint(text, { language: 'plaintext' });
  const lint = lints.find((l) => l.get_problem_text() === problem);
  if (!lint) throw new Error(`no lint on "${problem}": ${lints.map((l) => l.get_problem_text()).join(', ')}`);
  const { start, end } = lint.span();
  return { start, end };
}

describe('harper.js span units', () => {
  it('ASCII: spans equal JS string indices', async () => {
    const text = 'This is a example.';
    expect(await spanOf(text, 'a')).toEqual({ start: text.indexOf(' a ') + 1, end: text.indexOf(' a ') + 2 });
  });

  it('astral emoji before the lint: harper.js returns UTF-16 code units (its docs say scalar values)', async () => {
    const text = '😀😀 This is a example.';
    const span = await spanOf(text, 'a');
    expect(span.start).toBe(text.indexOf(' a ') + 1);
    expect(span.start).not.toBe(scalarIndex(text, ' a ') + 1); // each emoji is 2 UTF-16 units but 1 scalar
    expect(text.slice(span.start, span.end)).toBe('a');
  });

  it('CJK (BMP) before the lint: one unit per character in both schemes', async () => {
    const text = '日本語。 This is a example.';
    expect((await spanOf(text, 'a')).start).toBe(text.indexOf(' a ') + 1);
  });

  it('combining marks: one unit each, same as JS string indices', async () => {
    const text = 'Café is open. This is a example.';
    expect((await spanOf(text, 'a')).start).toBe(text.indexOf(' a ') + 1);
  });
});
