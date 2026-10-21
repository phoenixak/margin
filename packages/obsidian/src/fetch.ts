import { requestUrl } from 'obsidian';

/**
 * `fetch` on top of Obsidian's `requestUrl`, which isn't subject to CORS. That means
 * Ollama and LM Studio work from Obsidian without OLLAMA_ORIGINS or "Enable CORS".
 * `requestUrl` doesn't stream, so a rewrite arrives in one piece.
 */
export const obsidianFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    // Obsidian sets these itself; passing them can make requests fail.
    if (key !== 'content-length' && key !== 'host') headers[key] = value;
  });
  const request = requestUrl({
    url,
    method: init?.method ?? 'GET',
    headers,
    ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    throw: false,
  });
  const res = await (init?.signal
    ? Promise.race([
        request,
        new Promise<never>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })),
      ])
    : request);
  return new Response(res.status === 204 ? null : res.arrayBuffer, { status: res.status, headers: res.headers });
};
