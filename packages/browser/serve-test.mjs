// Serves manual test pages on http://localhost:5173 (an http origin you can enable Margin on).
//   /      the test page with every field type
//   /demo  a realistic writing box, used for store screenshots
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

createServer((req, res) => {
  const file = req.url?.startsWith('/demo') ? 'store-demo.html' : 'test-page.html';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(readFileSync(new URL(`./static/${file}`, import.meta.url)));
}).listen(5173, 'localhost', () => console.log('Margin test pages: http://localhost:5173 and /demo'));
