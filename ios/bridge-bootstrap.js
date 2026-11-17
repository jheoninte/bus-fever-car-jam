(() => {
  const handler = window.webkit?.messageHandlers?.busFeverNative;
  if (!handler || window.BusFeverNative) return;
  const methods = {
    initialize: [], loadSave: ['key'], saveSave: ['key', 'data'],
    loadCloudSave: ['key'], syncCloudSave: ['key', 'data'],
    getCloudSaveStatus: [], manageCloudSave: [],
    getTrackingAuthorizationStatus: [], requestTrackingAuthorization: [],
    configureAds: [], getPrivacyOptionsStatus: [], showPrivacyOptions: [],
    getProducts: [], purchaseProduct: ['productId'],
    verifyTransaction: ['productId', 'transactionId'],
    commitPurchase: ['productId', 'transactionId'], getEntitlements: [],
    verifyProductOwnership: ['productId'], restorePurchases: ['options'],
    getPendingTransactions: [], finishTransaction: ['transactionId'],
    showRewardedAd: ['placement'], showInterstitialAd: ['placement'],
    logEvent: ['name', 'payload']
  };
  window.BusFeverNative = Object.freeze(Object.fromEntries(Object.entries(methods).map(([action, keys]) => [
    action, async (...values) => {
      const result = handler.postMessage({ action, ...Object.fromEntries(keys.map((key, index) => [key, values[index] ?? null])) });
      if (!result || typeof result.then !== 'function') throw new Error('reply_handler_required');
      return await result;
    }
  ])));
})();
