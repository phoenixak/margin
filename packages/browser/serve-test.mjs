// Serves manual test pages on http://localhost:5173 (an http origin you can enable Margin on).
//   /      the test page with every field type
//   /demo  a realistic writing box, used for store screenshots
//   /bench an empty comment box for the in-browser benchmark
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';

createServer((req, res) => {
  // The benchmark's texts: real GitHub issues from `pnpm -F @margin/eval fetch-real` (git-ignored, local only).
  if (req.url === '/bench.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    res.end(readFileSync(new URL('./static/bench.js', import.meta.url)));
    return;
  }
  if (req.url === '/bench-data') {
    const dir = new URL('../eval/data/real/issues/', import.meta.url);
    const docs = existsSync(dir) ? readdirSync(dir).sort().map((name) => ({ name, text: readFileSync(new URL(name, dir), 'utf8') })) : [];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(docs));
    return;
  }
  const file = req.url?.startsWith('/demo') ? 'store-demo.html' : req.url?.startsWith('/bench') ? 'bench.html' : 'test-page.html';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(readFileSync(new URL(`./static/${file}`, import.meta.url)));
}).listen(5173, 'localhost', () => console.log('Margin test pages: http://localhost:5173 and /demo'));
