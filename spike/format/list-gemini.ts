// Lists the Gemma models the Gemini API hosts for this key: node --env-file=.env format/list-gemini.ts
const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error('GEMINI_API_KEY is not set');
const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key } });
const body = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
for (const m of body.models ?? []) {
  if (/gemma/i.test(m.name) && m.supportedGenerationMethods?.includes('generateContent')) console.log(m.name.replace('models/', ''));
}
