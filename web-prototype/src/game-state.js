export const VEHICLE_COLORS = [
    { id: 'red', hex: 0xef4444, symbol: 'R', altSymbol: '●' },
    { id: 'blue', hex: 0x3b82f6, symbol: 'B', altSymbol: '▲' },
    { id: 'yellow', hex: 0xfacc15, symbol: 'Y', altSymbol: '◆' },
    { id: 'green', hex: 0x10b981, symbol: 'G', altSymbol: '■' },
    { id: 'purple', hex: 0xa855f7, symbol: 'P', altSymbol: '✦' },
    { id: 'cyan', hex: 0x06b6d4, symbol: 'C', altSymbol: '✚' }
];

export const DIRECTIONS = {
    UP: { dc: 0, dr: -1 },
    DOWN: { dc: 0, dr: 1 },
    LEFT: { dc: -1, dr: 0 },
    RIGHT: { dc: 1, dr: 0 }
};

export function getColorById(colorId) {
    return VEHICLE_COLORS.find(color => color.id === colorId) || VEHICLE_COLORS[0];
}

export function getColorSymbol(colorId, colorBlind = false) {
    const color = getColorById(colorId);
    return colorBlind ? color.altSymbol : color.symbol;
}

export function createDockState(slotCount = 4) {
    return {
        count: slotCount,
        slots: Array(slotCount).fill(null)
    };
}

export function createVehicleState(overrides = {}) {
    return {
        id: overrides.id || '',
        colorId: overrides.colorId || 'red',
        colorHex: overrides.colorHex ?? getColorById(overrides.colorId).hex,
        dir: overrides.dir || 'RIGHT',
        length: overrides.length ?? 1,
        capacity: overrides.capacity ?? 4,
        passengers: overrides.passengers ?? 0,
        cells: Array.isArray(overrides.cells) ? overrides.cells.map(cell => ({ ...cell })) : [],
        status: overrides.status || 'PARKED',
        dockIdx: overrides.dockIdx ?? -1,
        gimmick: overrides.gimmick || 'normal',
        seedStack: Array.isArray(overrides.seedStack) ? [...overrides.seedStack] : [],
        isRevealed: overrides.isRevealed ?? (overrides.gimmick !== 'mystery'),
        isFrozen: overrides.isFrozen ?? false,
        unlockColorId: overrides.unlockColorId || null,
        tunnelColorId: overrides.tunnelColorId || null,
        x: overrides.x ?? 0,
        y: overrides.y ?? 0
    };
}

export function createSimState() {
    const state = {
        stage: 1,
        score: 0,
        coins: 120,
        shufflesLeft: 2,
        vipLeft: 1,
        hasNoAds: false,
        hasDoubleRewards: false,
        starterBundleOwned: false,
        totalClears: 0,
        interstitialCounter: 0,
        sessionCount: 0,
        reviveUsed: false,
        roundId: 0,
        cols: 6,
        rows: 6,
        dock: createDockState(4),
        slotLimit: 7,
        vehicles: [],
        passengerQueue: [],
        boardedCount: 0,
        totalPassengers: 0,
        isOver: false,
        isClear: false,
        colorBlind: false,
        stageSeed: null,
        get dockCount() {
            return this.dock.count;
        },
        set dockCount(value) {
            this.dock.count = value;
        },
        get docks() {
            return this.dock.slots;
        },
        set docks(value) {
            this.dock.slots = Array.isArray(value) ? [...value] : [];
        }
    };

    return state;
}

export function resetRoundState(state, patch = {}) {
    state.roundId = (state.roundId ?? 0) + 1;
    state.cols = patch.cols ?? state.cols;
    state.rows = patch.rows ?? state.rows;
    state.dock = patch.dock
        ? {
            count: patch.dock.count,
            slots: [...patch.dock.slots]
        }
        : createDockState(state.dock?.count ?? 4);
    state.slotLimit = patch.slotLimit ?? state.slotLimit;
    state.vehicles = Array.isArray(patch.vehicles) ? patch.vehicles.map(vehicle => createVehicleState(vehicle)) : [];
    state.passengerQueue = Array.isArray(patch.passengerQueue) ? [...patch.passengerQueue] : [];
    state.boardedCount = patch.boardedCount ?? 0;
    state.tunnelBoardedCount = 0;
    state.totalPassengers = patch.totalPassengers ?? state.passengerQueue.length;
    state.isOver = patch.isOver ?? false;
    state.isClear = patch.isClear ?? false;
    state.reviveUsed = patch.reviveUsed ?? false;
    state.stageSeed = patch.stageSeed ?? null;
    return state;
}

