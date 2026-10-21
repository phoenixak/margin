import type { Dialect, Range } from '@margin/core';
import { Dialect as HarperDialect, LocalLinter } from 'harper.js';
// `harper.js/binary` can't find its .wasm on Windows (it reads `new URL(...).pathname`); the inlined binary avoids the file read.
import { binaryInlined } from 'harper.js/binaryInlined';

/** Harper's lint ranges for dedup. harper.js spans are UTF-16 offsets, like Margin's (docs/HARPER-NOTES.md). */
export async function harperRanges(text: string, dialect: Dialect, language: 'markdown' | 'plaintext'): Promise<Range[]> {
  const linter = new LocalLinter({ binary: binaryInlined, dialect: HarperDialect[dialect] });
  try {
    const lints = await linter.lint(text, { language });
    return lints.map((l) => {
      const span = l.span();
      return { start: span.start, end: span.end };
    });
  } finally {
    await linter.dispose();
  }
}
