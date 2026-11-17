export const SAVE_SCHEMA_VERSION = 3;

export const PRODUCT_IDS = {
  removeAds: 'com.busfever.removeads',
  starterBundle: 'com.busfever.starterbundle',
  coinPackSmall: 'com.busfever.coinpack.small',
  coinPackMedium: 'com.busfever.coinpack.medium'
};

export const PRODUCT_CATALOG = [
  {
    id: PRODUCT_IDS.removeAds,
    type: 'non_consumable',
    title: '광고 제거',
    description: '전면 광고 제거 + 클리어 인터스티셜 비활성화',
    priceLabel: '₩6,600'
  },
  {
    id: PRODUCT_IDS.starterBundle,
    type: 'non_consumable',
    title: '스타터 번들',
    description: '코인 600 + 셔플 5회 + VIP 3회 + 보상 2배',
    priceLabel: '₩8,800'
  },
  {
    id: PRODUCT_IDS.coinPackSmall,
    type: 'consumable',
    title: '코인 팩 S',
    description: '코인 1200 획득',
    priceLabel: '₩3,300'
  },
  {
    id: PRODUCT_IDS.coinPackMedium,
    type: 'consumable',
    title: '코인 팩 M',
    description: '코인 3500 획득',
    priceLabel: '₩8,800'
  }
];

export const SOFT_SHOP_CATALOG = [
  { id: 'shuffle_bundle', title: '셔플 3회', cost: 180 },
  { id: 'vip_bundle', title: 'VIP 2회', cost: 220 }
];

export const SHOP_ITEM_GRANTS = {
  shuffle_bundle: { shuffles: 3 },
  vip_bundle: { vip: 2 }
};

export const IAP_GRANTS = {
  [PRODUCT_IDS.removeAds]: { noAds: true },
  [PRODUCT_IDS.starterBundle]: {
    starterBundleOwned: true,
    doubleRewards: true,
    coins: 600,
    shuffles: 5,
    vip: 3
  },
  [PRODUCT_IDS.coinPackSmall]: { coins: 1200 },
  [PRODUCT_IDS.coinPackMedium]: { coins: 3500 }
};

export const REWARD_CONFIG = {
  stageClearBaseCoins: 25,
  stageClearStageStep: 5,
  rewardedBoostCoins: 30,
  rewardedReviveShuffle: 1,
  rewardedReviveVip: 1,
  rewardedBoostShuffle: 1,
  rewardedBoostVip: 1,
  interstitialEveryClears: 2
};

export const AD_PLACEMENTS = {
  sessionStart: 'session_start',
  stageClear: 'stage_clear',
  revive: 'revive',
  rewardBoost: 'reward_boost'
};

export const TRACKING_AUTH_STATUS = {
  authorized: 'authorized',
  denied: 'denied',
  restricted: 'restricted',
  notDetermined: 'not_determined'
};

export const RESTORABLE_PRODUCT_IDS = PRODUCT_CATALOG
  .filter(product => product.type === 'non_consumable')
  .map(product => product.id);
