import { findBoardingMove, canVehicleExit } from './rules.js';

function cloneCells(cells) {
  return Array.isArray(cells) ? cells.map(cell => ({ c: cell.c, r: cell.r })) : [];
}

export function serializeVehicle(vehicle) {
  return {
    id: vehicle.id,
    colorId: vehicle.colorId,
    gimmick: vehicle.gimmick,
    status: vehicle.status,
    length: vehicle.length,
    capacity: vehicle.capacity,
    passengers: vehicle.passengers,
    dockIdx: vehicle.dockIdx,
    isRevealed: vehicle.isRevealed,
    isFrozen: vehicle.isFrozen,
    unlockColorId: vehicle.unlockColorId,
    tunnelColorId: vehicle.tunnelColorId,
    cells: cloneCells(vehicle.cells)
  };
}

export function createStateSnapshot(state) {
  const movableVehicleIds = state.vehicles
    .filter(vehicle => canVehicleExit(state, vehicle))
    .map(vehicle => vehicle.id);
  const boardingMove = findBoardingMove(state);

  return {
    stage: state.stage,
    roundId: state.roundId,
    score: state.score,
    grid: {
      cols: state.cols,
      rows: state.rows
    },
    dock: {
      count: state.dock.count,
      slots: [...state.dock.slots]
    },
    slotLimit: state.slotLimit,
    shufflesLeft: state.shufflesLeft,
    vipLeft: state.vipLeft,
    boardedCount: state.boardedCount,
    totalPassengers: state.totalPassengers,
    isOver: state.isOver,
    isClear: state.isClear,
    frontPassengerColor: state.passengerQueue[0] || null,
    passengerQueue: [...state.passengerQueue],
    movableVehicleIds,
    boardingMove: boardingMove
      ? {
          vehicleId: boardingMove.vehicle.id,
          queueIndex: boardingMove.queueIndex,
          colorId: boardingMove.colorId,
          viaTunnel: boardingMove.viaTunnel
        }
      : null,
    vehicles: state.vehicles.map(serializeVehicle)
  };
}

export function formatStateSnapshot(snapshot) {
  const vehicleSummary = snapshot.vehicles
    .map(vehicle => `${vehicle.id}:${vehicle.status}:${vehicle.colorId}:${vehicle.passengers}/${vehicle.capacity}:${vehicle.gimmick}`)
    .join(' | ');

  return [
    `stage=${snapshot.stage} score=${snapshot.score}`,
    `dock=${snapshot.dock.slots.map(slot => slot || '-').join(',')} queue=${snapshot.passengerQueue.join(',') || '-'}`,
    `front=${snapshot.frontPassengerColor || '-'} movable=${snapshot.movableVehicleIds.join(',') || '-'}`,
    `boarding=${snapshot.boardingMove ? `${snapshot.boardingMove.vehicleId}@${snapshot.boardingMove.queueIndex}${snapshot.boardingMove.viaTunnel ? ':tunnel' : ''}` : '-'}`,
    `vehicles=${vehicleSummary || '-'}`
  ].join('\n');
}

export function installStateDebug(windowObj, state, sceneGetter) {
  windowObj.BusFeverDebug = {
    snapshot() {
      return createStateSnapshot(state);
    },
    printSnapshot() {
      const snapshot = createStateSnapshot(state);
      console.log('[BusFeverDebug] snapshot', snapshot);
      console.log(formatStateSnapshot(snapshot));
      return snapshot;
    },
    formatSnapshot() {
      return formatStateSnapshot(createStateSnapshot(state));
    },
    getSceneMetrics() {
      return sceneGetter()?.metrics || null;
    }
  };

  return windowObj.BusFeverDebug;
}
