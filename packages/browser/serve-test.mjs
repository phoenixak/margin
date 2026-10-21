// Serves the manual test page at http://localhost:5173 (an http origin you can enable Margin on).
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(readFileSync(new URL('./static/test-page.html', import.meta.url)));
}).listen(5173, 'localhost', () => console.log('Margin test page: http://localhost:5173'));
