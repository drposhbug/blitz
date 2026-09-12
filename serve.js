// serve.js — tiny static server so the game runs from http://localhost instead of file://.
// Browsers treat file:// images as "tainted", which blocks canvas pixel effects; over http they work.
// Usage: node serve.js   (or double-click "Play BLITZ.cmd")
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8321;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end('bad url'); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.log('BLITZ is already being served on port ' + PORT + ', opening it.'); open(); setTimeout(() => process.exit(0), 500); }
  else { console.error(e); process.exit(1); }
});
server.listen(PORT, '127.0.0.1', () => { console.log('BLITZ running at http://localhost:' + PORT + '/  (close this window to stop)'); open(); });

function open() { if (!process.argv.includes('--no-open')) exec('start "" "http://localhost:' + PORT + '/"'); }
