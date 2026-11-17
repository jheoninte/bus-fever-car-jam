import assert from 'node:assert/strict';
import { createSimState, createVehicleState, resetRoundState } from '../web-prototype/src/game-state.js';
import { createReviveQueue, findBoardingMove, isDockFailureState } from '../web-prototype/src/rules.js';
import { applyRewardedRevive, canOfferRewardedRevive, createDefaultMetaState } from '../web-prototype/src/monetization.js';
import { createRewardedActions } from '../web-prototype/src/rewarded-actions.js';
import { AD_PLACEMENTS } from '../web-prototype/src/economy-config.js';
import { beginVehicleExit, completeVehicleArrival, boardPassenger, getPassengerBalanceErrors, getPuzzleFailureReason, settlePuzzle } from '../web-prototype/src/puzzle-engine.js';
import { solvePuzzle } from '../web-prototype/src/solver.js';
import { validateLevelDefinition } from '../web-prototype/src/level-schema.js';
import { getVehicleBadge, canVehicleExit } from '../web-prototype/src/rules.js';
import { readFile } from 'node:fs/promises';
import { buildStageState, getNextStageNumber } from '../web-prototype/src/level-loader.js';

function failedRound() {
  const state = Object.assign(createSimState(), createDefaultMetaState());
  const colors = ['red', 'blue', 'yellow', 'green'];
  resetRoundState(state, {
    vehicles: colors.map((colorId, index) => createVehicleState({
      id: `v${index}`, colorId, capacity: 2, status: 'DOCKED', dockIdx: index
    })),
    dock: { count: 4, slots: ['v0', 'v1', 'v2', 'v3'] },
    passengerQueue: ['purple', 'blue', 'red', 'green', 'red', 'yellow', 'blue', 'yellow', 'green'],
    isOver: true
  });
  return state;
}
const state = failedRound();
const before = [...state.passengerQueue];
const planned = createReviveQueue(state);
assert.deepEqual(state.passengerQueue, before);
assert.deepEqual([...planned].sort(), [...before].sort());
assert.deepEqual(planned.slice(0, 2), ['red', 'red']);
assert.deepEqual(planned.slice(2), before.filter(color => color !== 'red'));
assert.equal(isDockFailureState({ ...state, isOver: false }), true);
assert.equal(canOfferRewardedRevive(state), true);
assert.ok(applyRewardedRevive(state));
assert.equal(state.isOver, false);
assert.equal(state.reviveUsed, true);
assert.equal(isDockFailureState(state), false);
for (let i = 0; i < 2; i++) {
  const boarding = findBoardingMove(state);
  assert.equal(boarding.vehicle.id, 'v0');
  state.passengerQueue.splice(boarding.queueIndex, 1);
  boarding.vehicle.passengers++;
}
assert.equal(state.vehicles[0].passengers, state.vehicles[0].capacity);
assert.equal(applyRewardedRevive(state), null);

const impossible = failedRound();
impossible.passengerQueue = ['purple'];
assert.equal(canOfferRewardedRevive(impossible), false);
const unavailable = createRewardedActions(impossible, {
  showRewardedAd: async () => { throw new Error('Must not request an unusable revive'); }
}, async () => ({ persisted: true }));
assert.equal((await unavailable.request(AD_PLACEMENTS.revive)).status, 'ineligible');

const concurrent = failedRound();
let completeAd;
let requests = 0;
let saves = 0;
const actions = createRewardedActions(concurrent, {
  showRewardedAd: () => { requests++; return new Promise(resolve => { completeAd = resolve; }); }
}, async () => { saves++; return { persisted: true }; });
const first = actions.request(AD_PLACEMENTS.revive);
assert.equal(actions.busy, true);
assert.equal((await actions.request(AD_PLACEMENTS.revive)).status, 'busy');
assert.equal((await actions.request(AD_PLACEMENTS.rewardBoost)).status, 'busy');
completeAd({ completed: true });
assert.equal((await first).status, 'completed');
assert.equal(requests, 1);
assert.equal(saves, 1);
assert.equal(actions.busy, false);
assert.equal((await actions.request(AD_PLACEMENTS.revive)).status, 'ineligible');

const stale = failedRound();
let finishOldAd;
const oldActions = createRewardedActions(stale, {
  showRewardedAd: () => new Promise(resolve => { finishOldAd = resolve; })
}, async () => { throw new Error('Stale revive must not save'); });
const oldRequest = oldActions.request(AD_PLACEMENTS.revive);
const oldId = stale.roundId;
const nextRound = failedRound();
resetRoundState(stale, nextRound);
assert.ok(stale.roundId > oldId);
finishOldAd({ completed: true });
assert.equal((await oldRequest).status, 'stale');
assert.equal(stale.isOver, true);
assert.equal(stale.reviveUsed, false);
assert.equal(stale.shufflesLeft, 2);

for (const response of [{ completed: false }, null, true]) {
  const cancelled = failedRound();
  const cancelledActions = createRewardedActions(cancelled, { showRewardedAd: async () => response }, async () => ({ persisted: true }));
  assert.equal((await cancelledActions.request(AD_PLACEMENTS.revive)).status, 'not_completed');
  assert.equal(cancelled.isOver, true);
  assert.equal(cancelled.reviveUsed, false);
}
const saveFailed = failedRound();
const failingActions = createRewardedActions(saveFailed, { showRewardedAd: async () => ({ completed: true }) }, async () => { throw new Error('Disk full'); });
const result = await failingActions.request(AD_PLACEMENTS.rewardBoost);
assert.equal(result.status, 'completed');
assert.equal(result.persisted, false);
assert.equal(saveFailed.coins, 150);
assert.equal(failingActions.busy, false);
console.log('Gameplay validation passed: deterministic revive, passenger conservation, duplicate clicks, stale rounds, cancellations, save failures.');

const tunnelRound = createSimState();
resetRoundState(tunnelRound, {
  vehicles: [
    createVehicleState({ id: 'tunnel', colorId: 'red', capacity: 4, gimmick: 'tunnel', tunnelColorId: 'blue', cells: [{ c: 0, r: 0 }] }),
    createVehicleState({ id: 'blue', colorId: 'blue', capacity: 4, cells: [{ c: 1, r: 1 }] })
  ],
  passengerQueue: ['blue', 'red', 'blue', 'red', 'blue', 'red', 'blue', 'red']
});
assert.ok(beginVehicleExit(tunnelRound, tunnelRound.vehicles[0]));
assert.ok(completeVehicleArrival(tunnelRound, tunnelRound.vehicles[0]));
const boarded = boardPassenger(tunnelRound);
assert.equal(boarded.colorId, 'red');
assert.equal(boarded.queueIndex, 1);
assert.equal(boarded.viaTunnel, true);
assert.deepEqual(getPassengerBalanceErrors(tunnelRound), []);

const locked = createSimState();
resetRoundState(locked, {
  vehicles: [createVehicleState({ id: 'ice', colorId: 'red', capacity: 4, gimmick: 'frozen', isFrozen: true,
    unlockColorId: 'blue', cells: [{ c: 0, r: 0 }] })], passengerQueue: Array(4).fill('red')
});
assert.equal(canVehicleExit(locked, locked.vehicles[0]), false);
assert.equal(getPuzzleFailureReason(locked), 'no_legal_moves');
assert.equal(solvePuzzle(locked).status, 'no_sequential_solution');
assert.equal(locked.isOver, false);

const revealed = createSimState();
resetRoundState(revealed, {
  vehicles: [createVehicleState({ id: 'hidden', colorId: 'red', gimmick: 'mystery', isRevealed: false, cells: [{ c: 0, r: 0 }] })],
  passengerQueue: Array(4).fill('red')
});
assert.ok(beginVehicleExit(revealed, revealed.vehicles[0]));
assert.equal(revealed.vehicles[0].isRevealed, false);
assert.equal(getPuzzleFailureReason(revealed), null);
assert.ok(completeVehicleArrival(revealed, revealed.vehicles[0]));
assert.equal(revealed.vehicles[0].isRevealed, true);
assert.equal(settlePuzzle(revealed).isClear, true);

const pack = JSON.parse(await readFile(new URL('../data/levels_seed.json', import.meta.url), 'utf8'));
const sample = structuredClone(pack.stages[0]);
assert.deepEqual(validateLevelDefinition(sample), []);
sample.vehicles[0].cells = [{ c: -1, r: 0 }];
assert.ok(validateLevelDefinition(sample).length);
const missingKey = structuredClone(pack.stages[10]);
missingKey.vehicles.find(v => v.gimmick === 'frozen').unlockColorId = 'absent';
assert.ok(validateLevelDefinition(missingKey).some(error => error.includes('unlock')));
const earlyGimmick = structuredClone(pack.stages[0]);
earlyGimmick.vehicles[0].gimmick = 'mystery';
assert.ok(validateLevelDefinition(earlyGimmick).some(error => error.includes('early')));
const overlap = structuredClone(pack.stages[0]);
overlap.vehicles[1].cells = structuredClone(overlap.vehicles[0].cells);
assert.ok(validateLevelDefinition(overlap).some(error => error.includes('overlap')));
const imbalance = structuredClone(pack.stages[0]);
imbalance.passengerQueue.pop();
assert.ok(validateLevelDefinition(imbalance).some(error => error.includes('mismatch')));
const original = buildStageState(createSimState(), 1, pack);
const originalJson = JSON.stringify(original);
assert.equal(solvePuzzle(original).status, 'solved');
assert.equal(JSON.stringify(original), originalJson);
assert.equal(solvePuzzle(original, { maxStates: 0 }).status, 'budget_exhausted');
assert.equal(getNextStageNumber(pack, 19), 20);
assert.equal(getNextStageNumber(pack, 20), null);
assert.notEqual(getVehicleBadge({ gimmick: 'frozen', isFrozen: true, unlockColorId: 'red' }, true),
  getVehicleBadge({ gimmick: 'frozen', isFrozen: true, unlockColorId: 'blue' }, true));
console.log('Puzzle validation passed: same-color tunnel, locked exits, arrival reveal, solver isolation/budget, malformed levels, chapter boundary.');
