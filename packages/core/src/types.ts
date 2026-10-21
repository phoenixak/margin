/** UTF-16 code units into the original text (a JS string index). harper.js spans use the same unit. */
export type Offset = number;

export interface Range {
  start: Offset;
  end: Offset;
}

/** Harper's `Dialect` enum names; also used in the prompt ("{dialect} English"). */
export type Dialect = 'American' | 'British' | 'Australian' | 'Canadian' | 'Indian';

export type FixKind = 'grammar' | 'word' | 'punctuation' | 'clarity';

/** One contiguous edit inside a sentence, in absolute offsets of the original text. */
export interface Hunk extends Range {
  replacement: string;
}

export interface Suggestion {
  /** The hunk this suggestion underlines and replaces. */
  range: Range;
  replacement: string;
  /**
   * The whole sentence: its original text (compare with the live document to detect
   * stale results) and the fix with all hunks applied, for "apply sentence".
   */
  sentence: Range & { original: string; fixed: string };
  kind: FixKind;
  /** Short reason from the model (≤ 12 words requested). */
  why: string;
  /** Model id that produced it. */
  model: string;
}

export type RejectReason =
  | 'placeholders'
  | 'edit-ratio'
  | 'negation'
  | 'numbers'
  | 'quotes'
  | 'markdown'
  | 'harper-style'
  | 'harper-overlap'
  | 'ignored';

export interface Rejection {
  sentence: Range;
  reason: RejectReason;
}
