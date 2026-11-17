import { PRODUCT_CATALOG, RESTORABLE_PRODUCT_IDS } from './economy-config.js';
import { isFutureSave } from './save-policy.js';
import { isNativePurchaseSnapshot } from './purchase-state.js';

const SAVE_KEY = 'bus_fever_save_v2';
const statuses = new Set(['authorized', 'denied', 'restricted', 'not_determined']);

export function createPlatformBridge(windowObject) {
  const nativeBridge = windowObject.BusFeverNative ?? null;
  const has = name => typeof nativeBridge?.[name] === 'function';
  const status = value => statuses.has(value) ? value : 'not_determined';
  let storage;
  try { storage = windowObject.localStorage; } catch { storage = null; }
  const readLocal = () => {
    try { return JSON.parse(storage?.getItem(SAVE_KEY) || 'null'); } catch { return null; }
  };
  let adsReady = false;
  let futureSaveDetected = false;
  const inspectSave = save => { if (isFutureSave(save)) futureSaveDetected = true; return save; };
  let adBusy = false;
  let purchaseBusy = false;
  let purchaseRevision = 0;
  let saveQueue = Promise.resolve();
  let cloudQueue = Promise.resolve();
  const capabilities = {
    nativeAds: has('configureAds') && has('showRewardedAd') && has('showInterstitialAd'),
    privacyOptions: has('getPrivacyOptionsStatus') && has('showPrivacyOptions'),
    nativeIap: ['purchaseProduct', 'verifyTransaction', 'saveSave', 'finishTransaction', 'getPendingTransactions', 'commitPurchase', 'getEntitlements'].every(has),
    nativePurchaseDelivery: has('commitPurchase') && has('getEntitlements'),
    restorePurchases: has('restorePurchases') && has('verifyProductOwnership') && has('getEntitlements'),
    att: has('getTrackingAuthorizationStatus') && has('requestTrackingAuthorization'),
    cloudSave: has('loadCloudSave') && has('syncCloudSave'),
    nativeCloudSave: has('getCloudSaveStatus') && has('manageCloudSave'),
    localReceiptValidation: has('verifyTransaction')
  };
  const adoptNativeSnapshot = snapshot => {
    if (!isNativePurchaseSnapshot(snapshot) || snapshot.nativePurchaseRevision < purchaseRevision) throw new Error('invalid_native_purchase_snapshot');
    purchaseRevision = snapshot.nativePurchaseRevision;
    try { storage?.setItem(SAVE_KEY, JSON.stringify(snapshot)); } catch { /* Native disk is authoritative. */ }
    return snapshot;
  };
  async function validateTransaction(result, productId) {
    if (result?.success !== true || result.productId !== productId ||
        typeof result.transactionId !== 'string' || !result.transactionId) {
      return { success: false, productId, status: result?.status || 'invalid_transaction' };
    }
    const verified = await nativeBridge.verifyTransaction(productId, result.transactionId);
    if (verified?.verified !== true || verified.productId !== productId || verified.transactionId !== result.transactionId) {
      return { success: false, productId, status: 'unverified' };
    }
    return { success: true, productId, transactionId: result.transactionId };
  }
  return {
    nativeBridge, capabilities, productCache: [],
    async initialize() {
      if (has('initialize')) {
        try {
          const initialized = await nativeBridge.initialize();
          if (initialized?.capabilities && typeof initialized.capabilities === 'object') {
            for (const key of Object.keys(capabilities)) capabilities[key] = capabilities[key] && initialized.capabilities[key] === true;
          }
        }
        catch {
          this.initializationFailed = true;
          for (const key of Object.keys(capabilities)) capabilities[key] = false;
          return capabilities;
        }
      }
      capabilities.nativeIap &&= capabilities.nativePurchaseDelivery;
      capabilities.restorePurchases &&= capabilities.nativePurchaseDelivery;
      capabilities.nativeCloudSave &&= capabilities.cloudSave;
      return capabilities;
    },
    async refreshProducts() {
      if (this.initializationFailed || !capabilities.nativeIap || !has('getProducts')) return [];
      try {
        const products = await nativeBridge.getProducts();
        this.productCache = (Array.isArray(products) ? products : []).filter(product =>
          PRODUCT_CATALOG.some(p => p.id === product?.id) && typeof product.localizedPrice === 'string' && product.localizedPrice.length > 0);
      } catch { this.productCache = []; }
      return this.productCache;
    },
    async loadGame() {
      const local = inspectSave(readLocal());
      if (has('loadSave')) {
        try {
          const saved = await nativeBridge.loadSave(SAVE_KEY);
          if (saved && typeof saved === 'object') {
            purchaseRevision = Number.isSafeInteger(saved.nativePurchaseRevision) ? saved.nativePurchaseRevision : 0;
            return inspectSave(saved);
          }
        } catch { return local; }
      }
      return local;
    },
    async saveGame(data) {
      inspectSave(readLocal());
      if (futureSaveDetected) return { persisted: false, reason: 'future_schema' };
      const snapshot = JSON.parse(JSON.stringify(data));
      // Write synchronously before yielding so pagehide does not lose the last move.
      let localPersisted = false;
      try { storage?.setItem(SAVE_KEY, JSON.stringify(snapshot)); localPersisted = Boolean(storage); }
      catch { localPersisted = false; }
      const task = async () => {
        if (futureSaveDetected) return { persisted: false, reason: 'future_schema' };
        if (has('saveSave')) {
          try { return { persisted: (await nativeBridge.saveSave(SAVE_KEY, snapshot))?.persisted === true }; }
          catch { return { persisted: false }; }
        }
        return { persisted: !nativeBridge && localPersisted };
      };
      saveQueue = saveQueue.then(task, task);
      return saveQueue;
    },
    async loadCloudSave() {
      // Native cloud snapshots include private purchase history and use causal selection.
      // They must never enter the legacy web timestamp merger.
      if (capabilities.nativeCloudSave) return null;
      if (!capabilities.cloudSave || !has('loadCloudSave')) return null;
      try { return inspectSave(await nativeBridge.loadCloudSave(SAVE_KEY)); } catch { return null; }
    },
    async syncCloudSave(data) {
      if (futureSaveDetected) return { queued: false, reason: 'future_schema' };
      if (!capabilities.cloudSave || !has('syncCloudSave')) return { queued: false, source: 'unavailable' };
      const snapshot = JSON.parse(JSON.stringify(data));
      const task = async () => {
        if (futureSaveDetected) return { queued: false, reason: 'future_schema' };
        try { return { queued: (await nativeBridge.syncCloudSave(SAVE_KEY, snapshot))?.queued === true, source: 'native' }; }
        catch (error) { return { queued: false, source: 'native', error }; }
      };
      cloudQueue = cloudQueue.then(task, task);
      return cloudQueue;
    },
    async getCloudSaveStatus() {
      if (this.initializationFailed || !capabilities.nativeCloudSave) return { state: 'unavailable', connected: false };
      try {
        const result = await nativeBridge.getCloudSaveStatus();
        const allowed = ['unavailable', 'signed_out', 'account_changed', 'ready', 'download_available', 'conflict', 'queued', 'quota', 'invalid_data'];
        return { state: allowed.includes(result?.state) ? result.state : 'invalid_data', connected: result?.connected === true };
      } catch { return { state: 'unavailable', connected: false }; }
    },
    async manageCloudSave() {
      if (this.initializationFailed || futureSaveDetected || !capabilities.nativeCloudSave || purchaseBusy || adBusy) return { changed: false, reason: 'unavailable' };
      purchaseBusy = true;
      try {
        const result = await nativeBridge.manageCloudSave();
        return { changed: result?.changed === true, requiresReload: result?.requiresReload === true,
          reason: typeof result?.reason === 'string' ? result.reason : 'unknown' };
      } catch { return { changed: false, reason: 'failed' }; }
      finally { purchaseBusy = false; }
    },
    async purchaseProduct(productId) {
      if (this.initializationFailed || !capabilities.nativeIap || !PRODUCT_CATALOG.some(p => p.id === productId)) return { success: false, status: 'unavailable' };
      if (purchaseBusy) return { success: false, status: 'busy' };
      purchaseBusy = true;
      try { return await validateTransaction(await nativeBridge.purchaseProduct(productId), productId); }
      catch (error) { return { success: false, error }; }
      finally { purchaseBusy = false; }
    },
    async getPendingTransactions() {
      if (!capabilities.nativeIap) return [];
      try {
        const results = await nativeBridge.getPendingTransactions();
        const transactions = [];
        for (const result of Array.isArray(results) ? results : []) {
          if (!PRODUCT_CATALOG.some(p => p.id === result?.productId)) continue;
          const transaction = await validateTransaction(result, result.productId);
          if (transaction.success) transactions.push(transaction);
        }
        return transactions;
      } catch { return []; }
    },
    async finishTransaction(transactionId) {
      if (!capabilities.nativeIap || !has('finishTransaction')) return false;
      try { return (await nativeBridge.finishTransaction(transactionId))?.finished === true; }
      catch { return false; }
    },
    async commitPurchase(productId, transactionId) {
      if (this.initializationFailed || futureSaveDetected || !capabilities.nativePurchaseDelivery ||
          !PRODUCT_CATALOG.some(p => p.id === productId) || typeof transactionId !== 'string' || !/^\d+$/.test(transactionId)) return { persisted: false };
      const task = async () => {
        if (futureSaveDetected) return { persisted: false };
        try {
          let result;
          try { result = await nativeBridge.commitPurchase(productId, transactionId); }
          catch { result = await nativeBridge.commitPurchase(productId, transactionId); } // Idempotent recovery after a lost reply.
          if (result?.persisted !== true || result.productId !== productId || result.transactionId !== transactionId ||
              !isNativePurchaseSnapshot(result.snapshot) || result.snapshot.meta.deliveredTransactions[transactionId] !== productId) return { persisted: false };
          return { persisted: true, duplicate: result.duplicate === true, snapshot: adoptNativeSnapshot(result.snapshot) };
        } catch { return { persisted: false }; }
      };
      saveQueue = saveQueue.then(task, task);
      return saveQueue;
    },
    async getEntitlements() {
      if (this.initializationFailed || futureSaveDetected || !capabilities.nativePurchaseDelivery) return { verified: false };
      const task = async () => {
        if (futureSaveDetected) return { verified: false };
        try {
          const result = await nativeBridge.getEntitlements();
          if (result?.verified !== true || !Array.isArray(result.productIds) ||
              result.productIds.some(id => !RESTORABLE_PRODUCT_IDS.includes(id)) || !isNativePurchaseSnapshot(result.snapshot)) return { verified: false };
          return { verified: true, productIds: result.productIds, snapshot: adoptNativeSnapshot(result.snapshot) };
        } catch { return { verified: false }; }
      };
      saveQueue = saveQueue.then(task, task);
      return saveQueue;
    },
    async verifyProductOwnership(productId) {
      if (!capabilities.restorePurchases || !has('verifyProductOwnership') || !RESTORABLE_PRODUCT_IDS.includes(productId)) return { verified: false };
      try {
        const result = await nativeBridge.verifyProductOwnership(productId);
        return { verified: result?.verified === true && result.productId === productId &&
          typeof result.transactionId === 'string' && result.transactionId.length > 0, source: 'native' };
      } catch { return { verified: false, source: 'native' }; }
    },
    async restorePurchases({ userInitiated = false } = {}) {
      this.lastRestoreSucceeded = false;
      if (!capabilities.restorePurchases) return [];
      try {
        const results = await nativeBridge.restorePurchases({ userInitiated });
        this.lastRestoreSucceeded = results?.success === true && Array.isArray(results.productIds);
        return this.lastRestoreSucceeded ? results.productIds.filter(id => RESTORABLE_PRODUCT_IDS.includes(id)) : [];
      } catch { return []; }
    },
    async getTrackingAuthorizationStatus() {
      if (!has('getTrackingAuthorizationStatus')) return 'not_determined';
      try { return status(await nativeBridge.getTrackingAuthorizationStatus()); }
      catch { return 'not_determined'; }
    },
    async requestTrackingAuthorization() {
      if (!capabilities.att) return { status: await this.getTrackingAuthorizationStatus(), promptCount: 0, source: 'unavailable' };
      if (!has('requestTrackingAuthorization')) return { status: 'not_determined', promptCount: 0, source: 'unavailable' };
      try {
        const result = await nativeBridge.requestTrackingAuthorization();
        return { status: status(result?.status), promptCount: result?.prompted === true ? 1 : 0, source: 'native' };
      } catch { return { status: 'not_determined', promptCount: 0, source: 'native' }; }
    },
    async configureAds() {
      adsReady = false;
      this.lastAdsConfiguration = null;
      if (this.initializationFailed || !capabilities.nativeAds || !has('configureAds')) return false;
      try {
        this.lastAdsConfiguration = await nativeBridge.configureAds();
        adsReady = this.lastAdsConfiguration?.canRequestAds === true;
      }
      catch { adsReady = false; }
      return adsReady;
    },
    async getPrivacyOptionsStatus() {
      if (!capabilities.privacyOptions) return { requirement: 'unavailable' };
      try {
        const result = await nativeBridge.getPrivacyOptionsStatus();
        const requirement = ['required', 'not_required', 'unknown'].includes(result?.requirement) ? result.requirement : 'unknown';
        return { requirement };
      } catch { return { requirement: 'unknown' }; }
    },
    async showPrivacyOptions() {
      if (this.initializationFailed || !capabilities.privacyOptions || adBusy || purchaseBusy) return { presented: false, reason: 'unavailable_or_busy' };
      adBusy = true;
      adsReady = false;
      try {
        const result = await nativeBridge.showPrivacyOptions();
        adsReady = capabilities.nativeAds && result?.canRequestAds === true;
        return { presented: result?.presented === true, reason: result?.reason || 'unavailable' };
      } catch { return { presented: false, reason: 'unavailable' }; }
      finally { adBusy = false; }
    },
    async showRewardedAd(placement) {
      if (!adsReady || !has('showRewardedAd') || adBusy || purchaseBusy || !['revive', 'reward_boost'].includes(placement)) return { completed: false };
      adBusy = true;
      try { return { completed: (await nativeBridge.showRewardedAd(placement))?.completed === true }; }
      catch { return { completed: false }; }
      finally { adBusy = false; }
    },
    async showInterstitialAd(placement) {
      if (!adsReady || !has('showInterstitialAd') || adBusy || purchaseBusy || placement !== 'stage_clear') return { shown: false };
      adBusy = true;
      try { return { shown: (await nativeBridge.showInterstitialAd(placement))?.shown === true }; }
      catch { return { shown: false }; }
      finally { adBusy = false; }
    },
    async logEvent(name, payload = {}) {
      if (!has('logEvent')) return;
      try { await nativeBridge.logEvent(name, payload); } catch { return; }
    },
    getProducts() { return this.productCache; },
    get saveWriteBlocked() { return futureSaveDetected; },
    get fullscreenBusy() { return adBusy || purchaseBusy; },
    get purchaseRevision() { return purchaseRevision; }
  };
}
