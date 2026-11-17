import { DIRECTIONS, VEHICLE_COLORS } from './game-state.js';

export function validateLevelDefinition(level) {
  const errors = [];
  if (!level || typeof level !== 'object') return ['Level must be an object'];
  const colorIds = new Set(VEHICLE_COLORS.map(color => color.id));
  const positive = value => Number.isInteger(value) && value > 0;
  if (!positive(level.stage) || !positive(level.seed)) errors.push('stage/seed must be positive integers');
  if (!positive(level.cols) || !positive(level.rows) || level.cols > 8 || level.rows > 8) errors.push('Invalid grid size');
  if (level.dockCount !== 4) errors.push('Exactly four dock slots required');
  if (!Array.isArray(level.vehicles) || !level.vehicles.length || level.vehicles.length > 24) return [...errors, 'Invalid vehicles'];
  if (!Array.isArray(level.passengerQueue) || !level.passengerQueue.length || level.passengerQueue.some(c => !colorIds.has(c))) return [...errors, 'Invalid passenger queue'];
  const ids = new Set();
  const occupied = new Set();
  const required = new Map();
  for (const vehicle of level.vehicles) {
    if (!vehicle || typeof vehicle !== 'object') { errors.push('Invalid vehicle'); continue; }
    const label = vehicle.id || 'unnamed';
    if (typeof vehicle.id !== 'string' || !vehicle.id || ids.has(vehicle.id)) errors.push(`${label}: duplicate/invalid id`);
    ids.add(vehicle.id);
    if (!colorIds.has(vehicle.colorId)) errors.push(`${label}: invalid color`);
    if (![1, 2].includes(vehicle.length)) errors.push(`${label}: invalid length`);
    if (vehicle.capacity !== undefined && vehicle.capacity !== (vehicle.length === 2 ? 6 : 4)) errors.push(`${label}: invalid capacity`);
    required.set(vehicle.colorId, (required.get(vehicle.colorId) || 0) + (vehicle.length === 2 ? 6 : 4));
    const direction = DIRECTIONS[vehicle.dir];
    if (!direction) errors.push(`${label}: invalid direction`);
    if (!['normal', 'mystery', 'frozen', 'tunnel'].includes(vehicle.gimmick)) errors.push(`${label}: invalid gimmick`);
    const unlockStage = { normal: 1, mystery: 6, frozen: 11, tunnel: 16 }[vehicle.gimmick];
    if (level.stage < unlockStage) errors.push(`${label}: gimmick introduced too early`);
    if (vehicle.gimmick === 'frozen' && (!colorIds.has(vehicle.unlockColorId) || !level.passengerQueue.includes(vehicle.unlockColorId))) errors.push(`${label}: missing unlock color`);
    if (vehicle.gimmick === 'tunnel' && vehicle.tunnelColorId !== undefined && vehicle.tunnelColorId !== vehicle.colorId) errors.push(`${label}: tunnel must use its own color`);
    if (!Array.isArray(vehicle.cells) || vehicle.cells.length !== vehicle.length) { errors.push(`${label}: cells/length mismatch`); continue; }
    const head = vehicle.cells[0];
    vehicle.cells.forEach((cell, index) => {
      if (!cell || !Number.isInteger(cell.c) || !Number.isInteger(cell.r) || cell.c < 0 || cell.r < 0 || cell.c >= level.cols || cell.r >= level.rows) {
        errors.push(`${label}: cell outside grid`); return;
      }
      const key = `${cell.c},${cell.r}`;
      if (occupied.has(key)) errors.push(`${label}: overlapping cells`);
      occupied.add(key);
      if (direction && head && (cell.c !== head.c - direction.dc * index || cell.r !== head.r - direction.dr * index)) errors.push(`${label}: invalid cell order`);
    });
  }
  for (const color of colorIds) {
    if (level.passengerQueue.filter(c => c === color).length !== (required.get(color) || 0)) errors.push(`${color}: seats/passengers mismatch`);
  }
  if (typeof level.tutorial !== 'string' || !level.tutorial.trim()) errors.push('Missing tutorial');
  return errors;
}
