// Zero-dependency static SPA server for the Vite-built `dist/` folder.
// Designed for Azure App Service Linux (Node 24-lts) so deploy needs no `npm install`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, 'dist');
const port = Number(process.env.PORT) || 8080;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

function safeJoin(base, target) {
  const p = path.normalize(path.join(base, target));
  if (!p.startsWith(base)) return null;
  return p;
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  if (body) res.end(body); else res.end();
}

function serveFile(filePath, req, res) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback to index.html
      const fallback = path.join(root, 'index.html');
      fs.readFile(fallback, (e, data) => {
        if (e) return send(res, 404, { 'Content-Type': 'text/plain' }, 'Not found');
        send(res, 200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-cache' }, data);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': mime[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
    };

    if (filePath.endsWith(path.join(root, 'index.html'))) {
      headers['Cache-Control'] = 'no-cache';
    } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    } else {
      headers['Cache-Control'] = 'public, max-age=3600';
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, { 'Content-Type': 'text/plain' }, 'Method not allowed');
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad request');
  }

  if (urlPath === '/' || urlPath === '') {
    return serveFile(path.join(root, 'index.html'), req, res);
  }

  const filePath = safeJoin(root, urlPath);
  if (!filePath) return send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad request');
  serveFile(filePath, req, res);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[server] serving ${root} on http://0.0.0.0:${port}`);
});
