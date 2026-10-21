export interface BatchOptions {
  /** Research (arXiv 2609.10810): ~5 per call is best for small models, ~15 for large ones. Default 8. */
  maxSentences?: number;
  /** Rough input cap per call, in characters. Default 2400 (~600 tokens). */
  maxChars?: number;
}

/** Groups items into batches by count and total text length. */
export function batches<T extends { text: string }>(items: T[], options: BatchOptions = {}): T[][] {
  const maxSentences = options.maxSentences ?? 8;
  const maxChars = options.maxChars ?? 2400;
  const out: T[][] = [];
  let current: T[] = [];
  let chars = 0;
  for (const item of items) {
    if (current.length && (current.length >= maxSentences || chars + item.text.length > maxChars)) {
      out.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += item.text.length;
  }
  if (current.length) out.push(current);
  return out;
}
