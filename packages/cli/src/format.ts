import type { Suggestion } from '@margin/core';

/** 1-based line and column (in UTF-16 units, like most editors) of an offset. */
export function lineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { line, col: offset - lineStart + 1 };
}

export function formatSuggestion(file: string, text: string, s: Suggestion): string {
  const { line, col } = lineCol(text, s.range.start);
  const before = text.slice(s.range.start, s.range.end);
  const change = before ? (s.replacement ? `"${before}" → "${s.replacement}"` : `remove "${before}"`) : `insert "${s.replacement}"`;
  return `${file}:${line}:${col}  ${s.kind}  ${change}${s.why ? `  (${s.why})` : ''}`;
}
