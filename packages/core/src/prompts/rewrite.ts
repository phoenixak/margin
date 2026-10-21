import type { Dialect } from '../types.js';

export type RewritePreset = 'improve' | 'concise' | 'formal' | 'friendly' | 'fix-only' | 'custom';

export const REWRITE_PRESETS: Record<Exclude<RewritePreset, 'custom'>, { label: string; instruction: string }> = {
  improve: { label: 'Improve', instruction: 'Improve clarity and flow. Fix errors. Keep the length about the same.' },
  concise: { label: 'Concise', instruction: 'Make it shorter and more direct. Remove filler and repetition.' },
  formal: { label: 'Formal', instruction: 'Rewrite in a formal, professional tone.' },
  friendly: { label: 'Friendly', instruction: 'Rewrite in a warm, friendly, conversational tone.' },
  'fix-only': { label: 'Fix only', instruction: 'Fix grammar, wrong words and punctuation only. Change nothing else.' },
};

/** Placeholders are only mentioned when the text has some: otherwise models invent them. */
export function rewriteSystemPrompt(dialect: Dialect, hasPlaceholders = false): string {
  return `You rewrite text in ${dialect} English as instructed.
Rules:
- Keep the same language, dialect and meaning. Don't add facts, names or numbers, and don't change negation.
- Keep Markdown formatting (lists, emphasis, links) as it is.
${hasPlaceholders ? '- Keep placeholders like ⟦0⟧ exactly once each, in the same order.\n' : ''}- Output only the rewritten text, with no preamble, quotes or explanation.`;
}

export function rewriteUserPrompt(text: string, instruction: string): string {
  return `Instruction: ${instruction}\n\nText:\n${text}`;
}
