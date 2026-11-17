import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { computeStationLayout, getQueuePoint, getExitWaypoints } from '../web-prototype/src/station-layout.js';
import { createSimState } from '../web-prototype/src/game-state.js';
import { buildStageState } from '../web-prototype/src/level-loader.js';
import { beginVehicleExit, completeVehicleArrival, boardPassenger, beginVehicleDeparture, isPuzzleCleared, getPuzzleFailureReason } from '../web-prototype/src/puzzle-engine.js';

const pack = JSON.parse(await readFile(new URL('../data/levels_seed.json', import.meta.url)));
let layouts = 0;
for (const [w, h] of [[320,568], [390,667], [390,844], [500,960]]) {
  for (const level of pack.stages) {
    const m = computeStationLayout(w, h, level.cols, level.rows, level.dockCount);
    assert.ok(m.gridLeft >= 0 && m.gridLeft + m.gridW <= w);
    assert.ok(m.gridTop + m.gridH <= h - (h < 740 ? 100 : 122), `Booster collision: ${w}x${h}, stage ${level.stage}`);
    for (let i = 0; i < 36; i++) {
      const p = getQueuePoint(i, m);
      assert.ok(p.x >= 12 && p.x <= w - 12 && p.y >= m.queueTop && p.y < m.dockY - m.dockH / 2);
    }
    const start = { x: w / 2, y: m.gridTop + m.gridH / 2 }, dock = { x: w / 2, y: m.dockY };
    for (const dir of ['UP','DOWN','LEFT','RIGHT']) {
      const path = getExitWaypoints(m, dir, start, dock);
      const first = path[0];
      assert.ok(dir === 'UP' ? first.y < start.y : dir === 'DOWN' ? first.y > start.y : dir === 'LEFT' ? first.x < start.x : first.x > start.x);
      assert.deepEqual(path.at(-1), dock);
      assert.ok(path.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
    }
    layouts++;
  }
}

// Execute the real scene methods with a controllable presentation clock. Rules stay real.
const html = await readFile(new URL('../web-prototype/index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('class JamPuzzleScene extends'), html.indexOf('let gameInstance = null;'));
for (const reduced of [false, true]) {
  const state = buildStageState(createSimState(), 1, pack);
  const car = state.vehicles.find(v => v.colorId === state.passengerQueue[0]);
  assert.ok(beginVehicleExit(state, car)); completeVehicleArrival(state, car);
  const context = vm.createContext({ Phaser: { Scene: class {} }, window: { matchMedia: () => ({ matches: reduced }) },
    SimState: state, nativeAppInactive: false, purchaseInProgress: false, rewardedActions: { busy: false },
    boardPassenger, beginVehicleDeparture, isPuzzleCleared, getPuzzleFailureReason,
    refreshHUD() {}, persistProgress() {}, resetHint() {}, AudioSynth: { seat() {}, depart() {} } });
  const Scene = vm.runInContext(`${source}\nJamPuzzleScene`, context);
  const scene = new Scene(), pending = [];
  scene.time = { delayedCall: (delay, callback) => pending.push({delay, callback}), removeAllEvents: () => pending.splice(0) };
  scene.tweens = { killAll() {} };
  const node = { active: true, destroy() { this.active = false; } };
  scene.vehNodes.set(car.id, node);
  scene.applyFrontQueueEffects = scene.renderPassengerQueue = () => {};
  scene.animatePassengerBoarding = () => {};
  while (car.passengers < car.capacity) { scene.boardTimer = 0; scene.fixedStep(1 / 60); }
  assert.equal(car.status, 'DEPARTING', 'Save must commit the full bus before delayed departure');
  assert.equal(state.dock.slots.includes(car.id), false);
  assert.equal(pending[0].delay, reduced ? 100 : 680);
  const stale = pending[0].callback;
  scene.clearStageVisuals();
  stale(); // A stale callback must not try to paint or drive a destroyed/new-round bus.
  assert.equal(node.active, false);
  assert.equal(scene.flyingPassengers.size, 0);
  assert.equal(pending.length, 0);
  // Both outcome paths must wait while a person is walking or a bus is leaving.
  scene.evaluateVictory(); scene.evaluateFailure();
  state.vehicles.forEach(v => { v.status = 'DEPARTED'; });
  scene.flyingPassengers.add({});
  scene.evaluateVictory(); scene.evaluateFailure();
  assert.equal(state.isClear, false);
  assert.equal(state.isOver, false);
}
console.log(`Presentation validation passed: ${layouts} level/viewport layouts, directional routes, atomic departure saves, stale callback cancellation, outcome gating and reduced motion.`);
