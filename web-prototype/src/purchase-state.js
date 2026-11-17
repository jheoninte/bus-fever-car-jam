import { PRODUCT_CATALOG, SAVE_SCHEMA_VERSION } from './economy-config.js';

export function isNativePurchaseSnapshot(snapshot) {
  const meta = snapshot?.meta;
  return snapshot?.schemaVersion === SAVE_SCHEMA_VERSION && meta &&
    ['coins'].every(key => Number.isSafeInteger(meta[key]) && meta[key] >= 0) &&
    ['shufflesLeft', 'vipLeft', 'nativePurchaseRevision'].every(key => Number.isSafeInteger(snapshot[key]) && snapshot[key] >= 0) &&
    ['hasNoAds', 'hasDoubleRewards', 'starterBundleOwned'].every(key => typeof meta[key] === 'boolean') &&
    meta.deliveredTransactions && typeof meta.deliveredTransactions === 'object' && !Array.isArray(meta.deliveredTransactions) &&
    Object.entries(meta.deliveredTransactions).every(([id, productId]) => /^\d+$/.test(id) && PRODUCT_CATALOG.some(p => p.id === productId));
}

// Native purchase snapshots update only commerce state; they cannot rewind a live round.
export function applyNativePurchaseSnapshot(state, snapshot) {
  if (!isNativePurchaseSnapshot(snapshot)) throw new Error('invalid_native_purchase_snapshot');
  state.coins = snapshot.meta.coins;
  state.shufflesLeft = snapshot.shufflesLeft;
  state.vipLeft = snapshot.vipLeft;
  for (const key of ['hasNoAds', 'hasDoubleRewards', 'starterBundleOwned']) state[key] = snapshot.meta[key];
  state.deliveredTransactions = { ...snapshot.meta.deliveredTransactions };
}
