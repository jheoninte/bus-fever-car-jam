import {
  IAP_GRANTS,
  PRODUCT_CATALOG,
  PRODUCT_IDS,
  RESTORABLE_PRODUCT_IDS,
  REWARD_CONFIG,
  SHOP_ITEM_GRANTS,
  SOFT_SHOP_CATALOG,
  TRACKING_AUTH_STATUS
} from './economy-config.js';
import { createReviveQueue } from './rules.js';

export { PRODUCT_CATALOG, SOFT_SHOP_CATALOG, TRACKING_AUTH_STATUS };

export function createDefaultMetaState() {
  return {
    coins: 120,
    hasNoAds: false,
    hasDoubleRewards: false,
    starterBundleOwned: false,
    totalClears: 0,
    lastClearedStage: 0,
    colorBlind: false,
    interstitialCounter: 0,
    sessionCount: 0,
    trackingAuthorizationStatus: TRACKING_AUTH_STATUS.notDetermined,
    attPromptCount: 0,
    lastCloudSyncAt: 0,
    lastReceiptVerificationAt: 0,
    deliveredTransactions: {}
  };
}

export function hydrateMetaState(state, saved = {}) {
  const meta = saved.meta && typeof saved.meta === 'object' ? saved.meta : saved;
  const defaults = createDefaultMetaState();
  state.coins = meta.coins ?? defaults.coins;
  state.hasNoAds = meta.hasNoAds ?? defaults.hasNoAds;
  state.hasDoubleRewards = meta.hasDoubleRewards ?? defaults.hasDoubleRewards;
  state.starterBundleOwned = meta.starterBundleOwned ?? defaults.starterBundleOwned;
  state.totalClears = meta.totalClears ?? defaults.totalClears;
  state.lastClearedStage = meta.lastClearedStage ?? defaults.lastClearedStage;
  state.colorBlind = meta.colorBlind === true;
  state.interstitialCounter = meta.interstitialCounter ?? defaults.interstitialCounter;
  state.sessionCount = meta.sessionCount ?? defaults.sessionCount;
  state.trackingAuthorizationStatus = meta.trackingAuthorizationStatus ?? defaults.trackingAuthorizationStatus;
  state.attPromptCount = meta.attPromptCount ?? defaults.attPromptCount;
  state.lastCloudSyncAt = meta.lastCloudSyncAt ?? defaults.lastCloudSyncAt;
  state.lastReceiptVerificationAt = meta.lastReceiptVerificationAt ?? defaults.lastReceiptVerificationAt;
  state.deliveredTransactions = meta.deliveredTransactions && typeof meta.deliveredTransactions === 'object' && !Array.isArray(meta.deliveredTransactions)
    ? Object.fromEntries(Object.entries(meta.deliveredTransactions).filter(([id, productId]) => id && PRODUCT_CATALOG.some(p => p.id === productId)))
    : {};
}

export function exportMetaState(state) {
  return {
    coins: state.coins,
    hasNoAds: state.hasNoAds,
    hasDoubleRewards: state.hasDoubleRewards,
    starterBundleOwned: state.starterBundleOwned,
    totalClears: state.totalClears,
    lastClearedStage: state.lastClearedStage,
    colorBlind: state.colorBlind,
    interstitialCounter: state.interstitialCounter,
    sessionCount: state.sessionCount,
    trackingAuthorizationStatus: state.trackingAuthorizationStatus,
    attPromptCount: state.attPromptCount,
    lastCloudSyncAt: state.lastCloudSyncAt,
    lastReceiptVerificationAt: state.lastReceiptVerificationAt,
    deliveredTransactions: { ...state.deliveredTransactions }
  };
}

export function getCatalogWithState(state, nativeProducts = []) {
  return PRODUCT_CATALOG.map(product => {
    const nativeProduct = nativeProducts.find(item => item.id === product.id || item.productId === product.id) || null;
    const owned = product.id === PRODUCT_IDS.removeAds
      ? state.hasNoAds
      : product.id === PRODUCT_IDS.starterBundle
        ? state.starterBundleOwned
        : false;

    return {
      ...product,
      owned,
      available: Boolean(nativeProduct?.localizedPrice),
      priceLabel: nativeProduct?.localizedPrice || nativeProduct?.price || product.priceLabel
    };
  });
}

export function applyPurchaseGrant(state, productId) {
  const grant = IAP_GRANTS[productId];
  if (!grant) {
    return '구매가 적용되었습니다.';
  }

  if (grant.noAds) {
    state.hasNoAds = true;
  }

  if (grant.doubleRewards) {
    state.hasDoubleRewards = true;
  }

  if (grant.starterBundleOwned && !state.starterBundleOwned) {
    state.starterBundleOwned = true;
    state.coins += grant.coins ?? 0;
    state.shufflesLeft += grant.shuffles ?? 0;
    state.vipLeft += grant.vip ?? 0;
    return '스타터 번들 보상이 적용되었습니다.';
  }

  if (!grant.starterBundleOwned) {
    state.coins += grant.coins ?? 0;
    state.shufflesLeft += grant.shuffles ?? 0;
    state.vipLeft += grant.vip ?? 0;
  }

  if (productId === PRODUCT_IDS.removeAds) return '전면 광고가 제거되었습니다.';
  if (productId === PRODUCT_IDS.coinPackSmall) return '코인 1200개를 획득했습니다.';
  if (productId === PRODUCT_IDS.coinPackMedium) return '코인 3500개를 획득했습니다.';
  return '구매가 적용되었습니다.';
}

export const applyProductGrant = applyPurchaseGrant;

export function purchaseSoftItem(state, itemId) {
  const item = SOFT_SHOP_CATALOG.find(entry => entry.id === itemId);
  if (!item) {
    return { ok: false, message: '알 수 없는 상품입니다.' };
  }

  if (state.coins < item.cost) {
    return { ok: false, message: '코인이 부족합니다.' };
  }

  state.coins -= item.cost;
  const grant = SHOP_ITEM_GRANTS[itemId] || {};
  state.shufflesLeft += grant.shuffles ?? 0;
  state.vipLeft += grant.vip ?? 0;

  return { ok: true, message: `${item.title} 구매 완료!` };
}

export function grantStageClearReward(state, clearedStage) {
  const baseCoins = REWARD_CONFIG.stageClearBaseCoins + clearedStage * REWARD_CONFIG.stageClearStageStep;
  const coinsAwarded = state.hasDoubleRewards ? baseCoins * 2 : baseCoins;
  state.coins += coinsAwarded;
  state.totalClears += 1;
  state.interstitialCounter += 1;

  return {
    coinsAwarded,
    shouldShowInterstitial: !state.hasNoAds && state.interstitialCounter % REWARD_CONFIG.interstitialEveryClears === 0
  };
}

export function registerSessionStart(state) {
  state.sessionCount = (state.sessionCount ?? 0) + 1;
  return { sessionCount: state.sessionCount };
}

export function canOfferRewardedRevive(state) {
  return Boolean(state.isOver && !state.isClear && !state.reviveUsed && createReviveQueue(state));
}

export function applyRewardedRevive(state) {
  if (!canOfferRewardedRevive(state)) return null;
  state.passengerQueue = createReviveQueue(state);
  state.isOver = false;
  state.reviveUsed = true;
  state.shufflesLeft += REWARD_CONFIG.rewardedReviveShuffle;
  state.vipLeft += REWARD_CONFIG.rewardedReviveVip;
  return {
    shufflesGranted: REWARD_CONFIG.rewardedReviveShuffle,
    vipGranted: REWARD_CONFIG.rewardedReviveVip
  };
}

export function applyRewardedBoost(state) {
  state.shufflesLeft += REWARD_CONFIG.rewardedBoostShuffle;
  state.vipLeft += REWARD_CONFIG.rewardedBoostVip;
  const bonusCoins = state.hasDoubleRewards ? REWARD_CONFIG.rewardedBoostCoins * 2 : REWARD_CONFIG.rewardedBoostCoins;
  state.coins += bonusCoins;
  return {
    shufflesGranted: REWARD_CONFIG.rewardedBoostShuffle,
    vipGranted: REWARD_CONFIG.rewardedBoostVip,
    coinsGranted: bonusCoins
  };
}

export function normalizeRestoredProductIds(restoredProducts = []) {
  const allowed = new Set(RESTORABLE_PRODUCT_IDS);
  return restoredProducts
    .map(product => typeof product === 'string' ? product : product?.id)
    .filter(productId => typeof productId === 'string' && allowed.has(productId));
}

export function registerCloudSync(state, syncedAt = Date.now()) {
  state.lastCloudSyncAt = syncedAt;
  return { lastCloudSyncAt: syncedAt };
}

export function registerReceiptVerification(state, verifiedAt = Date.now()) {
  state.lastReceiptVerificationAt = verifiedAt;
  return { lastReceiptVerificationAt: verifiedAt };
}

export function setTrackingAuthorizationStatus(state, status) {
  state.trackingAuthorizationStatus = status ?? TRACKING_AUTH_STATUS.notDetermined;
  return state.trackingAuthorizationStatus;
}

export function setAttPromptCount(state, promptCount) {
  state.attPromptCount = Number(promptCount ?? 0);
  return state.attPromptCount;
}
