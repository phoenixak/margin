import { describe, expect, it } from 'vitest';
import { detectLocalServers, localSetupHelp } from '../src/index.js';

/** A fake fetch that answers per URL; anything else is "connection refused". */
function fakeFetch(routes: Record<string, { status: number; body?: unknown }>): typeof fetch {
  return (async (input: string) => {
    const r = routes[String(input)];
    if (!r) throw new TypeError('fetch failed');
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  }) as typeof fetch;
}

describe('detectLocalServers', () => {
  it('finds Ollama via /api/tags and LM Studio via /v1/models', async () => {
    const probes = await detectLocalServers({
      fetch: fakeFetch({
        'http://localhost:11434/api/tags': { status: 200, body: { models: [{ name: 'gemma4:26b-a4b-it-qat' }, { name: 'qwen3.5:9b' }] } },
        'http://localhost:1234/v1/models': { status: 200, body: { data: [{ id: 'google/gemma-4-12b' }] } },
      }),
    });
    expect(probes.map((p) => p.server)).toEqual([
      { kind: 'ollama', baseURL: 'http://localhost:11434/v1', models: ['gemma4:26b-a4b-it-qat', 'qwen3.5:9b'] },
      { kind: 'lmstudio', baseURL: 'http://localhost:1234/v1', models: ['google/gemma-4-12b'] },
    ]);
  });

  it('reports unreachable servers, refused origins and empty servers', async () => {
    const probes = await detectLocalServers({
      urls: ['http://localhost:11434', 'http://localhost:9999/v1', 'http://localhost:1234'],
      fetch: fakeFetch({
        'http://localhost:11434/api/tags': { status: 403 },
        'http://localhost:1234/v1/models': { status: 200, body: { data: [] } },
      }),
    });
    expect(probes.map((p) => p.problem)).toEqual(['forbidden-origin', 'unreachable', 'no-models']);
  });

  it('gives OS-specific help for Ollama origins and points LM Studio users at CORS', () => {
    expect(localSetupHelp('forbidden-origin', 'ollama', 'windows')).toContain('setx OLLAMA_ORIGINS');
    expect(localSetupHelp('forbidden-origin', 'ollama', 'linux')).toContain('ollama serve');
    expect(localSetupHelp('forbidden-origin', 'lmstudio', 'mac')).toContain('Enable CORS');
  });
});
