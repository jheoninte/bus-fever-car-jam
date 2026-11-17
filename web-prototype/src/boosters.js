import { clonePuzzle, solvePuzzle } from './solver.js';
import { beginVehicleDeparture, getPassengerBalanceErrors } from './puzzle-engine.js';
import { updateFrozenVehicles } from './rules.js';

function eligible(state, stock) {
  return Number.isSafeInteger(stock) && stock > 0 && !state.isOver && !state.isClear &&
    !state.vehicles.some(v => v.status === 'MOVING') && !getPassengerBalanceErrors(state).length;
}

// Only charge for a result with a proven continuation under the shared sequential policy.
export function applySafeShuffle(state, random = Math.random, { attempts = 8, maxStates = 5000 } = {}) {
  if (!eligible(state, state.shufflesLeft) || state.passengerQueue.length < 2) return { ok: false, reason: 'ineligible' };
  for (let attempt = 0; attempt < attempts; attempt++) {
    const candidate = clonePuzzle(state);
    for (let i = candidate.passengerQueue.length - 1; i > 0; i--) {
      const value = random();
      if (!Number.isFinite(value) || value < 0 || value >= 1) return { ok: false, reason: 'invalid_random' };
      const j = Math.floor(value * (i + 1));
      [candidate.passengerQueue[i], candidate.passengerQueue[j]] = [candidate.passengerQueue[j], candidate.passengerQueue[i]];
    }
    if (candidate.passengerQueue.every((color, i) => color === state.passengerQueue[i])) continue;
    if (solvePuzzle(candidate, { maxStates }).status !== 'solved') continue;
    state.passengerQueue = candidate.passengerQueue;
    state.shufflesLeft--;
    return { ok: true };
  }
  return { ok: false, reason: 'no_verified_shuffle' };
}

export function applySafeVip(state, { maxStates = 5000 } = {}) {
  if (!eligible(state, state.vipLeft)) return { ok: false, reason: 'ineligible' };
  const targets = ['DOCKED', 'PARKED'].flatMap(status => state.vehicles.filter(v => v.status === status));
  for (const target of targets) {
    const candidate = clonePuzzle(state);
    const vehicle = candidate.vehicles.find(v => v.id === target.id);
    const needed = vehicle.capacity - vehicle.passengers;
    if (needed <= 0 || candidate.passengerQueue.filter(c => c === vehicle.colorId).length < needed) continue;
    let removed = 0;
    candidate.passengerQueue = candidate.passengerQueue.filter(color => {
      if (color === vehicle.colorId && removed < needed) { removed++; return false; }
      return true;
    });
    vehicle.passengers = vehicle.capacity;
    candidate.boardedCount += removed;
    // VIP intentionally bypasses parking obstructions and frozen locks.
    beginVehicleDeparture(candidate, vehicle);
    vehicle.status = 'DEPARTED';
    updateFrozenVehicles(candidate);
    if (getPassengerBalanceErrors(candidate).length || solvePuzzle(candidate, { maxStates }).status !== 'solved') continue;
    state.passengerQueue = candidate.passengerQueue;
    state.boardedCount = candidate.boardedCount;
    target.passengers = target.capacity;
    target.isFrozen = false;
    target.isRevealed = true;
    state.vipLeft--;
    // The renderer starts the departure so its score and dock mutation occur exactly once.
    return { ok: true, vehicle: target };
  }
  return { ok: false, reason: 'no_verified_vip' };
}
