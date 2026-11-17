import { createSimState } from './game-state.js';
import { buildStageState } from './level-loader.js';
import { getPassengerBalanceErrors } from './puzzle-engine.js';
import { updateFrozenVehicles } from './rules.js';

const signature = level => JSON.stringify(level);
const integer = value => Number.isSafeInteger(value) && value >= 0;

export function exportRound(state) {
  if (!state.stageSeed || state.stageSeed.stage !== state.stage || state.isClear) return null;
  return {
    version: 1, stage: state.stage, levelSignature: signature(state.stageSeed),
    passengerQueue: [...state.passengerQueue], boardedCount: state.boardedCount,
    tunnelBoardedCount: state.tunnelBoardedCount ?? 0, reviveUsed: state.reviveUsed === true,
    vehicles: state.vehicles.map(v => ({
      id: v.id, passengers: v.passengers,
      status: v.status === 'MOVING' ? 'DOCKED' : v.status === 'DEPARTING' ? 'DEPARTED' : v.status,
      dockIdx: v.dockIdx, isFrozen: v.isFrozen,
      isRevealed: v.status === 'MOVING' ? true : v.isRevealed
    }))
  };
}

// Build from trusted level geometry; only validated mutable fields may be restored.
export function restoreRound(state, round, pack) {
  if (!round) return { restored: false, reason: 'missing' };
  const level = pack?.stages.find(item => item.stage === state.stage);
  if (!level || round.version !== 1 || round.stage !== state.stage || round.levelSignature !== signature(level)) return { restored: false, reason: 'level_changed' };
  if (!Array.isArray(round.vehicles) || round.vehicles.length !== level.vehicles.length ||
      !Array.isArray(round.passengerQueue) || round.passengerQueue.length > level.passengerQueue.length ||
      !integer(round.boardedCount) || !integer(round.tunnelBoardedCount) || round.tunnelBoardedCount > round.boardedCount ||
      typeof round.reviveUsed !== 'boolean') return { restored: false, reason: 'invalid_round' };
  const candidate = buildStageState(createSimState(), state.stage, pack);
  const ids = new Set();
  for (const saved of round.vehicles) {
    const vehicle = candidate.vehicles.find(v => v.id === saved?.id);
    if (!vehicle || ids.has(saved.id) || !integer(saved.passengers) || saved.passengers > vehicle.capacity ||
        !['PARKED', 'DOCKED', 'DEPARTED'].includes(saved.status) ||
        typeof saved.isFrozen !== 'boolean' || typeof saved.isRevealed !== 'boolean' ||
        !Number.isInteger(saved.dockIdx)) return { restored: false, reason: 'invalid_vehicle' };
    ids.add(saved.id);
    if ((saved.status === 'PARKED' && saved.passengers !== 0) ||
        (saved.status === 'DOCKED' && saved.passengers === vehicle.capacity) ||
        (saved.status === 'DEPARTED' && saved.passengers !== vehicle.capacity) ||
        (saved.status !== 'DOCKED' && saved.dockIdx !== -1) ||
        (saved.isFrozen && (vehicle.gimmick !== 'frozen' || saved.status !== 'PARKED')) ||
        (!saved.isRevealed && (vehicle.gimmick !== 'mystery' || saved.status !== 'PARKED')))
      return { restored: false, reason: 'invalid_vehicle_state' };
    if (saved.status === 'DOCKED') {
      if (saved.dockIdx < 0 || saved.dockIdx >= 4 || candidate.dock.slots[saved.dockIdx] !== null) return { restored: false, reason: 'invalid_dock' };
      candidate.dock.slots[saved.dockIdx] = saved.id;
    }
    for (const field of ['passengers', 'status', 'dockIdx', 'isFrozen', 'isRevealed']) vehicle[field] = saved[field];
  }
  candidate.passengerQueue = [...round.passengerQueue];
  candidate.boardedCount = round.boardedCount;
  candidate.tunnelBoardedCount = round.tunnelBoardedCount;
  candidate.reviveUsed = round.reviveUsed;
  if (getPassengerBalanceErrors(candidate).length) return { restored: false, reason: 'passenger_mismatch' };
  updateFrozenVehicles(candidate);
  for (const field of ['vehicles', 'dock', 'passengerQueue', 'boardedCount', 'tunnelBoardedCount', 'reviveUsed']) state[field] = candidate[field];
  state.isOver = false;
  state.isClear = false;
  state.roundId++;
  return { restored: true };
}
