import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', rootIndex >= 0 ? args[rootIndex + 1] : '.');
const portIndex = args.indexOf('--port');
const port = Number(process.env.PORT || (portIndex >= 0 ? args[portIndex + 1] : 4173));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function resolveTarget(urlPath) {
  const safePath = decodeURIComponent(new URL(urlPath, 'http://localhost').pathname).replace(/^\/+/, '');
  const target = path.resolve(rootDir, safePath);
  const relative = path.relative(rootDir, target);
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part.startsWith('.'))) {
    throw new Error('Invalid asset path');
  }
  return target;
}

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(302, { Location: '/web-prototype/index.html' });
      res.end();
      return;
    }
    const target = resolveTarget(req.url || '/');
    const info = await stat(target);
    const filePath = info.isDirectory() ? path.join(target, 'index.html') : target;
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Bus Fever Car Jam dev server: http://127.0.0.1:${server.address().port}`);
  console.log('Root redirects to /web-prototype/index.html.');
});
