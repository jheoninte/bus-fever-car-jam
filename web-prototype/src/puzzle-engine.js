import { canVehicleExit, findBoardingMove, findFreeDockSlot, isDockFailureState, revealMysteryVehicle, updateFrozenVehicles } from './rules.js';

export function beginVehicleExit(state, vehicle) {
  if (state.isOver || state.isClear || !state.vehicles.includes(vehicle) || !canVehicleExit(state, vehicle)) return false;
  const slot = findFreeDockSlot(state);
  if (slot < 0) return false;
  vehicle.status = 'MOVING';
  vehicle.dockIdx = slot;
  state.dock.slots[slot] = vehicle.id;
  return true;
}

export function completeVehicleArrival(state, vehicle) {
  if (!state.vehicles.includes(vehicle) || vehicle.status !== 'MOVING') return false;
  vehicle.status = 'DOCKED';
  revealMysteryVehicle(vehicle);
  return true;
}

export function boardPassenger(state) {
  if (state.isOver || state.isClear) return null;
  const move = findBoardingMove(state);
  if (!move) return null;
  state.passengerQueue.splice(move.queueIndex, 1);
  move.vehicle.passengers++;
  state.boardedCount++;
  if (move.viaTunnel) state.tunnelBoardedCount = (state.tunnelBoardedCount ?? 0) + 1;
  state.score += 50;
  return move;
}

export function beginVehicleDeparture(state, vehicle) {
  if (!state.vehicles.includes(vehicle) || !['DOCKED', 'PARKED'].includes(vehicle.status) || vehicle.passengers !== vehicle.capacity) return false;
  vehicle.status = 'DEPARTING';
  const slot = vehicle.dockIdx;
  if (slot >= 0 && state.dock.slots[slot] === vehicle.id) state.dock.slots[slot] = null;
  vehicle.dockIdx = -1;
  state.score += 200;
  return true;
}

export function isPuzzleCleared(state) {
  return state.totalPassengers > 0 && state.passengerQueue.length === 0 &&
    state.boardedCount === state.totalPassengers && state.vehicles.every(vehicle =>
      vehicle.passengers === vehicle.capacity && ['DEPARTING', 'DEPARTED'].includes(vehicle.status));
}

export function getPuzzleFailureReason(state) {
  if (state.isOver || state.isClear || isPuzzleCleared(state) || state.vehicles.some(v => v.status === 'MOVING')) return null;
  if (findBoardingMove(state)) return null;
  if (isDockFailureState(state)) return 'dock_full';
  if (findFreeDockSlot(state) >= 0 && state.vehicles.some(vehicle => canVehicleExit(state, vehicle))) return null;
  return 'no_legal_moves';
}

export function getPassengerBalanceErrors(state) {
  const colors = new Set([...state.passengerQueue, ...state.vehicles.map(v => v.colorId)]);
  const errors = [];
  for (const color of colors) {
    const waiting = state.passengerQueue.filter(item => item === color).length;
    const seats = state.vehicles.filter(v => v.colorId === color).reduce((sum, v) => sum + v.capacity - v.passengers, 0);
    if (waiting !== seats) errors.push(`${color}: waiting=${waiting}, remainingSeats=${seats}`);
  }
  if (state.boardedCount + state.passengerQueue.length !== state.totalPassengers) errors.push('total_passengers_changed');
  return errors;
}

export function settlePuzzle(state) {
  updateFrozenVehicles(state);
  let move;
  while ((move = boardPassenger(state))) {
    if (move.vehicle.passengers === move.vehicle.capacity) {
      beginVehicleDeparture(state, move.vehicle);
      move.vehicle.status = 'DEPARTED';
    }
    updateFrozenVehicles(state);
  }
  state.isClear = isPuzzleCleared(state);
  if (!state.isClear && getPuzzleFailureReason(state)) state.isOver = true;
  return state;
}

export function playSequentialMove(state, vehicleId) {
  const vehicle = state.vehicles.find(v => v.id === vehicleId);
  if (!beginVehicleExit(state, vehicle)) return false;
  completeVehicleArrival(state, vehicle);
  settlePuzzle(state);
  return true;
}
