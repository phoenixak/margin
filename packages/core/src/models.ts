/**
 * What Margin knows about each model. `autoCheck` (automatic check mode while typing)
 * is only true for models that passed the eval: precision first, few false positives.
 * Models without eval results get on-demand checking and rewrite only.
 */
export interface ModelInfo {
  provider: 'gemini' | 'local';
  id: string;
  autoCheck: boolean;
  /** Recommended VRAM for local models (GB). */
  vramGb?: number;
  /** The evaluated model with the same weights (a local quantization of a hosted model). */
  sameWeightsAs?: string;
  dataUse: string;
  eval?: { date: string; commit: string; precision: number; recall: number; falsePositiveRate: number; items: number; report: string };
}

export const MODELS: ModelInfo[] = [
  {
    provider: 'gemini',
    id: 'gemma-4-26b-a4b-it',
    autoCheck: true,
    dataUse: 'Gemini API free tier: Google may use content to improve its products (ai.google.dev/gemini-api/terms, checked 2026-10-21).',
    eval: {
      date: '2026-10-21',
      commit: '07fc072',
      precision: 1,
      recall: 0.823,
      falsePositiveRate: 0,
      items: 137,
      report: 'packages/eval/results/2026-10-21-b8-c2.md',
    },
  },
  {
    provider: 'gemini',
    id: 'gemma-4-31b-it',
    autoCheck: false, // smoke test only (no false positives on 20 sentences); ~4× slower; not run through the eval
    dataUse: 'Gemini API free tier: Google may use content to improve its products.',
  },
  {
    provider: 'local',
    id: 'gemma4:26b-a4b-it-qat',
    // Same weights as the evaluated hosted model (4-bit QAT). The local path itself is untested.
    autoCheck: true,
    sameWeightsAs: 'gemini:gemma-4-26b-a4b-it',
    vramGb: 16,
    dataUse: 'Runs on your machine; nothing is sent.',
  },
];

/** What to tell the user about a model before automatic checking: evaluated, same weights, or unknown. */
export function modelAdvice(provider: string, id: string): { evaluated: boolean; note?: string } {
  const info = modelInfo(provider, id);
  if (info?.eval) return { evaluated: true };
  if (info?.autoCheck && info.sameWeightsAs) {
    return { evaluated: false, note: `Same weights as ${info.sameWeightsAs}, which passed Margin's eval; running it locally hasn't been tested yet.` };
  }
  return {
    evaluated: false,
    note: 'This model hasn’t been through Margin’s eval. Smaller models (under ~9B) tend to over-correct; if you see bad suggestions, switch to the trigger “save” or “manual”, or try gemma4:26b-a4b-it-qat.',
  };
}

export const modelInfo = (provider: string, id: string): ModelInfo | undefined => MODELS.find((m) => m.provider === provider && m.id === id);
