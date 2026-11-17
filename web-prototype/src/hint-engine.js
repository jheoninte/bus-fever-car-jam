import { VEHICLE_COLORS } from './game-state.js';
import { canVehicleExit, findBoardingMove, findFreeDockSlot, updateFrozenVehicles } from './rules.js';
import { getPassengerBalanceErrors, isPuzzleCleared, playSequentialMove } from './puzzle-engine.js';
import { clonePuzzle, solvePuzzle } from './solver.js';

// Whitelist rule information, including the full queue; no authored mystery answer crosses the worker boundary.
export function projectHintState(state) {
  return {
    stage: state.stage, roundId: state.roundId, cols: state.cols, rows: state.rows,
    dock: { count: state.dock.count, slots: [...state.dock.slots] },
    passengerQueue: [...state.passengerQueue], boardedCount: state.boardedCount,
    totalPassengers: state.totalPassengers, score: 0,
    isOver: state.isOver, isClear: state.isClear,
    vehicles: state.vehicles.map(v => ({
      id: v.id, dir: v.dir, length: v.length, capacity: v.capacity, passengers: v.passengers,
      cells: v.cells.map(c => ({ c: c.c, r: c.r })), status: v.status, dockIdx: v.dockIdx,
      gimmick: v.gimmick, isFrozen: v.isFrozen, unlockColorId: v.unlockColorId,
      isRevealed: v.isRevealed, seedStack: [],
      colorId: v.gimmick === 'mystery' && !v.isRevealed ? null : v.colorId
    }))
  };
}

export const getHintKey = state => JSON.stringify(projectHintState(state));

// Enumerate every hidden assignment consistent with public remaining seats, never the authored assignment.
export function enumerateHintWorlds(input, { maxWorlds = 120, maxNodes = 10000 } = {}) {
  const state = projectHintState(input);
  const colors = VEHICLE_COLORS.map(c => c.id);
  if (state.passengerQueue.some(c => !colors.includes(c))) return { status: 'invalid', worlds: [] };
  const remaining = Object.fromEntries(colors.map(c => [c, state.passengerQueue.filter(item => item === c).length]));
  const hidden = state.vehicles.filter(v => v.gimmick === 'mystery' && !v.isRevealed);
  for (const v of state.vehicles) {
    if (hidden.includes(v)) {
      if (v.status !== 'PARKED' || v.passengers !== 0) return { status: 'invalid', worlds: [] };
    } else {
      if (!colors.includes(v.colorId)) return { status: 'invalid', worlds: [] };
      remaining[v.colorId] -= v.capacity - v.passengers;
    }
  }
  if (Object.values(remaining).some(n => n < 0) || hidden.length > 8 ||
      state.boardedCount + state.passengerQueue.length !== state.totalPassengers)
    return { status: 'invalid', worlds: [] };
  const worlds = [];
  let nodes = 0;
  let exhausted = false;
  function assign(index) {
    if (++nodes > maxNodes) { exhausted = true; return; }
    if (index === hidden.length) {
      if (Object.values(remaining).some(n => n !== 0)) return;
      if (worlds.length >= maxWorlds) { exhausted = true; return; }
      worlds.push(clonePuzzle(state));
      return;
    }
    const vehicle = hidden[index];
    for (const color of colors) {
      if (remaining[color] < vehicle.capacity) continue;
      remaining[color] -= vehicle.capacity;
      vehicle.colorId = color;
      assign(index + 1);
      remaining[color] += vehicle.capacity;
      if (exhausted) return;
    }
    vehicle.colorId = null;
  }
  assign(0);
  return { status: exhausted ? 'budget_exhausted' : worlds.length ? 'complete' : 'invalid', worlds: exhausted ? [] : worlds };
}

export function findPublicHint(input, { maxStates = 20000, maxWorlds = 120 } = {}) {
  const state = projectHintState(input);
  if (state.isOver || state.isClear || isPuzzleCleared(state)) return { status: 'finished' };
  if (state.vehicles.some(v => ['MOVING', 'DEPARTING'].includes(v.status)) || findBoardingMove(state)) return { status: 'wait' };
  const enumeration = enumerateHintWorlds(state, { maxWorlds });
  if (enumeration.status !== 'complete') return { status: enumeration.status };
  const worlds = enumeration.worlds;
  worlds.forEach(updateFrozenVehicles);
  if (worlds.some(world => getPassengerBalanceErrors(world).length)) return { status: 'invalid' };
  if (findFreeDockSlot(state) < 0) return { status: 'unavailable' };
  const front = state.passengerQueue[0];
  const priority = v => v.colorId === front ? 0 : v.gimmick === 'tunnel' ? 1 : v.colorId !== null ? 2 : 3;
  // Stable ordering uses visible colors only, so permutations of secret colors cannot change the answer.
  const choices = state.vehicles.filter(v => canVehicleExit(worlds[0], worlds[0].vehicles.find(w => w.id === v.id)))
    .sort((a, b) => priority(a) - priority(b) || a.id.localeCompare(b.id));
  let visited = 0;
  for (const choice of choices) {
    let verified = true;
    for (const world of worlds) {
      const next = clonePuzzle(world);
      if (!playSequentialMove(next, choice.id) || next.isOver) { verified = false; break; }
      if (next.isClear) continue;
      if (visited >= maxStates) return { status: 'budget_exhausted' };
      const result = solvePuzzle(next, { maxStates: maxStates - visited });
      visited += result.visited;
      if (result.status === 'budget_exhausted') return { status: 'budget_exhausted' };
      if (result.status !== 'solved') { verified = false; break; }
    }
    if (verified) return { status: 'recommended', vehicleId: choice.id };
  }
  return { status: worlds.length > 1 ? 'ambiguous' : 'unavailable' };
}
