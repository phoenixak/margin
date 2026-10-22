import type { Dialect } from '../types.js';

/** Bump on any change to the prompt bytes: it's part of every cache key. */
export const PROMPT_VERSION = 3;

export type OutputFormat = 'json' | 'tags';

const RULES = (dialect: Dialect) => `You are a copy editor doing a minimal-edit proofread of ${dialect} English.

You receive sentences as <s id="N">…</s>. Some may be correct.
Fix only clear errors:
- grammar and agreement (subject–verb, pronoun, tense consistency)
- a wrong word that is still a real word (their/there, affect/effect)
- missing, repeated or extra words
- run-on sentences and comma splices
- punctuation that changes or hides the meaning
Do not:
- change a sentence that is already correct
- change word choice, tone, style or dialect
- fix spelling or capitalization (another tool handles those): leave them as they are, but still fix any other error in that sentence
- touch placeholders like ⟦0⟧; keep each one exactly once, in order
- add or remove negation, numbers, names or facts
- change product names, proper nouns or technical terms
- add optional punctuation: commas after introductory words or phrases, commas around "however" or "on the other hand", hyphens, or dashes in place of hyphens
- treat headings, list items, labels or short fragments as errors (don't add a final period or complete them)
Return only the sentences you changed, each as the full corrected sentence, with a kind and a reason of at most 12 words. If nothing needs fixing, return an empty list.`;

const EXAMPLE_INPUT = `<s id="1">The dogs barks at night.</s>
<s id="2">Open ⟦0⟧ to start.</s>
<s id="3">We was ready, the bus was late.</s>`;

const JSON_EXAMPLE = `{"fixes":[{"id":1,"text":"The dogs bark at night.","kind":"grammar","why":"Plural subject takes a plural verb."},{"id":3,"text":"We were ready, but the bus was late.","kind":"grammar","why":"Subject–verb agreement and a comma splice."}]}`;

const TAGS_EXAMPLE = `<fix id="1" kind="grammar">The dogs bark at night.</fix><why>Plural subject takes a plural verb.</why>
<fix id="3" kind="grammar">We were ready, but the bus was late.</fix><why>Subject–verb agreement and a comma splice.</why>`;

/** The system prompt. Byte-stable for a given dialect and format (snapshot-tested). */
export function checkSystemPrompt(dialect: Dialect, format: OutputFormat): string {
  if (format === 'json') {
    return `${RULES(dialect)}

Answer with JSON only: {"fixes":[{"id":N,"text":"…","kind":"grammar|word|punctuation|clarity","why":"…"}]}

Example input:
${EXAMPLE_INPUT}
Example output:
${JSON_EXAMPLE}`;
  }
  return `${RULES(dialect)}

Answer with one line per changed sentence, and nothing else:
<fix id="N" kind="grammar|word|punctuation|clarity">full corrected sentence</fix><why>reason</why>
If nothing needs fixing, answer <none/>.

Example input:
${EXAMPLE_INPUT}
Example output:
${TAGS_EXAMPLE}`;
}

/** The user prompt: one numbered sentence per line. */
export function checkUserPrompt(sentences: { id: number; text: string }[]): string {
  return sentences.map((s) => `<s id="${s.id}">${s.text.replace(/\s+/g, ' ')}</s>`).join('\n');
}
