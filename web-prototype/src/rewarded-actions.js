import { AD_PLACEMENTS } from './economy-config.js';
import { applyRewardedBoost, applyRewardedRevive, canOfferRewardedRevive } from './monetization.js';

export function createRewardedActions(state, platform, persist, onBusyChange = () => {}) {
  let busy = false;
  return {
    get busy() { return busy; },
    async request(placement) {
      if (busy) return { status: 'busy' };
      if (![AD_PLACEMENTS.revive, AD_PLACEMENTS.rewardBoost].includes(placement)) return { status: 'unavailable' };
      const isRevive = placement === AD_PLACEMENTS.revive;
      if (isRevive && !canOfferRewardedRevive(state)) return { status: 'ineligible' };
      const roundId = state.roundId;
      const stage = state.stage;
      busy = true;
      try {
        onBusyChange(true);
        const result = await platform.showRewardedAd(placement);
        if (result?.completed !== true) return { status: 'not_completed' };
        if (isRevive && (state.roundId !== roundId || state.stage !== stage || !canOfferRewardedRevive(state))) return { status: 'stale' };
        const reward = isRevive ? applyRewardedRevive(state) : applyRewardedBoost(state);
        if (!reward) return { status: 'ineligible' };
        let persisted = false;
        try { persisted = (await persist('rewarded_completed'))?.persisted === true; } catch { persisted = false; }
        return { status: 'completed', reward, roundId, stage, persisted };
      } catch { return { status: 'not_completed' }; }
      finally {
        busy = false;
        onBusyChange(false);
      }
    }
  };
}
