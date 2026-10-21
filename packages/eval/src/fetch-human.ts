// Downloads the human-written eval text into packages/eval/data/ (git-ignored; never committed).
//
//   pnpm -F @margin/eval fetch-human
//
// JFLEG (Napoles et al., 2017; CC BY-NC-SA 4.0): learner essay sentences, each with four human
// corrections. Project Gutenberg: public-domain books from the 1910s-1920s, used as clean prose.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { BOOKS } from './books.ts';

const JFLEG = 'https://raw.githubusercontent.com/keisks/jfleg/master';

const dir = new URL('../data/', import.meta.url);
mkdirSync(new URL('jfleg/', dir), { recursive: true });
mkdirSync(new URL('gutenberg/', dir), { recursive: true });

async function get(url: string, to: URL): Promise<void> {
  if (existsSync(to)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(to, await res.text());
  console.log(`fetched ${url}`);
}

for (const f of ['test.src', 'test.ref0', 'test.ref1', 'test.ref2', 'test.ref3']) await get(`${JFLEG}/test/${f}`, new URL(`jfleg/${f}`, dir));
for (const id of Object.values(BOOKS)) await get(`https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`, new URL(`gutenberg/${id}.txt`, dir));
console.log('data ready in packages/eval/data/');
