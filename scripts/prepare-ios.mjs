import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, realpath, lstat, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateOfflineBundle } from './validate-offline.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
await validateOfflineBundle(dist);
const outputParent = path.join(root, 'build', 'ios');
const output = path.join(outputParent, 'WebBundle');
// Fixed output within this workspace; never remove an input or a caller-supplied directory.
assert.equal(path.relative(root, output).replaceAll('\\', '/'), 'build/ios/WebBundle');
await mkdir(outputParent, { recursive: true });
const resolvedParent = path.relative(await realpath(root), await realpath(outputParent));
assert.ok(resolvedParent && !resolvedParent.startsWith('..') && !path.isAbsolute(resolvedParent), 'Output parent must resolve inside the workspace');
try { assert.equal((await lstat(output)).isSymbolicLink(), false, 'Refusing a symlink output'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'data'), { recursive: true });
await cp(path.join(dist, 'web-prototype'), path.join(output, 'web-prototype'), { recursive: true });
await cp(path.join(dist, 'data', 'levels_seed.json'), path.join(output, 'data', 'levels_seed.json'));
const files = [];
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
async function inspect(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), 'Do not package symlinks');
    if (entry.isDirectory()) await inspect(absolute);
    else {
      const data = await readFile(absolute);
      const relative = path.relative(output, absolute).replaceAll('\\', '/');
      assert.ok(mimeTypes[path.extname(relative)], `Unsupported bundle asset: ${relative}`);
      assert.ok(data.length <= 4 * 1024 * 1024, `Asset exceeds host limit: ${relative}`);
      files.push({ path: relative, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), mimeType: mimeTypes[path.extname(relative)] });
    }
  }
}
await inspect(output);
assert.ok(files.length <= 128 && files.reduce((sum, file) => sum + file.bytes, 0) <= 8 * 1024 * 1024);
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ version: 1, entry: 'web-prototype/index.html', files }, null, 2) + '\n');
console.log(`Prepared ${files.length} hash-manifested iOS assets in ${output}. No Swift compilation performed.`);
