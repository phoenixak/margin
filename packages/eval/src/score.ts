import { applyHunks, type Rejection, type Suggestion } from '@margin/core';

export interface Item {
  id: string;
  type?: string;
  text: string;
  /** Acceptable corrected versions. Absent or empty: the text is correct and must stay unchanged. */
  accept?: string[];
  /** Reasonable people disagree; reported but excluded from precision and recall. */
  debatable?: boolean;
}

export type Outcome = 'correct' | 'wrong' | 'missed' | 'untouched' | 'false-positive';

export interface ItemResult {
  id: string;
  type?: string;
  expectsFix: boolean;
  debatable: boolean;
  outcome: Outcome;
  output: string;
  rejected: string[];
  harper: boolean;
}

/** Lays items out as one Markdown paragraph each, remembering where each one is. */
export function layout(items: Item[]): { text: string; ranges: { start: number; end: number }[] } {
  let text = '';
  const ranges = items.map((item) => {
    const start = text.length;
    text += `${item.text}\n\n`;
    return { start, end: start + item.text.length };
  });
  return { text, ranges };
}

export const normalize = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/** Applies the suggestions that fall inside an item and classifies the result. */
export function scoreItem(
  item: Item,
  range: { start: number; end: number },
  doc: string,
  suggestions: Suggestion[],
  rejected: Rejection[],
  harper: boolean,
): ItemResult {
  const inside = suggestions.filter((s) => s.range.start >= range.start && s.range.end <= range.end);
  const output = applyHunks(doc.slice(range.start, range.end), inside.map((s) => ({ start: s.range.start - range.start, end: s.range.end - range.start, replacement: s.replacement })));
  const changed = normalize(output) !== normalize(item.text);
  const expectsFix = (item.accept?.length ?? 0) > 0;
  let outcome: Outcome;
  if (!expectsFix) outcome = changed ? 'false-positive' : 'untouched';
  else if (!changed) outcome = 'missed';
  else outcome = item.accept!.some((a) => normalize(a) === normalize(output)) ? 'correct' : 'wrong';
  return {
    id: item.id,
    ...(item.type ? { type: item.type } : {}),
    expectsFix,
    debatable: item.debatable === true,
    outcome,
    output,
    rejected: rejected.filter((r) => r.sentence.start >= range.start && r.sentence.end <= range.end).map((r) => r.reason),
    harper,
  };
}

export interface Summary {
  errors: number;
  clean: number;
  correct: number;
  wrong: number;
  missed: number;
  falsePositives: number;
  /** correct / every change Margin made (wrong fixes and false positives both count against it). */
  precision: number;
  /** correct / errors. */
  recall: number;
  f05: number;
  /** false positives / correct sentences. */
  falsePositiveRate: number;
  /** Errors Harper already flags (Margin defers to Harper on those in real use). */
  harperFlagged: number;
  /** Errors fixed by Margin or flagged by Harper. */
  combinedRecall: number;
  rejectedByReason: Record<string, number>;
}

export function summarize(results: ItemResult[]): Summary {
  const scored = results.filter((r) => !r.debatable);
  const errors = scored.filter((r) => r.expectsFix);
  const clean = scored.filter((r) => !r.expectsFix);
  const count = (o: Outcome) => scored.filter((r) => r.outcome === o).length;
  const correct = count('correct');
  const wrong = count('wrong');
  const falsePositives = count('false-positive');
  const changes = correct + wrong + falsePositives;
  const precision = changes ? correct / changes : 1;
  const recall = errors.length ? correct / errors.length : 0;
  const f05 = precision + recall ? (1.25 * precision * recall) / (0.25 * precision + recall) : 0;
  const rejectedByReason: Record<string, number> = {};
  for (const r of results) for (const reason of r.rejected) rejectedByReason[reason] = (rejectedByReason[reason] ?? 0) + 1;
  return {
    errors: errors.length,
    clean: clean.length,
    correct,
    wrong,
    missed: count('missed'),
    falsePositives,
    precision,
    recall,
    f05,
    falsePositiveRate: clean.length ? falsePositives / clean.length : 0,
    harperFlagged: errors.filter((r) => r.harper).length,
    combinedRecall: errors.length ? errors.filter((r) => r.outcome === 'correct' || r.harper).length / errors.length : 0,
    rejectedByReason,
  };
}
