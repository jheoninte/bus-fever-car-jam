import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { createPlatformBridge } from '../web-prototype/src/platform-bridge.js';
import { createPurchaseDelivery } from '../web-prototype/src/purchase-delivery.js';
import { createDefaultMetaState, exportMetaState, hydrateMetaState } from '../web-prototype/src/monetization.js';
import { selectPreferredSave } from '../web-prototype/src/save-policy.js';
import { PRODUCT_IDS, PRODUCT_CATALOG, IAP_GRANTS } from '../web-prototype/src/economy-config.js';
import { applyNativePurchaseSnapshot } from '../web-prototype/src/purchase-state.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storage = () => {
  const entries = new Map();
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
};
const productId = PRODUCT_IDS.coinPackSmall;
const web = createPlatformBridge({ localStorage: storage() });
assert.equal((await web.purchaseProduct(productId)).success, false);
assert.equal((await web.showRewardedAd('revive')).completed, false);
assert.equal((await web.requestTrackingAuthorization()).status, 'not_determined');
assert.equal((await web.syncCloudSave({})).queued, false);
assert.equal((await web.getCloudSaveStatus()).state, 'unavailable');
assert.equal((await web.manageCloudSave()).changed, false);
assert.equal((await web.saveGame({ stage: 3 })).persisted, true);
assert.equal((await web.loadGame()).stage, 3);
const blocked = createPlatformBridge({ get localStorage() { throw new Error('blocked'); } });
assert.equal(await blocked.loadGame(), null);
assert.equal((await blocked.saveGame({})).persisted, false);
const partial = createPlatformBridge({ BusFeverNative: { purchaseProduct: async () => true } });
assert.equal((await partial.purchaseProduct(productId)).success, false);

// Native cloud records never reach the legacy timestamp merger or expose private journals.
let legacyCloudReads = 0;
let cloudManagementCalls = 0;
let finishCloudManagement;
let cloudStatus = { state: 'conflict', connected: true };
const nativeCloud = createPlatformBridge({ BusFeverNative: {
  initialize: async () => ({ capabilities: { cloudSave: true, nativeCloudSave: true } }),
  loadCloudSave: async () => { legacyCloudReads++; return { _nativeIAP: { secret: true } }; },
  syncCloudSave: async () => ({ queued: true }),
  getCloudSaveStatus: async () => cloudStatus,
  manageCloudSave: async () => { cloudManagementCalls++; return new Promise(resolve => { finishCloudManagement = resolve; }); }
} });
await nativeCloud.initialize();
assert.equal(await nativeCloud.loadCloudSave(), null);
assert.equal(legacyCloudReads, 0);
assert.deepEqual(await nativeCloud.getCloudSaveStatus(), { state: 'conflict', connected: true });
cloudStatus = { state: 'synced_forever', connected: 'yes', token: 'must_not_expose' };
assert.deepEqual(await nativeCloud.getCloudSaveStatus(), { state: 'invalid_data', connected: false });
const choosingCloud = nativeCloud.manageCloudSave();
assert.equal(nativeCloud.fullscreenBusy, true);
assert.equal((await nativeCloud.manageCloudSave()).changed, false);
finishCloudManagement({ changed: true, requiresReload: true, _nativeIAP: 'must_not_expose' });
assert.deepEqual(await choosingCloud, { changed: true, requiresReload: true, reason: 'unknown' });
assert.equal(cloudManagementCalls, 1);
assert.equal(nativeCloud.fullscreenBusy, false);
const failedCloud = createPlatformBridge({ BusFeverNative: {
  loadCloudSave: async () => null, syncCloudSave: async () => ({ queued: true }),
  getCloudSaveStatus: async () => { throw new Error('offline'); },
  manageCloudSave: async () => { throw new Error('offline'); }
} });
assert.equal((await failedCloud.getCloudSaveStatus()).state, 'unavailable');
assert.equal((await failedCloud.manageCloudSave()).changed, false);
assert.equal(failedCloud.fullscreenBusy, false);
let endCloudTestAd;
let blockedCloudCalls = 0;
const cloudDuringAd = createPlatformBridge({ BusFeverNative: {
  loadCloudSave: async () => null, syncCloudSave: async () => ({ queued: true }),
  getCloudSaveStatus: async () => ({ state: 'ready' }),
  manageCloudSave: async () => { blockedCloudCalls++; return { changed: false }; },
  configureAds: async () => ({ canRequestAds: true }),
  showInterstitialAd: async () => ({ shown: false }),
  showRewardedAd: async () => new Promise(resolve => { endCloudTestAd = resolve; })
} });
await cloudDuringAd.configureAds();
const cloudTestAd = cloudDuringAd.showRewardedAd('reward_boost');
assert.equal((await cloudDuringAd.manageCloudSave()).changed, false);
assert.equal(blockedCloudCalls, 0);
endCloudTestAd({ completed: false });
await cloudTestAd;
assert.equal(cloudDuringAd.fullscreenBusy, false);

let purchaseResponse = { success: true, productId, transactionId: '101' };
let verifiedResponse = { verified: true, productId, transactionId: '101' };
let allowAds = false;
let adResult = { completed: true };
const native = {
  purchaseProduct: async () => purchaseResponse,
  verifyTransaction: async () => verifiedResponse,
  saveSave: async () => ({ persisted: true }),
  finishTransaction: async () => ({ finished: true }),
  getPendingTransactions: async () => [purchaseResponse],
  commitPurchase: async () => ({ persisted: false }),
  getEntitlements: async () => ({ verified: false }),
  configureAds: async () => ({ canRequestAds: allowAds }),
  showRewardedAd: async () => adResult,
  showInterstitialAd: async () => ({}),
  restorePurchases: async options => { assert.equal(options.userInitiated, true); return { success: true, productIds: [] }; },
  verifyProductOwnership: async () => true
};
const bridge = createPlatformBridge({ BusFeverNative: native });
assert.equal((await bridge.purchaseProduct(productId)).success, true);
assert.equal((await bridge.getPendingTransactions()).length, 1);
verifiedResponse = { ...verifiedResponse, transactionId: 'other' };
assert.equal((await bridge.purchaseProduct(productId)).success, false);
verifiedResponse.transactionId = '101';
purchaseResponse = { productId, transactionId: '101' };
assert.equal((await bridge.purchaseProduct(productId)).success, false);
purchaseResponse = { success: false, status: 'pending' };
assert.equal((await bridge.purchaseProduct(productId)).success, false);
assert.equal((await bridge.verifyProductOwnership(PRODUCT_IDS.removeAds)).verified, false);
await bridge.restorePurchases({ userInitiated: true });
assert.equal((await bridge.showRewardedAd('revive')).completed, false);
await bridge.configureAds();
assert.equal((await bridge.showRewardedAd('revive')).completed, false);
allowAds = true;
await bridge.configureAds();
assert.equal((await bridge.showRewardedAd('revive')).completed, true);
adResult = true;
assert.equal((await bridge.showRewardedAd('revive')).completed, false);
assert.equal((await bridge.showInterstitialAd('stage_clear')).shown, false);
assert.equal((await bridge.showInterstitialAd('session_start')).shown, false);

// Privacy changes invalidate web ad readiness immediately and serialize fullscreen operations.
let finishAd;
let finishPrivacy;
let nativeRewards = 0;
let nativePrivacy = 0;
let privacyResult = { presented: true, canRequestAds: false, reason: 'choices_updated' };
const privacy = createPlatformBridge({ BusFeverNative: {
  initialize: async () => ({ capabilities: { nativeAds: true, privacyOptions: true, att: true } }),
  getTrackingAuthorizationStatus: async () => 'denied',
  requestTrackingAuthorization: async () => ({ status: 'denied', prompted: false }),
  configureAds: async () => ({ canRequestAds: true }),
  getPrivacyOptionsStatus: async () => ({ requirement: 'required' }),
  showPrivacyOptions: async () => { nativePrivacy++; return await new Promise(resolve => { finishPrivacy = () => resolve(privacyResult); }); },
  showRewardedAd: async () => { nativeRewards++; return await new Promise(resolve => { finishAd = resolve; }); },
  showInterstitialAd: async () => ({ shown: true })
} });
await privacy.initialize();
assert.equal((await privacy.getPrivacyOptionsStatus()).requirement, 'required');
assert.equal(await privacy.configureAds(), true, 'ATT denied must not veto UMP-permitted ads');
const pendingAd = privacy.showRewardedAd('revive');
assert.equal(privacy.fullscreenBusy, true);
assert.equal((await privacy.showPrivacyOptions()).presented, false);
assert.equal(nativePrivacy, 0);
assert.equal((await privacy.showRewardedAd('reward_boost')).completed, false);
finishAd({ completed: false });
assert.equal((await pendingAd).completed, false);
assert.equal(privacy.fullscreenBusy, false);
const pendingPrivacy = privacy.showPrivacyOptions();
assert.equal((await privacy.showRewardedAd('revive')).completed, false);
assert.equal((await privacy.showInterstitialAd('stage_clear')).shown, false);
finishPrivacy();
assert.equal((await pendingPrivacy).presented, true);
assert.equal((await privacy.showRewardedAd('revive')).completed, false, 'Revoked/stale creatives must stay disabled until reconfigured');
assert.equal(nativeRewards, 1);
assert.equal(privacy.fullscreenBusy, false);
await privacy.configureAds();
const earnedAd = privacy.showRewardedAd('reward_boost');
finishAd({ completed: true });
assert.equal((await earnedAd).completed, true);
privacyResult = true;
const malformedPrivacy = privacy.showPrivacyOptions();
finishPrivacy();
assert.equal((await malformedPrivacy).presented, false);
assert.equal((await privacy.showRewardedAd('revive')).completed, false);

const state = { ...createDefaultMetaState(), shufflesLeft: 2, vipLeft: 1 };
const transaction = { success: true, productId, transactionId: '200' };
let savedSnapshot;
let persistSucceeds = false;
let finishedCount = 0;
let commitSucceeds = true;
let commitCount = 0;
const nativeDelivery = {
  capabilities: { nativePurchaseDelivery: true },
  commitPurchase: async () => {
    commitCount++;
    if (!commitSucceeds) return { persisted: false };
    const duplicate = Boolean(savedSnapshot);
    savedSnapshot ??= { schemaVersion: 3, nativePurchaseRevision: 1, shufflesLeft: 2, vipLeft: 1,
      meta: { ...createDefaultMetaState(), coins: 1320, deliveredTransactions: { '200': productId } } };
    return { persisted: true, snapshot: structuredClone(savedSnapshot), duplicate };
  },
  finishTransaction: async () => { assert.ok(savedSnapshot); finishedCount++; return true; }
};
const deliver = createPurchaseDelivery(state, nativeDelivery, async () => {
  return { persisted: persistSucceeds };
});
await assert.rejects(deliver(transaction), /purchase_save_failed/);
assert.equal(finishedCount, 0);
assert.equal(commitCount, 0);
assert.equal(state.coins, 120, 'Web must not grant before a durable native commit');
persistSucceeds = true;
commitSucceeds = false;
await assert.rejects(deliver(transaction), /purchase_commit_failed/);
assert.equal(state.coins, 120);
assert.equal(finishedCount, 0);
commitSucceeds = true;
await Promise.all([deliver(transaction), deliver(transaction)]);
assert.equal(state.coins, 1320);
assert.equal(savedSnapshot.meta.deliveredTransactions['200'], productId);
const relaunched = { shufflesLeft: 2, vipLeft: 1 };
hydrateMetaState(relaunched, savedSnapshot);
await createPurchaseDelivery(relaunched, nativeDelivery, async () => ({ persisted: true }))(transaction);
assert.equal(relaunched.coins, 1320);
await assert.rejects(deliver({ ...transaction, productId: PRODUCT_IDS.coinPackMedium }), /transaction_product_mismatch/);
await assert.rejects(createPurchaseDelivery(state, {}, async () => ({ persisted: true }))(transaction), /native_purchase_delivery_required/);
const liveRound = { stage: 8, roundId: 22, passengerQueue: ['red'] };
applyNativePurchaseSnapshot(liveRound, { ...savedSnapshot, stage: 1, round: null });
assert.equal(liveRound.stage, 8);
assert.equal(liveRound.roundId, 22);
assert.deepEqual(liveRound.passengerQueue, ['red']);
assert.throws(() => applyNativePurchaseSnapshot(liveRound, { ...savedSnapshot, nativePurchaseRevision: -1 }), /invalid_native/);
const revoked = structuredClone(savedSnapshot);
revoked.meta.hasNoAds = false;
revoked.meta.hasDoubleRewards = false;
revoked.meta.starterBundleOwned = false;
Object.assign(liveRound, { hasNoAds: true, hasDoubleRewards: true, starterBundleOwned: true });
applyNativePurchaseSnapshot(liveRound, revoked);
assert.equal(liveRound.hasNoAds, false);
assert.equal(liveRound.hasDoubleRewards, false);
assert.equal(liveRound.starterBundleOwned, false);

// Serialized native commit recovers a lost reply; JS cannot finish from its own ledger alone.
const order = [];
let commitReplies = 0;
const atomic = createPlatformBridge({ localStorage: storage(), BusFeverNative: {
  saveSave: async () => { order.push('save'); return { persisted: true }; },
  commitPurchase: async () => {
    order.push('commit');
    if (++commitReplies === 1) throw new Error('reply_lost_after_native_write');
    return { persisted: true, productId, transactionId: '200', duplicate: true, snapshot: structuredClone(savedSnapshot) };
  },
  getEntitlements: async () => ({ verified: true, productIds: [], snapshot: structuredClone(revoked) })
} });
const checkpoint = atomic.saveGame({ schemaVersion: 3 });
const committed = atomic.commitPurchase(productId, '200');
await checkpoint;
assert.equal((await committed).persisted, true);
assert.deepEqual(order, ['save', 'commit', 'commit']);
assert.equal(atomic.purchaseRevision, 1);
assert.equal((await atomic.getEntitlements()).verified, true);

const nativeCatalog = await readFile(path.join(root, 'ios/Sources/PurchaseCatalog.swift'), 'utf8');
const definitions = [...nativeCatalog.matchAll(/"(com\.busfever\.[\w.]+)": \.init\(kind: \.(\w+), coins: (\d+), shuffles: (\d+), vip: (\d+)\)/g)];
assert.equal(definitions.length, PRODUCT_CATALOG.length);
for (const [, id, kind, coins, shuffles, vip] of definitions) {
  assert.equal(PRODUCT_CATALOG.find(p => p.id === id)?.type, kind === 'consumable' ? 'consumable' : 'non_consumable');
  assert.deepEqual([Number(coins), Number(shuffles), Number(vip)], ['coins', 'shuffles', 'vip'].map(key => IAP_GRANTS[id][key] || 0));
}

const old = { schemaVersion: 3, updatedAt: 100, stage: 5, score: 900, meta: { coins: 1000 } };
const recent = { ...old, updatedAt: 200, stage: 4, score: 100, meta: { coins: 20 } };
const preferred = selectPreferredSave(recent, old);
assert.equal(preferred.meta.coins, 20);
assert.equal(preferred.stage, 5);
assert.equal(preferred.score, 900);
assert.equal(preferred.__source, 'local');
assert.equal(selectPreferredSave(null, { ...old, schemaVersion: 99 }), null);
assert.equal(selectPreferredSave(old, { ...recent, updatedAt: NaN }).meta.coins, 1000);

// Future schemas must remain untouched in every storage location, even with an older valid alternative.
for (const location of ['local', 'native', 'cloud']) {
  const future = { ...old, schemaVersion: 99 };
  const localStorage = storage();
  localStorage.setItem('bus_fever_save_v2', JSON.stringify(location === 'local' ? future : old));
  let nativeWrites = 0;
  let cloudWrites = 0;
  const platform = createPlatformBridge({ localStorage, BusFeverNative: {
    loadSave: async () => location === 'native' ? future : old,
    loadCloudSave: async () => location === 'cloud' ? future : null,
    saveSave: async () => { nativeWrites++; return { persisted: true }; },
    syncCloudSave: async () => { cloudWrites++; return { queued: true }; }
  } });
  await platform.loadGame();
  await platform.loadCloudSave();
  const before = localStorage.getItem('bus_fever_save_v2');
  assert.equal(platform.saveWriteBlocked, true);
  assert.equal((await platform.saveGame(recent)).reason, 'future_schema');
  assert.equal((await platform.syncCloudSave(recent)).queued, false);
  assert.equal(localStorage.getItem('bus_fever_save_v2'), before);
  assert.equal(nativeWrites + cloudWrites, 0);
}
const immediateStorage = storage();
const immediateBridge = createPlatformBridge({ localStorage: immediateStorage });
const checkpointWrite = immediateBridge.saveGame(recent);
assert.equal(JSON.parse(immediateStorage.getItem('bus_fever_save_v2')).stage, recent.stage);
assert.equal((await checkpointWrite).persisted, true);
// A newer application may write after this tab was opened.
immediateStorage.setItem('bus_fever_save_v2', JSON.stringify({ ...old, schemaVersion: 99 }));
assert.equal((await immediateBridge.saveGame(recent)).reason, 'future_schema');

const html = await readFile(path.join(root, 'web-prototype/index.html'), 'utf8');
for (const [, source] of html.matchAll(/<script\s+type="module"[^>]*>([\s\S]*?)<\/script>/g)) {
  const syntax = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: source, encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  for (const [, names, relative] of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const exports = await import(pathToFileURL(path.resolve(root, 'web-prototype', relative)));
    for (const name of names.split(',').map(n => n.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      assert.ok(name in exports, `Missing export ${name} from ${relative}`);
    }
  }
}
const bootstrap = await readFile(path.join(root, 'ios/bridge-bootstrap.js'), 'utf8');
const requests = [];
const context = { window: { webkit: { messageHandlers: { busFeverNative: {
  postMessage: async request => { requests.push(request); return { success: false }; }
} } } } };
vm.runInNewContext(bootstrap, context);
await context.window.BusFeverNative.purchaseProduct(productId);
assert.equal(requests[0].productId, productId);
assert.equal(requests[0].action, 'purchaseProduct');
console.log('Platform validation passed: fail-closed bridge, transaction replay/recovery, save policy, module imports, bootstrap.');
