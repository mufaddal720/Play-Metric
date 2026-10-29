// Static server for dist/ that applies the production headers from dist/_headers, so the
// automated tests run under the same Content-Security-Policy and Permissions-Policy as the live site.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const root = 'dist';
const port = Number(process.argv[2] ?? 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.tflite': 'application/octet-stream', '.json': 'application/json', '.png': 'image/png' };

function parseHeaders() {
  const rules = [];
  let cur = null;
  for (const line of readFileSync(join(root, '_headers'), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!line.startsWith(' ')) { cur = { pattern: line.trim(), headers: {} }; rules.push(cur); }
    else { const i = line.indexOf(':'); cur.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
  return rules;
}
const rules = parseHeaders();
const match = (p, url) => (p.endsWith('*') ? url.startsWith(p.slice(0, -1)) : url === p);

createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = normalize(join(root, url));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404).end('Not found'); return; }
  for (const r of rules) if (match(r.pattern, url)) for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(port, () => console.log(`Local: http://localhost:${port}/ (serving ${root} with production headers)`));
