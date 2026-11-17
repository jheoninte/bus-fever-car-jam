import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createPlatformBridge } from '../web-prototype/src/platform-bridge.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const regenerated = spawnSync(process.execPath, ['scripts/generate-ios-project.mjs', '--check'], { cwd: root, encoding: 'utf8' });
assert.equal(regenerated.status, 0, regenerated.stderr);
const text = await readFile(new URL('../ios/BusFever.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
// Parse the OpenStep property-list syntax actually written to disk, then verify target/reference connectivity.
const tokens = [];
const pattern = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|[{}()=;,]|[^\s{}()=;,]+/gy;
let cursor = 0;
while (cursor < text.length) {
  pattern.lastIndex = cursor;
  const match = pattern.exec(text);
  assert.ok(match, `Invalid PBX syntax at ${cursor}`);
  cursor = pattern.lastIndex;
  if (!/^\s|^\/\//.test(match[0]) && !match[0].startsWith('/*')) tokens.push(match[0]);
}
let index = 0;
function expect(token) { assert.equal(tokens[index++], token); }
function parse() {
  const token = tokens[index++];
  if (token === '{') {
    const result = {};
    while (tokens[index] !== '}') {
      const key = parse();
      assert.equal(typeof key, 'string');
      assert.equal(Object.hasOwn(result, key), false, `Duplicate PBX key ${key}`);
      expect('='); result[key] = parse(); expect(';');
    }
    expect('}'); return result;
  }
  if (token === '(') {
    const result = [];
    while (tokens[index] !== ')') {
      result.push(parse());
      if (tokens[index] !== ')') expect(',');
    }
    expect(')'); return result;
  }
  assert.ok(token && !['}', ')', '=', ';', ','].includes(token), 'Unexpected PBX token');
  return token.startsWith('"') ? JSON.parse(token) : token;
}
const pbx = parse();
assert.equal(index, tokens.length);
const objects = pbx.objects;
assert.equal(objects[pbx.rootObject].isa, 'PBXProject');
function references(value) {
  if (Array.isArray(value)) value.forEach(references);
  else if (value && typeof value === 'object') Object.values(value).forEach(references);
  else if (typeof value === 'string' && /^[A-F0-9]{24}$/.test(value)) assert.ok(objects[value], `Dangling PBX reference ${value}`);
}
references(pbx);
const targets = objects[pbx.rootObject].targets.map(id => objects[id]);
const app = targets.find(target => target.productType === 'com.apple.product-type.application');
const test = targets.find(target => target.productType === 'com.apple.product-type.bundle.unit-test');
assert.ok(app && test);
assert.ok(test.dependencies.some(id => objects[id].target === objects[pbx.rootObject].targets[0]));
for (const target of targets) {
  const phases = target.buildPhases.map(id => objects[id]);
  const sources = phases.find(phase => phase.isa === 'PBXSourcesBuildPhase').files.map(id => objects[objects[id].fileRef].path);
  assert.ok(sources.length >= 2);
  for (const relative of sources) await access(path.join(root, 'ios', relative));
  const configurations = objects[target.buildConfigurationList].buildConfigurations.map(id => objects[id]);
  assert.deepEqual(configurations.map(config => config.name), ['Debug', 'Release']);
}
const resources = app.buildPhases.map(id => objects[id]).find(phase => phase.isa === 'PBXResourcesBuildPhase').files
  .map(id => objects[objects[id].fileRef].path);
assert.ok(resources.includes('../build/ios/WebBundle') && resources.includes('bridge-bootstrap.js'));
const packages = objects[pbx.rootObject].packageReferences.map(id => objects[id]);
assert.equal(packages.length, 2);
for (const [name, version] of [['google-mobile-ads', '13.13.0'], ['google-user-messaging-platform', '3.1.0']]) {
  const dependency = packages.find(item => item.repositoryURL.endsWith(`swift-package-manager-${name}.git`));
  assert.ok(dependency);
  assert.deepEqual(dependency.requirement, { kind: 'exactVersion', version });
}
const products = app.packageProductDependencies.map(id => objects[id].productName).sort();
assert.deepEqual(products, ['GoogleMobileAds', 'GoogleUserMessagingPlatform']);
const frameworks = app.buildPhases.map(id => objects[id]).find(phase => phase.isa === 'PBXFrameworksBuildPhase');
assert.deepEqual(frameworks.files.map(id => objects[objects[id].productRef].productName).sort(), products);
const gate = app.buildPhases.map(id => objects[id]).find(phase => phase.isa === 'PBXShellScriptBuildPhase');
assert.match(gate.shellScript, /Release/);
assert.match(gate.shellScript, /exit 1/);

const bridge = await readFile(path.join(root, 'ios/Sources/NativeBridge.swift'), 'utf8');
const bootstrap = await readFile(path.join(root, 'ios/bridge-bootstrap.js'), 'utf8');
const requests = [];
const context = { window: { webkit: { messageHandlers: { busFeverNative: { postMessage: async request => {
  requests.push(request);
  if (request.action === 'initialize') return { capabilities: { nativeAds: false, nativeIap: false, restorePurchases: false, att: false, cloudSave: false, localReceiptValidation: false } };
  if (request.action === 'getProducts') return [];
  if (request.action === 'getTrackingAuthorizationStatus') return 'denied';
  throw new Error('Unavailable native service should not be invoked by purchase/restore gates');
} } } } } };
vm.runInNewContext(bootstrap, context);
const methodNames = Object.keys(context.window.BusFeverNative);
const routes = [...bridge.matchAll(/case "(\w+)":/g)].map(match => match[1]);
assert.deepEqual(routes.sort(), methodNames.sort(), 'Bootstrap/native action contract drift');
const platform = createPlatformBridge(context.window);
await platform.initialize();
assert.ok(Object.values(platform.capabilities).every(value => value === false));
assert.equal((await platform.purchaseProduct('com.busfever.coinpack.small')).success, false);
assert.deepEqual(await platform.restorePurchases(), []);
assert.deepEqual(await platform.getPendingTransactions(), []);
assert.equal(await platform.configureAds(), false);
assert.equal((await platform.showPrivacyOptions()).presented, false);
assert.equal((await platform.getPrivacyOptionsStatus()).requirement, 'unavailable');
assert.equal(await platform.loadCloudSave(), null);
assert.equal((await platform.syncCloudSave({})).queued, false);
assert.equal(await platform.finishTransaction('123'), false);
assert.equal((await platform.commitPurchase('com.busfever.coinpack.small', '123')).persisted, false);
assert.equal((await platform.getEntitlements()).verified, false);
assert.equal((await platform.getCloudSaveStatus()).state, 'unavailable');
assert.equal((await platform.manageCloudSave()).changed, false);
assert.equal((await platform.verifyProductOwnership('com.busfever.removeads')).verified, false);
const tracking = await platform.requestTrackingAuthorization();
assert.equal(tracking.status, 'denied');
assert.equal(tracking.promptCount, 0);
assert.equal(tracking.source, 'unavailable');
assert.ok(requests.every(request => ['initialize', 'getTrackingAuthorizationStatus'].includes(request.action)));
const plist = await readFile(path.join(root, 'ios/Config/Info.plist'), 'utf8');
assert.ok(plist.includes('<key>NSAllowsLocalNetworking</key><true/>'));
assert.ok(!plist.includes('NSAllowsArbitraryLoads'), 'Avoid a global ATS exception');
for (const [relative, needed] of [
  ['Sources/LoopbackHTTPServer.swift', ['requiredLocalEndpoint', '127.0.0.1', 'Connection: close', 'Cache-Control: no-store']],
  ['Sources/NativeBridge.swift', ['frameInfo.isMainFrame', 'securityOrigin', 'message.webView === attached']],
  ['Sources/LocalSaveStore.swift', ['.atomic', 'futureSchema', 'oldLedger.allSatisfy']],
  ['Sources/CloudSaveService.swift', ['NSUbiquitousKeyValueStore', 'NSUbiquityIdentityDidChange', 'checkAccount()', 'sameAccount', 'maximumDevices', 'requiresReload', 'isExcludedFromBackup']],
  ['Sources/CloudSavePolicy.swift', ['counters', 'contains(', 'maximumPayloadBytes', 'maximumRecordBytes']],
  ['Sources/GameViewController.swift', ['.atDocumentStart', 'forMainFrameOnly: true', 'callAsyncJavaScript', '.nonPersistent()']]
]) {
  const source = await readFile(path.join(root, 'ios', relative), 'utf8');
  for (const item of needed) assert.ok(source.includes(item), `${relative}: missing ${item}`);
}

if (process.argv.includes('--bundle')) {
  const bundle = path.join(root, 'build/ios/WebBundle');
  const manifest = JSON.parse(await readFile(path.join(bundle, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.entry, 'web-prototype/index.html');
  const seen = new Set();
  for (const file of manifest.files) {
    assert.ok(!seen.has(file.path) && !file.path.split('/').some(part => !part || part.startsWith('.')));
    assert.ok(file.path.startsWith('web-prototype/') || file.path === 'data/levels_seed.json');
    seen.add(file.path);
    const data = await readFile(path.join(bundle, file.path));
    assert.equal(data.length, file.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), file.sha256);
    assert.deepEqual(data, await readFile(path.join(root, file.path)), `Stale iOS asset ${file.path}`);
  }
  const diskFiles = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false);
      if (entry.isDirectory()) await walk(absolute);
      else diskFiles.push(path.relative(bundle, absolute).replaceAll('\\', '/'));
    }
  }
  await walk(bundle);
  assert.deepEqual(diskFiles.filter(file => file !== 'manifest.json').sort(), [...seen].sort());
  assert.ok(seen.has('web-prototype/src/hint-worker.js'));
  assert.equal(manifest.files.find(file => file.path === 'web-prototype/presentation.css')?.mimeType, 'text/css; charset=utf-8');
  assert.ok(!seen.has('data/level-verification.json'));
  console.log(`iOS packaged asset validation passed: ${seen.size} current files, hashes, allowlisted roots, no solution report.`);
}
console.log('iOS host static validation passed: OpenStep project references, bridge action/capability negotiation, packaging rules. Swift/XCTest and WKWebView have NOT run on Windows.');
