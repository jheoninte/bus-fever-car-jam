import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const rootIndex = process.argv.indexOf('--root');
const rootArgs = rootIndex >= 0 ? ['--root', process.argv[rootIndex + 1]] : [];
const server = spawn(process.execPath, ['scripts/dev-server.mjs', '--port', '0', ...rootArgs], {
  cwd: new URL('../', import.meta.url), env: { ...process.env, PORT: '' }, stdio: ['ignore', 'pipe', 'pipe']
});
let timeout;
try {
  const base = await new Promise((resolve, reject) => {
    let output = '';
    timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    server.on('error', reject);
    server.on('exit', code => reject(new Error(`Server exited ${code}`)));
    server.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
  });
  const redirect = await fetch(base, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  const pageUrl = new URL(redirect.headers.get('location'), base);
  const page = await fetch(pageUrl);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Content-Security-Policy/);
  for (const [, relative] of html.matchAll(/<link\b[^>]*href=['"]([^'"]+\.css)['"]/g)) {
    const response = await fetch(new URL(relative, pageUrl));
    assert.equal(response.status, 200, relative);
    assert.match(response.headers.get('content-type'), /text\/css/);
  }
  for (const [, relative] of html.matchAll(/<script\b[^>]*\bsrc=['"]([^'"]+)['"]/g)) {
    const assetUrl = new URL(relative, pageUrl);
    assert.equal(assetUrl.origin, pageUrl.origin);
    const response = await fetch(assetUrl);
    assert.equal(response.status, 200, relative);
    assert.match(response.headers.get('content-type'), /javascript/);
  }
  for (const [, relative] of html.matchAll(/from\s*['"](\.\/src\/[^'"]+)['"]/g)) {
    const response = await fetch(new URL(relative, pageUrl));
    assert.equal(response.status, 200, relative);
    assert.match(response.headers.get('content-type'), /javascript/);
  }
  assert.equal((await fetch(new URL('../data/levels_seed.json', pageUrl))).status, 200);
  for (const name of ['hint-client.js', 'hint-engine.js', 'hint-worker.js']) {
    const response = await fetch(new URL(`./src/${name}`, pageUrl));
    assert.equal(response.status, 200, name);
    assert.match(response.headers.get('content-type'), /javascript/);
  }
  assert.equal((await fetch(`${base}/.git/config`)).status, 404);
  assert.equal((await fetch(`${base}/web-prototype/src/platform-bridge.js?v=1`)).status, 200);
  console.log(`Serving validation passed (${rootArgs[1] || 'source'}): entry redirect, local engine/modules, seed URL, query strings.`);
} finally {
  clearTimeout(timeout);
  if (server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
}
