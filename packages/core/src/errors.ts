import { APICallError } from '@ai-sdk/provider';
import type { MarginModel } from './model.js';

const statusOf = (error: unknown) => (APICallError.isInstance(error) ? error.statusCode : undefined);

/** Turns provider errors into something a user can act on, especially for local servers. */
export function explainError(error: unknown, model: MarginModel): string {
  const cause = (error as { lastError?: unknown })?.lastError ?? error; // AI SDK RetryError wraps the last attempt
  const status = statusOf(cause);
  const text = cause instanceof Error ? cause.message : String(cause);
  if (model.provider === 'local') {
    if (status === undefined && /fetch failed|ECONNREFUSED|Cannot connect|network/i.test(text)) {
      return 'Can’t reach the local model server. Is Ollama or LM Studio running, and is the server URL right?';
    }
    if (status === 403) return 'The local server refused the request. From a browser extension, Ollama needs OLLAMA_ORIGINS and LM Studio needs “Enable CORS”.';
    if (status === 404 || /not found/i.test(text)) return `The local server doesn’t have “${model.modelId}”. Pull it (e.g. ollama pull ${model.modelId}) or choose another model.`;
  }
  if (status === 401 || status === 403 || /API key not valid/i.test(text)) return 'The provider rejected the API key. Set it again.';
  if (status === 429 || status === 503 || /high demand|overloaded|quota/i.test(text)) return 'The provider is busy or rate-limited. Try again in a minute.';
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}
