import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function validateOfflineBundle(root) {
  const entry = path.resolve(root, 'web-prototype/index.html');
  const html = await readFile(entry, 'utf8');
  const visited = new Set();
  const allowedInline = /^(data:|blob:|#)/i;
  const resolveAsset = (reference, owner) => {
    if (allowedInline.test(reference)) return null;
    assert.ok(!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference), `Remote runtime asset: ${reference}`);
    assert.ok(!reference.startsWith('/'), `Bundle asset must use a relative URL: ${reference}`);
    const asset = path.resolve(path.dirname(owner), decodeURIComponent(reference.split(/[?#]/)[0]));
    const relative = path.relative(root, asset);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Asset outside bundle: ${reference}`);
    return asset;
  };
  const inspectScript = async (source, owner) => {
    for (const [, reference] of source.matchAll(/new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)) {
      await visit(reference, owner);
    }
    for (const [, reference] of source.matchAll(/(?:\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s*)?|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)) {
      await visit(reference, owner);
    }
    for (const [, reference] of source.matchAll(/\b(?:fetch|loadStageSeed)\s*\(\s*['"]([^'"]+)['"]/g)) {
      await visit(reference, entry);
    }
    assert.ok(!/['"`](?:https?:)?\/\//i.test(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
      `Review remote URL in app script: ${path.relative(root, owner)}`);
  };
  const inspectCss = async (source, owner) => {
    assert.ok(!/@import/i.test(source), `Use bundled stylesheets: ${owner}`);
    for (const [, reference] of source.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) await visit(reference, owner);
  };
  const visit = async (reference, owner) => {
    const asset = resolveAsset(reference, owner);
    if (!asset || visited.has(asset)) return;
    visited.add(asset);
    const content = await readFile(asset);
    if (asset.includes(`${path.sep}vendor${path.sep}`)) return;
    if (path.extname(asset) === '.js') await inspectScript(content.toString('utf8'), asset);
    if (path.extname(asset) === '.css') await inspectCss(content.toString('utf8'), asset);
  };
  for (const [, reference] of html.matchAll(/<(?:script|img|audio|video|source)\b[^>]*\bsrc=['"]([^'"]+)['"]/g)) await visit(reference, entry);
  for (const [, reference] of html.matchAll(/<link\b[^>]*\bhref=['"]([^'"]+)['"]/g)) await visit(reference, entry);
  for (const [, source] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) await inspectScript(source, entry);
  for (const [, source] of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) await inspectCss(source, entry);
  const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
  assert.ok(policy?.includes("connect-src 'self'") && policy.includes("default-src 'self'"), 'Missing offline resource policy');
  const vendorRoot = path.resolve(root, 'web-prototype/vendor/phaser');
  const manifest = JSON.parse(await readFile(path.join(vendorRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '3.80.1');
  assert.equal(manifest.license, 'MIT');
  for (const name of ['phaser.min.js', 'LICENSE.md']) {
    const bytes = await readFile(path.join(vendorRoot, name));
    assert.equal(bytes.length, manifest.files[name].bytes, `Vendor size mismatch: ${name}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.files[name].sha256, `Vendor checksum mismatch: ${name}`);
  }
  assert.ok(visited.has(path.join(vendorRoot, 'phaser.min.js')), 'Local Phaser script missing');
  return { assets: visited.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)), process.argv[2] || '.');
  const result = await validateOfflineBundle(root);
  console.log(`Offline bundle validation passed: ${result.assets} local assets, Phaser/license checksums, no remote runtime URLs.`);
}
