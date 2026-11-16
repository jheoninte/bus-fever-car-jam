import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/01_GDD_Core_Mechanics.md',
  'docs/02_Level_Balance_1_to_20.md',
  'docs/03_Monetization_LiveOps.md',
  'data/levels_seed.json',
  'web-prototype/index.html'
];

const missing = [];
for (const file of required) {
  try {
    await access(path.join(rootDir, file));
  } catch {
    missing.push(file);
  }
}

if (missing.length) {
  console.error('Missing required files:');
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}

console.log('Repository check passed.');
