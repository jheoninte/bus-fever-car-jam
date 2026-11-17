import { createDockState, createVehicleState, resetRoundState } from './game-state.js';
import { validateLevelDefinition } from './level-schema.js';

export function normalizeStageSeed(raw) {
  if (!raw) return null;
  const stages = Array.isArray(raw) ? raw : Array.isArray(raw.stages) ? raw.stages : [raw];
  return { schemaVersion: raw.schemaVersion ?? 2, stages: stages.map(stage => ({ ...stage })) };
}

export async function loadStageSeed(url = '../data/levels_seed.json') {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load stage seed: ${response.status}`);
  const data = normalizeStageSeed(await response.json());
  if (!data?.stages.length || data.schemaVersion !== 2) throw new Error('Unsupported level data');
  const ids = new Set();
  for (const stage of data.stages) {
    const errors = validateLevelDefinition(stage);
    if (ids.has(stage.stage)) errors.push('Duplicate stage');
    ids.add(stage.stage);
    if (errors.length) throw new Error(`Stage ${stage.stage}: ${errors.join('; ')}`);
  }
  return data;
}

export function getNextStageNumber(seedData, stageNum) {
  return seedData?.stages.map(stage => stage.stage).filter(stage => stage > stageNum).sort((a, b) => a - b)[0] ?? null;
}

export function buildStageState(state, stageNum, seedData) {
  const stage = seedData?.stages.find(item => item.stage === stageNum);
  if (!stage) throw new Error(`Missing authored stage ${stageNum}`);
  const errors = validateLevelDefinition(stage);
  if (errors.length) throw new Error(errors.join('; '));
  const vehicles = stage.vehicles.map(vehicle => createVehicleState({
    ...vehicle,
    capacity: vehicle.length === 2 ? 6 : 4,
    passengers: 0,
    status: 'PARKED',
    dockIdx: -1,
    isRevealed: vehicle.gimmick !== 'mystery',
    isFrozen: vehicle.gimmick === 'frozen',
    tunnelColorId: vehicle.gimmick === 'tunnel' ? vehicle.colorId : null
  }));
  state.stage = stageNum;
  resetRoundState(state, { cols: stage.cols, rows: stage.rows, dock: createDockState(4), slotLimit: 4,
    vehicles, passengerQueue: stage.passengerQueue, totalPassengers: stage.passengerQueue.length, stageSeed: stage });
  return state;
}
