import { z } from 'zod';

export const Fix = z.object({
  id: z.number().int(),
  text: z.string().min(1),
  kind: z.enum(['grammar', 'word', 'punctuation', 'clarity']),
  why: z.string().max(120),
});
export type Fix = z.infer<typeof Fix>;

/** Format A: the structured-output schema. */
export const Fixes = z.object({ fixes: z.array(Fix) });

/**
 * Format B: `<fix id="N" kind="…">sentence</fix><why>…</why>` lines, or `<none/>`.
 * Returns undefined when the reply can't be read. An empty reply is a failure,
 * not "no fixes" (reasoning can use up the output budget and leave no text).
 */
export function parseTags(text: string): Fix[] | undefined {
  const out: Fix[] = [];
  for (const m of text.matchAll(/<fix\s+id="(\d+)"(?:\s+kind="(\w+)")?\s*>([\s\S]*?)<\/fix>\s*(?:<why>([\s\S]*?)<\/why>)?/g)) {
    const r = Fix.safeParse({ id: Number(m[1]), kind: m[2] ?? 'grammar', text: m[3]!.trim(), why: (m[4] ?? '').trim().slice(0, 120) });
    if (r.success) out.push(r.data);
  }
  if (out.length) return out;
  return /<none\s*\/>/.test(text) ? [] : undefined;
}

/** Format A replies that failed strict parsing: strip code fences and find the JSON object. */
export function parseJsonLenient(text: string): Fix[] | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = Fixes.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data.fixes : undefined;
  } catch {
    return undefined;
  }
}
