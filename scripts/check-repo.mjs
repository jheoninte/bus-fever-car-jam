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
  'docs/04_iOS_Release_Handoff.md',
  'docs/05_AdMob_StoreKit_Mapping.md',
  'docs/06_iOS_Compliance_Risk_Checklist.md',
  'docs/07_iOS_Native_Bridge_Blueprint.md',
  'docs/08_App_Review_QA_Matrix.md',
  'ios/README.md',
  'ios/Config/Info.plist',
  'ios/Config/BusFever.entitlements',
  'ios/Config/Debug.xcconfig',
  'ios/Config/Release.xcconfig',
  'ios/bridge-bootstrap.js',
  'ios/Sources/GameViewController.swift',
  'ios/Sources/NativeBridge.swift',
  'ios/Sources/LoopbackHTTPServer.swift',
  'ios/Sources/LocalSaveStore.swift',
  'ios/Sources/StoreKitService.swift',
  'ios/Sources/PurchaseCatalog.swift',
  'ios/Sources/CloudSavePolicy.swift',
  'ios/Sources/CloudSaveService.swift',
  'ios/Tests/CloudSaveTests.swift',
  'ios/Sources/NativePresentationGate.swift',
  'ios/Tests/PurchaseJournalTests.swift',
  'ios/BusFever.xcodeproj/project.pbxproj',
  'ios/Tests/LocalSaveStoreTests.swift',
  'ios/Tests/HostBoundaryTests.swift',
  'data/levels_seed.json',
  'data/level-verification.json',
  'web-prototype/src/puzzle-engine.js',
  'web-prototype/src/purchase-state.js',
  'web-prototype/src/solver.js',
  'web-prototype/src/level-schema.js',
  'web-prototype/src/boosters.js',
  'web-prototype/src/round-save.js',
  'web-prototype/src/hint-engine.js',
  'web-prototype/src/hint-client.js',
  'web-prototype/src/hint-worker.js',
  'web-prototype/index.html',
  'web-prototype/vendor/phaser/phaser.min.js',
  'web-prototype/vendor/phaser/LICENSE.md',
  'web-prototype/vendor/phaser/manifest.json'
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
