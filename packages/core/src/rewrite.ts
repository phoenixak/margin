import { streamText } from 'ai';
import { mask, unmask } from './mask.js';
import type { MarginModel } from './model.js';
import { REWRITE_PRESETS, type RewritePreset, rewriteSystemPrompt, rewriteUserPrompt } from './prompts/rewrite.js';
import type { Dialect } from './types.js';

export interface RewriteInput {
  text: string;
  model: MarginModel;
  preset: RewritePreset;
  /** Required for `custom`; appended to the preset's instruction otherwise. */
  instruction?: string;
  dialect?: Dialect;
  signal?: AbortSignal;
}

export type RewriteWarning = 'placeholders' | 'negation' | 'numbers';

export interface RewriteResult {
  /** Rewritten text as it streams, with placeholders already restored. */
  textStream: AsyncIterable<string>;
  /** The full text and anything the user should double-check before accepting. */
  done: Promise<{ text: string; warnings: RewriteWarning[] }>;
}

const NEGATION = /\b(?:not|no|never|none|nobody|nothing|nowhere|neither|nor|cannot)\b|n['’]t\b/gi;
const NUMBER = /\d+(?:[.,:/]\d+)*/g;

/**
 * Rewrites text with a preset (or a custom instruction), streaming. The user reviews
 * the result as a diff, so problems become warnings instead of rejections.
 */
export function rewrite(input: RewriteInput): RewriteResult {
  const { text: masked, originals } = mask(input.text);
  const instruction =
    input.preset === 'custom'
      ? (input.instruction ?? '').trim()
      : [REWRITE_PRESETS[input.preset].instruction, input.instruction?.trim()].filter(Boolean).join(' ');
  if (!instruction) throw new Error('rewrite: a custom preset needs an instruction');

  const system = rewriteSystemPrompt(input.dialect ?? 'American', originals.length > 0);
  const user = rewriteUserPrompt(masked, instruction);
  const m = input.model;
  const result = streamText({
    model: m.model,
    temperature: input.preset === 'fix-only' ? 0 : 0.4,
    maxRetries: 2,
    maxOutputTokens: Math.max(256, Math.ceil((masked.length / 4) * 2) + 200),
    ...(input.signal ? { abortSignal: input.signal } : {}),
    ...(m.providerOptions ? { providerOptions: m.providerOptions as never } : {}),
    ...(m.foldSystem ? { prompt: `${system}\n\n${user}` } : { system, prompt: user }),
  });

  let resolveDone!: (v: { text: string; warnings: RewriteWarning[] }) => void;
  let rejectDone!: (e: unknown) => void;
  const done = new Promise<{ text: string; warnings: RewriteWarning[] }>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });
  done.catch(() => {}); // the caller may only consume the stream

  async function* stream(): AsyncIterable<string> {
    let raw = '';
    let emitted = 0; // characters of `raw` already restored and yielded
    try {
      for await (const delta of result.textStream) {
        raw += delta;
        // Hold back a possibly incomplete placeholder at the end.
        const safe = raw.lastIndexOf('⟦') > raw.lastIndexOf('⟧') ? raw.lastIndexOf('⟦') : raw.length;
        if (safe > emitted) {
          yield restore(raw.slice(emitted, safe), originals);
          emitted = safe;
        }
      }
      if (raw.length > emitted) yield restore(raw.slice(emitted), originals);
      const trimmed = dropInvented(raw, originals).trim();
      const full = unmask(trimmed, originals);
      const restored = full ?? restore(trimmed, originals);
      const warnings: RewriteWarning[] = [];
      if (full === undefined) warnings.push('placeholders');
      if ((input.text.match(NEGATION)?.length ?? 0) !== (restored.match(NEGATION)?.length ?? 0)) warnings.push('negation');
      if ([...(input.text.match(NUMBER) ?? [])].sort().join() !== [...(restored.match(NUMBER) ?? [])].sort().join()) warnings.push('numbers');
      resolveDone({ text: restored, warnings });
    } catch (error) {
      rejectDone(error);
      throw error;
    }
  }

  return { textStream: stream(), done };
}

/** Best-effort restore for streaming: known placeholders are replaced, invented ones dropped. */
function restore(s: string, originals: string[]): string {
  return dropInvented(s, originals).replace(/⟦(\d+)⟧/g, (m, n: string) => originals[Number(n)] ?? m);
}

/** Removes placeholders the model made up (an index we never sent), with the space before them. */
function dropInvented(s: string, originals: string[]): string {
  return s.replace(/\s?⟦(\d+)⟧/g, (m, n: string) => (Number(n) < originals.length ? m : ''));
}
