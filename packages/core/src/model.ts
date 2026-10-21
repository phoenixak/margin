import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

/** A model plus what Margin needs to know to call it well. */
export interface MarginModel {
  /** Stable id for cache keys and display, e.g. `gemini:gemma-4-26b-a4b-it`. */
  id: string;
  model: LanguageModel;
  /** The endpoint rejects system instructions: send the system prompt inside the user prompt. */
  foldSystem: boolean;
  /** Use structured output (format A) first; otherwise the tag protocol (format B). */
  structured: boolean;
  /** Turns reasoning off; Gemma 4 thinks by default and can spend the whole output budget on it. */
  providerOptions?: Record<string, Record<string, unknown>>;
  /** Whether this path has been tested end to end by the maintainers (shown in status UI). */
  tested: boolean;
  /** Calls to run at once: 1 for a local GPU (it serves one request well), 2 for hosted. */
  parallel: number;
  provider: 'gemini' | 'local';
  /** The model id without the provider prefix. */
  modelId: string;
}

export const DEFAULT_GEMINI_MODEL = 'gemma-4-26b-a4b-it';
export const DEFAULT_LOCAL_MODEL = 'gemma4:26b-a4b-it-qat';

export type ModelConfig =
  | { provider: 'gemini'; apiKey: string; model?: string; fetch?: typeof fetch }
  | { provider: 'local'; baseURL?: string; model?: string; fetch?: typeof fetch };

export function createModel(config: ModelConfig): MarginModel {
  if (config.provider === 'gemini') {
    const modelId = config.model ?? DEFAULT_GEMINI_MODEL;
    const google = createGoogleGenerativeAI({ apiKey: config.apiKey, ...(config.fetch ? { fetch: config.fetch } : {}) });
    return {
      id: `gemini:${modelId}`,
      model: google(modelId),
      // Gemma on the Gemini API rejects system instructions ("Developer instruction is not enabled").
      foldSystem: modelId.startsWith('gemma'),
      structured: true,
      // `thinkingBudget` is rejected for Gemma; `thinkingLevel: 'minimal'` gives 0 reasoning tokens (tested 2026-10-21).
      providerOptions: { google: { thinkingConfig: { thinkingLevel: 'minimal' } } },
      tested: modelId.startsWith('gemma-4'),
      parallel: 2,
      provider: 'gemini',
      modelId,
    };
  }
  const modelId = config.model ?? DEFAULT_LOCAL_MODEL;
  const local = createOpenAICompatible({
    name: 'local',
    baseURL: config.baseURL ?? 'http://localhost:11434/v1',
    supportsStructuredOutputs: true,
    ...(config.fetch ? { fetch: config.fetch } : {}),
  });
  return {
    id: `local:${modelId}`,
    model: local(modelId),
    foldSystem: false,
    structured: true,
    // Ollama's OpenAI-compatible API maps reasoning_effort "none" to thinking off (docs.ollama.com, checked 2026-10-21).
    // UNTESTED by Margin's maintainers, as is LM Studio's handling of it.
    providerOptions: { local: { reasoningEffort: 'none' } },
    tested: false,
    parallel: 1,
    provider: 'local',
    modelId,
  };
}
