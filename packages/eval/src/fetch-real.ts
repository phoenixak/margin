// Downloads real-world documents into packages/eval/data/real/ (git-ignored; never committed):
// docs people keep in editors (READMEs, contributing guides, docs pages from open-source
// projects) and real GitHub issue texts (what people type into a browser text field).
//
//   pnpm -F @margin/eval fetch-real          (uses the GitHub CLI, `gh`, for API access)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

export const DOCS: [repo: string, path: string][] = [
  ['nodejs/node', 'CONTRIBUTING.md'],
  ['microsoft/vscode', 'CONTRIBUTING.md'],
  ['ollama/ollama', 'README.md'],
  ['denoland/deno', 'README.md'],
  ['vitejs/vite', 'docs/guide/index.md'],
  ['excalidraw/excalidraw', 'README.md'],
  ['rust-lang/book', 'src/ch03-01-variables-and-mutability.md'],
  ['facebook/docusaurus', 'website/docs/introduction.mdx'],
  ['mdn/content', 'files/en-us/web/javascript/guide/introduction/index.md'],
  ['obsidianmd/obsidian-help', 'en/Getting started/Create a vault.md'],
  ['zed-industries/zed', 'CONTRIBUTING.md'],
  ['astral-sh/uv', 'README.md'],
];
/** Repos whose recent issues are the browser corpus: 5 prose-heavy issues from each. */
export const ISSUE_REPOS = ['ollama/ollama', 'microsoft/vscode', 'excalidraw/excalidraw', 'home-assistant/core'];

const dir = new URL('../data/real/', import.meta.url);
mkdirSync(new URL('docs/', dir), { recursive: true });
mkdirSync(new URL('issues/', dir), { recursive: true });
const gh = (...args: string[]) => execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

for (const [repo, path] of DOCS) {
  const to = new URL(`docs/${slug(`${repo}-${path}`)}.md`, dir);
  if (existsSync(to)) continue;
  writeFileSync(to, gh('-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${encodeURI(path)}`));
  console.log(`fetched ${repo}/${path}`);
}

/** Words of prose left once code, logs, HTML comments and quoted text are removed. */
const proseWords = (body: string) =>
  body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((l) => !/^\s*(>|#|\||- \[|\s{4})/.test(l))
    .join(' ')
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w)).length;

for (const repo of ISSUE_REPOS) {
  if (existsSync(new URL(`issues/${slug(repo)}-1.md`, dir))) continue;
  const issues = JSON.parse(gh(`repos/${repo}/issues?state=all&per_page=100`)) as { body: string | null; pull_request?: unknown; number: number }[];
  const picked = issues.filter((i) => !i.pull_request && i.body && proseWords(i.body) >= 80 && i.body.length <= 4000).slice(0, 5);
  picked.forEach((i, k) => writeFileSync(new URL(`issues/${slug(repo)}-${k + 1}.md`, dir), i.body!.replace(/\r\n/g, '\n')));
  console.log(`fetched ${picked.length} issues from ${repo}`);
}
console.log('data ready in packages/eval/data/real/');
