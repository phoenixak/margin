// Unit tests never touch the network (CLAUDE.md). Any real fetch fails loudly.
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`network access in a unit test: ${String(input)}`);
}) as typeof fetch;
