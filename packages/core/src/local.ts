/**
 * Finds local model servers (Ollama, LM Studio, or anything OpenAI-compatible) and
 * lists their models, so users pick from what they have instead of typing ids.
 */

export type LocalServerKind = 'ollama' | 'lmstudio' | 'openai-compatible';

export interface LocalServer {
  kind: LocalServerKind;
  /** OpenAI-compatible base URL, ready for `createModel({ provider: 'local', baseURL })`. */
  baseURL: string;
  models: string[];
}

export type LocalProblem =
  /** Nothing answered (server not running, wrong port). */
  | 'unreachable'
  /** The server refused this origin: from a browser extension, Ollama needs OLLAMA_ORIGINS, LM Studio needs CORS on. */
  | 'forbidden-origin'
  | 'no-models';

export interface LocalProbe {
  url: string;
  server?: LocalServer;
  problem?: LocalProblem;
}

export const DEFAULT_LOCAL_URLS = ['http://localhost:11434', 'http://localhost:1234'];

/** Probes each URL (a server root or an `/v1` base URL). Never throws. */
export async function detectLocalServers(options: { urls?: string[]; fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<LocalProbe[]> {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 1500;
  return Promise.all((options.urls ?? DEFAULT_LOCAL_URLS).map((url) => probe(url, doFetch, timeoutMs)));
}

async function probe(url: string, doFetch: typeof fetch, timeoutMs: number): Promise<LocalProbe> {
  const root = url.replace(/\/+$/, '').replace(/\/v1$/, '');
  const get = async (path: string) => {
    try {
      return await doFetch(`${root}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      return undefined;
    }
  };

  // Ollama's native listing has the friendliest names (e.g. `gemma4:26b-a4b-it-qat`).
  const tags = await get('/api/tags');
  if (tags?.status === 403) return { url, problem: 'forbidden-origin' };
  if (tags?.ok) {
    const body = (await tags.json().catch(() => ({}))) as { models?: { name?: string; model?: string }[] };
    const models = (body.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean);
    return models.length ? { url, server: { kind: 'ollama', baseURL: `${root}/v1`, models } } : { url, problem: 'no-models' };
  }

  const list = await get('/v1/models');
  if (!list) return { url, problem: 'unreachable' };
  if (list.status === 403 || list.status === 401) return { url, problem: 'forbidden-origin' };
  if (!list.ok) return { url, problem: 'unreachable' };
  const body = (await list.json().catch(() => ({}))) as { data?: { id?: string }[] };
  const models = (body.data ?? []).map((m) => m.id ?? '').filter(Boolean);
  const kind: LocalServerKind = /:1234$/.test(root) ? 'lmstudio' : 'openai-compatible';
  return models.length ? { url, server: { kind, baseURL: `${root}/v1`, models } } : { url, problem: 'no-models' };
}

/** How to let a browser extension reach a local server, per problem and OS. */
export function localSetupHelp(problem: LocalProblem, kind: LocalServerKind | undefined, os: 'windows' | 'mac' | 'linux'): string {
  if (problem === 'unreachable') return 'No local server answered. Start Ollama (ollama serve) or LM Studio’s server, then try again.';
  if (problem === 'no-models') return kind === 'lmstudio' ? 'LM Studio is running but has no model loaded.' : 'The server is running but has no models. Pull one, e.g. `ollama pull gemma4:26b-a4b-it-qat`.';
  if (kind === 'lmstudio') return 'In LM Studio’s Developer tab, open server settings and turn on “Enable CORS” (or run `lms server start --cors`).';
  const origins = 'chrome-extension://*,moz-extension://*';
  if (os === 'windows') return `Ollama blocks browser extensions by default. Run \`setx OLLAMA_ORIGINS "${origins}"\` in a terminal, then quit Ollama from the tray and start it again.`;
  if (os === 'mac') return `Ollama blocks browser extensions by default. Run \`launchctl setenv OLLAMA_ORIGINS "${origins}"\`, then quit and reopen Ollama.`;
  return `Ollama blocks browser extensions by default. Start it with \`OLLAMA_ORIGINS="${origins}" ollama serve\` (or add it to the systemd service's Environment).`;
}
