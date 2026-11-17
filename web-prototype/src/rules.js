import { DIRECTIONS, getColorSymbol } from './game-state.js';

export function getVehicleDisplayColorId(vehicle) {
    if (vehicle.gimmick === 'mystery' && !vehicle.isRevealed) {
        return null;
    }

    return vehicle.colorId;
}

export function getVehicleBadge(vehicle, colorBlind = false) {
    if (vehicle.gimmick === 'mystery' && !vehicle.isRevealed) {
        return '?';
    }

    if (vehicle.gimmick === 'frozen' && vehicle.isFrozen) {
        return `❄${getColorSymbol(vehicle.unlockColorId || vehicle.colorId, colorBlind)}`;
    }

    if (vehicle.gimmick === 'tunnel') {
        return `◌${getColorSymbol(vehicle.colorId, colorBlind)}`;
    }

    return '';
}

export function isFrozenVehicleLocked(vehicle) {
    return vehicle.gimmick === 'frozen' && vehicle.isFrozen;
}

export function revealMysteryVehicle(vehicle) {
    if (vehicle.gimmick !== 'mystery' || vehicle.isRevealed) return false;
    vehicle.isRevealed = true;
    return true;
}

export function updateFrozenVehicles(state) {
    const frontColor = state.passengerQueue[0];
    if (!frontColor) return [];

    const thawed = [];
    state.vehicles.forEach(vehicle => {
        if (!isFrozenVehicleLocked(vehicle)) return;
        if ((vehicle.unlockColorId || vehicle.colorId) !== frontColor) return;
        vehicle.isFrozen = false;
        thawed.push(vehicle);
    });
    return thawed;
}

export function canVehicleExit(state, vehicle) {
    if (!vehicle || vehicle.status !== 'PARKED' || isFrozenVehicleLocked(vehicle)) return false;

    const direction = DIRECTIONS[vehicle.dir];
    if (!direction) return false;

    const head = vehicle.cells?.[0];
    if (!head) return false;

    let scanC = head.c + direction.dc;
    let scanR = head.r + direction.dr;
    while (scanC >= 0 && scanC < state.cols && scanR >= 0 && scanR < state.rows) {
        const blocked = state.vehicles.some(other =>
            other.id !== vehicle.id &&
            other.status === 'PARKED' &&
            other.cells.some(cell => cell.c === scanC && cell.r === scanR)
        );
        if (blocked) return false;
        scanC += direction.dc;
        scanR += direction.dr;
    }

    return true;
}

export function findFreeDockSlot(state) {
    return state.dock.slots.findIndex(slot => slot === null);
}

export function findBoardingMove(state) {
    const frontColor = state.passengerQueue[0];
    if (frontColor) {
        const frontVehicle = state.vehicles.find(vehicle =>
            vehicle.status === 'DOCKED' &&
            vehicle.colorId === frontColor &&
            vehicle.passengers < vehicle.capacity
        );

        if (frontVehicle) {
            return {
                vehicle: frontVehicle,
                queueIndex: 0,
                colorId: frontColor,
                viaTunnel: false
            };
        }
    }

    for (const vehicle of state.vehicles) {
        if (vehicle.status !== 'DOCKED' || vehicle.passengers >= vehicle.capacity || vehicle.gimmick !== 'tunnel') {
            continue;
        }

        const tunnelColor = vehicle.colorId;
        const queueIndex = state.passengerQueue.findIndex((colorId, index) => index > 0 && colorId === tunnelColor);
        if (queueIndex !== -1) {
            return {
                vehicle,
                queueIndex,
                colorId: tunnelColor,
                viaTunnel: true
            };
        }
    }

    return null;
}

export function findBoardingTarget(state) {
    return findBoardingMove(state)?.vehicle || null;
}

export function isDockFailureState(state) {
    if (state.isClear || state.isOver) return false;

    const docksFull = state.dock.slots.every(id => {
        if (!id) return false;
        const vehicle = state.vehicles.find(item => item.id === id);
        return vehicle && vehicle.status === 'DOCKED';
    });

    if (!docksFull || state.passengerQueue.length === 0) return false;

    return !findBoardingMove(state);
}

export function createReviveQueue(state) {
    for (const vehicle of state.vehicles) {
        if (vehicle.status !== 'DOCKED') continue;
        const needed = vehicle.capacity - vehicle.passengers;
        if (needed <= 0) continue;
        const matching = [];
        const remaining = [];
        for (const color of state.passengerQueue) {
            if (color === vehicle.colorId && matching.length < needed) matching.push(color);
            else remaining.push(color);
        }
        if (matching.length === needed) return [...matching, ...remaining];
    }
    return null;
}
