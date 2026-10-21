// Scoring for the human-text eval: real learner sentences with human corrections (JFLEG)
// and published prose (Project Gutenberg). Edits are compared over word tokens, against
// whichever human reference matches best (as M2-style scorers do).

/** JFLEG text is tokenized ("do n't", "school ."); this puts it back the way people write it. */
export function detokenize(s: string): string {
  let out = s.replace(/\s+/g, ' ').trim();
  out = out.replace(/ (n't|'s|'re|'ve|'ll|'d|'m)\b/gi, '$1');
  out = out.replace(/ ([.,!?;:%)\]])/g, '$1').replace(/([([]) /g, '$1');
  // Straight double quotes alternate open/close.
  let open = true;
  out = out.replace(/ ?" ?/g, (m) => {
    const r = open ? (m.startsWith(' ') ? ' "' : '"') : m.endsWith(' ') ? '" ' : '"';
    open = !open;
    return r;
  });
  return out.trim();
}

/** Words and punctuation as separate tokens. */
export const tokenize = (s: string): string[] => s.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*|[^\s\p{L}\p{N}]/gu) ?? [];

/** Token edits turning `a` into `b`, as "start-end:replacement" over `a`'s tokens. */
export function wordEdits(a: string[], b: string[]): string[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const edits: string[] = [];
  let i = 0;
  let j = 0;
  let start = -1;
  let repl: string[] = [];
  const flush = () => {
    if (start >= 0) edits.push(`${start}-${i}:${repl.join(' ')}`);
    start = -1;
    repl = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      if (start < 0) start = i;
      repl.push(b[j++]!);
    } else {
      if (start < 0) start = i;
      i++;
    }
  }
  flush();
  return edits;
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let k = 1; k <= b.length; k++) {
      const cur = row[k]!;
      row[k] = Math.min(row[k]! + 1, row[k - 1]! + 1, prev + (a[i - 1] === b[k - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/** A one-word replacement that only changes case or is a close respelling: Harper's territory. */
export function isSpellingEdit(edit: string, source: string[]): boolean {
  const [, s, e, repl] = /^(\d+)-(\d+):(.*)$/.exec(edit)!;
  if (Number(e) - Number(s) !== 1 || repl!.includes(' ') || !repl) return false;
  const from = source[Number(s)]!;
  if (!/^\p{L}+$/u.test(from) || !/^\p{L}+$/u.test(repl!)) return false;
  if (from.toLowerCase() === repl!.toLowerCase()) return true;
  const d = levenshtein(from.toLowerCase(), repl!.toLowerCase());
  return d <= 2 && d / Math.max(from.length, repl!.length) <= 0.34;
}

export interface SentenceScore {
  tp: number;
  fp: number;
  fn: number;
  /** Matched / missed reference edits that are spelling or case (Harper's job). */
  tpSpelling: number;
  fnSpelling: number;
  changed: boolean;
  /** At least one reference changes the sentence. */
  needsChange: boolean;
}

export function scoreSentence(source: string, output: string, references: string[]): SentenceScore {
  const src = tokenize(source);
  const hyp = new Set(wordEdits(src, tokenize(output)));
  let best: SentenceScore | undefined;
  for (const ref of references) {
    const gold = wordEdits(src, tokenize(ref));
    const tp = gold.filter((g) => hyp.has(g));
    const fn = gold.filter((g) => !hyp.has(g));
    const score: SentenceScore = {
      tp: tp.length,
      fp: hyp.size - tp.length,
      fn: fn.length,
      tpSpelling: tp.filter((g) => isSpellingEdit(g, src)).length,
      fnSpelling: fn.filter((g) => isSpellingEdit(g, src)).length,
      changed: hyp.size > 0,
      needsChange: false,
    };
    const f = (x: SentenceScore) => x.tp - 0.5 * (x.fp + x.fn);
    if (!best || f(score) > f(best) || (f(score) === f(best) && score.fn < best.fn)) best = score;
  }
  best!.needsChange = references.some((r) => wordEdits(src, tokenize(r)).length > 0);
  return best!;
}

export interface HumanSummary {
  sentences: number;
  precision: number;
  recall: number;
  f05: number;
  /** Recall on reference edits that aren't spelling or case. */
  recallNonSpelling: number;
  changed: number;
  /** Sentences every reference leaves alone that the system changed anyway. */
  cleanChanged: number;
  clean: number;
}

export function summarizeHuman(scores: SentenceScore[]): HumanSummary {
  const sum = (k: keyof SentenceScore) => scores.reduce((n, s) => n + Number(s[k]), 0);
  const tp = sum('tp');
  const fp = sum('fp');
  const fn = sum('fn');
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const tpNs = tp - sum('tpSpelling');
  const fnNs = fn - sum('fnSpelling');
  return {
    sentences: scores.length,
    precision,
    recall,
    f05: precision + recall ? (1.25 * precision * recall) / (0.25 * precision + recall) : 0,
    recallNonSpelling: tpNs + fnNs ? tpNs / (tpNs + fnNs) : 0,
    changed: scores.filter((s) => s.changed).length,
    cleanChanged: scores.filter((s) => !s.needsChange && s.changed).length,
    clean: scores.filter((s) => !s.needsChange).length,
  };
}

/** Prose paragraphs from a Project Gutenberg plain-text book: body only, lines unwrapped, headings dropped. */
export function gutenbergParagraphs(book: string, minLength = 200): string[] {
  const lines = book.replace(/\r\n/g, '\n');
  const start = lines.search(/^\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG.*$/m);
  const end = lines.search(/^\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG.*$/m);
  const body = lines.slice(start >= 0 ? lines.indexOf('\n', start) + 1 : 0, end >= 0 ? end : undefined);
  return body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').replace(/_/g, '').trim())
    .filter((p) => p.length >= minLength && /[.!?]["’”]?$/.test(p) && !/^[A-Z0-9 .,:;'-]+$/.test(p.slice(0, 40)));
}
