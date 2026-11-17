import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const version = '3.80.1';
const tarball = `https://registry.npmjs.org/phaser/-/phaser-${version}.tgz`;
const integrity = 'sha512-VQGAWoDOkEpAWYkI+PUADv5Ql+SM0xpLuAMBJHz9tBcOLqjJ2wd8bUhxJgOqclQlLTg97NmMd9MhS75w16x1Cw==';
const destination = fileURLToPath(new URL('../web-prototype/vendor/phaser/', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'bus-fever-phaser-'));
const archive = path.join(temporary, 'phaser.tgz');

try {
  const response = await fetch(tarball, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Phaser download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== integrity) {
    throw new Error('Phaser archive integrity mismatch');
  }
  await writeFile(archive, bytes);
  const extraction = spawnSync('tar', ['-xzf', archive, '-C', temporary, '--strip-components=1',
    'package/dist/phaser.min.js', 'package/LICENSE.md'], { encoding: 'utf8' });
  if (extraction.status !== 0) throw new Error(extraction.stderr || extraction.error?.message || 'tar extraction failed');
  await mkdir(destination, { recursive: true });
  const files = {};
  for (const [source, name] of [['dist/phaser.min.js', 'phaser.min.js'], ['LICENSE.md', 'LICENSE.md']]) {
    const sourcePath = path.join(temporary, source);
    const content = await readFile(sourcePath);
    await cp(sourcePath, path.join(destination, name));
    files[name] = { bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') };
  }
  await writeFile(path.join(destination, 'manifest.json'), `${JSON.stringify({ name: 'phaser', version,
    license: 'MIT', tarball, integrity, files }, null, 2)}\n`);
  console.log(`Vendored Phaser ${version}; npm archive SHA-512 verified, license included.`);
} finally {
  for (const name of ['phaser.tgz', 'dist/phaser.min.js', 'LICENSE.md']) {
    await unlink(path.join(temporary, name)).catch(() => {});
  }
  await rmdir(path.join(temporary, 'dist')).catch(() => {});
  await rmdir(temporary).catch(() => {});
}
