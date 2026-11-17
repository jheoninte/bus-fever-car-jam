import { canVehicleExit } from './rules.js';
import { getPassengerBalanceErrors, playSequentialMove, settlePuzzle } from './puzzle-engine.js';

export function clonePuzzle(state) {
  return {
    ...state,
    dock: { count: state.dock.count, slots: [...state.dock.slots] },
    vehicles: state.vehicles.map(v => ({ ...v, cells: v.cells.map(cell => ({ ...cell })), seedStack: [...v.seedStack] })),
    passengerQueue: [...state.passengerQueue]
  };
}

function stateKey(state) {
  return JSON.stringify([state.passengerQueue, state.dock.slots,
    state.vehicles.map(v => [v.status, v.passengers, v.isFrozen])]);
}

export function solvePuzzle(initial, { maxStates = 100000, findFailure = false } = {}) {
  if (getPassengerBalanceErrors(initial).length) return { status: 'invalid', visited: 0, path: null };
  const root = settlePuzzle(clonePuzzle(initial));
  const pending = [{ state: root, path: [] }];
  const seen = new Set();
  let winningPath = null;
  let failurePath = null;
  while (pending.length && seen.size < maxStates) {
    const { state, path } = pending.pop();
    const key = stateKey(state);
    if (seen.has(key)) continue;
    seen.add(key);
    if (state.isClear) {
      winningPath ??= path;
      if (!findFailure || failurePath) break;
      continue;
    }
    if (state.isOver) {
      failurePath ??= path;
      if (winningPath) break;
      continue;
    }
    const legal = state.vehicles.filter(v => canVehicleExit(state, v));
    const front = state.passengerQueue[0];
    const priority = v => v.gimmick === 'tunnel' ? 2 : v.colorId === front ? 1 : 0;
    legal.sort((a, b) => priority(a) - priority(b));
    for (const vehicle of legal) {
      const next = clonePuzzle(state);
      if (playSequentialMove(next, vehicle.id)) pending.push({ state: next, path: [...path, vehicle.id] });
    }
  }
  return { status: winningPath ? 'solved' : pending.length ? 'budget_exhausted' : 'no_sequential_solution',
    visited: seen.size, path: winningPath, failurePath };
}

export function replaySolution(initial, path) {
  const state = settlePuzzle(clonePuzzle(initial));
  for (const vehicleId of path) {
    if (!playSequentialMove(state, vehicleId)) throw new Error(`Illegal solution move: ${vehicleId}`);
    const errors = getPassengerBalanceErrors(state);
    if (errors.length) throw new Error(errors.join('; '));
  }
  return state;
}

export function measureRandomPlay(initial, { runs = 100, seed = 1 } = {}) {
  let randomState = seed >>> 0;
  let wins = 0;
  let failurePath = null;
  for (let run = 0; run < runs; run++) {
    const state = settlePuzzle(clonePuzzle(initial));
    const path = [];
    for (let turn = 0; turn < initial.vehicles.length && !state.isClear && !state.isOver; turn++) {
      const legal = state.vehicles.filter(v => canVehicleExit(state, v));
      if (!legal.length) break;
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      const vehicle = legal[Math.floor(randomState / 4294967296 * legal.length)];
      if (!playSequentialMove(state, vehicle.id)) break;
      path.push(vehicle.id);
    }
    if (state.isClear) wins++;
    else if (state.isOver) failurePath ??= path;
  }
  return { runs, wins, winRate: wins / runs, seed, failurePath };
}
