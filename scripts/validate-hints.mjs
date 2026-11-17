import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createSimState, createVehicleState } from '../web-prototype/src/game-state.js';
import { buildStageState } from '../web-prototype/src/level-loader.js';
import { clonePuzzle, replaySolution, solvePuzzle } from '../web-prototype/src/solver.js';
import { beginVehicleExit, playSequentialMove, settlePuzzle } from '../web-prototype/src/puzzle-engine.js';
import { canVehicleExit } from '../web-prototype/src/rules.js';
import { enumerateHintWorlds, findPublicHint, getHintKey, projectHintState } from '../web-prototype/src/hint-engine.js';
import { createHintClient } from '../web-prototype/src/hint-client.js';

const pack = JSON.parse(await readFile(new URL('../data/levels_seed.json', import.meta.url)));
const start = stage => settlePuzzle(buildStageState(createSimState(), stage, pack));
const serial = value => JSON.parse(JSON.stringify(value));
let recommendations = 0;
let hiddenChecks = 0;
const statuses = {};
const report = [];
for (const level of pack.stages) {
  const initial = start(level.stage);
  const solution = solvePuzzle(initial);
  for (const turn of [0, Math.floor(solution.path.length / 2)]) {
    const state = replaySolution(initial, solution.path.slice(0, turn));
    const before = serial(state);
    const hint = findPublicHint(state);
    statuses[hint.status] = (statuses[hint.status] ?? 0) + 1;
    assert.deepEqual(serial(state), before, 'Hint mutated game state, inventory or economy');
    const publicState = projectHintState(state);
    assert.equal('stageSeed' in publicState, false);
    assert.equal('coins' in publicState, false);
    assert.ok(publicState.vehicles.every(v => !('colorHex' in v) && v.seedStack.length === 0));
    const hidden = state.vehicles.filter(v => v.gimmick === 'mystery' && !v.isRevealed);
    if (hidden.length) {
      const alternative = clonePuzzle(state);
      alternative.vehicles.forEach(v => {
        if (v.gimmick === 'mystery' && !v.isRevealed) {
          v.colorId = 'not-a-public-color'; v.colorHex = 123; v.seedStack = ['secret'];
        }
      });
      alternative.stageSeed = { secret: true };
      assert.deepEqual(projectHintState(alternative), publicState);
      assert.equal(getHintKey(alternative), getHintKey(state));
      assert.deepEqual(findPublicHint(alternative), hint, 'Hint oracle exposed hidden colors through its answer');
      hiddenChecks++;
    }
    if (hint.status === 'recommended') {
      recommendations++;
      assert.ok(canVehicleExit(state, state.vehicles.find(v => v.id === hint.vehicleId)));
      const enumeration = enumerateHintWorlds(state);
      assert.equal(enumeration.status, 'complete');
      for (const world of enumeration.worlds) {
        settlePuzzle(world);
        assert.ok(playSequentialMove(world, hint.vehicleId));
        const continuation = solvePuzzle(world);
        assert.equal(continuation.status, 'solved', `Unsafe hint at stage ${level.stage}`);
        assert.equal(replaySolution(world, continuation.path).isClear, true);
      }
    } else assert.ok(['ambiguous', 'unavailable', 'budget_exhausted'].includes(hint.status), hint.status);
    if (turn === 0) report.push({ stage: level.stage, status: hint.status });
  }
}
assert.ok(recommendations >= 20, 'Hints should work across the authored pack');
assert.ok(hiddenChecks > 0);

const moving = start(1);
beginVehicleExit(moving, moving.vehicles.find(v => v.id === solvePuzzle(moving).path[0]));
assert.equal(findPublicHint(moving).status, 'wait');
const invalid = start(1);
invalid.passengerQueue.pop();
assert.equal(findPublicHint(invalid).status, 'invalid');
const failed = start(1);
failed.isOver = true;
assert.equal(findPublicHint(failed).status, 'finished');
assert.equal(findPublicHint(start(6), { maxWorlds: 0 }).status, 'budget_exhausted');
assert.equal(findPublicHint(start(1), { maxStates: 0 }).status, 'budget_exhausted');

// Only one dock remains: red-first is required, but the two mystery cars are publicly interchangeable.
const ambiguous = createSimState();
Object.assign(ambiguous, {
  cols: 4, rows: 4, totalPassengers: 20,
  passengerQueue: ['red', 'blue', 'green', 'purple', 'cyan'].flatMap(color => Array(4).fill(color)),
  dock: { count: 4, slots: ['d0', 'd1', 'd2', null] },
  vehicles: [
    ...['green', 'purple', 'cyan'].map((colorId, i) => createVehicleState({ id: `d${i}`, colorId,
      status: 'DOCKED', dockIdx: i, cells: [{ c: i, r: 3 }] })),
    ...['red', 'blue'].map((colorId, i) => createVehicleState({ id: `m${i}`, colorId,
      gimmick: 'mystery', dir: 'UP', cells: [{ c: i, r: 0 }] }))
  ]
});
assert.equal(enumerateHintWorlds(ambiguous).worlds.length, 2);
assert.equal(findPublicHint(ambiguous).status, 'ambiguous');
const swapped = clonePuzzle(ambiguous);
[swapped.vehicles[3].colorId, swapped.vehicles[4].colorId] = [swapped.vehicles[4].colorId, swapped.vehicles[3].colorId];
assert.deepEqual(findPublicHint(swapped), findPublicHint(ambiguous));

// Exercise lifecycle races without a browser or timer delays.
function fakeWorkers() {
  const workers = [];
  let fireTimeout;
  const options = {
    createWorker: () => {
      const worker = { terminated: false, terminate() { this.terminated = true; }, postMessage(data) { this.data = data; } };
      workers.push(worker);
      return worker;
    },
    schedule: fn => { fireTimeout = fn; return 1; }, unschedule: () => {}
  };
  return { workers, options, timeout: () => fireTimeout() };
}
const fake = fakeWorkers();
const client = createHintClient(fake.options);
const state = start(6);
const pending = client.request(state);
assert.equal(client.busy, true);
assert.equal((await client.request(state)).status, 'busy');
assert.ok(fake.workers[0].data.vehicles.filter(v => v.gimmick === 'mystery').every(v => v.colorId === null));
client.cancel();
assert.equal((await pending).status, 'cancelled');
assert.equal(fake.workers[0].terminated, true);
// A cancelled worker replying late cannot complete a newer request.
const next = client.request(state);
fake.workers[0].onmessage({ data: { status: 'recommended', vehicleId: 'old' } });
assert.equal(client.busy, true);
fake.timeout();
assert.equal((await next).status, 'budget_exhausted');
assert.equal(fake.workers[1].terminated, true);
const stale = client.request(state);
state.roundId++;
fake.workers[2].onmessage({ data: { status: 'recommended', vehicleId: 'old' } });
assert.equal((await stale).status, 'stale');
const request = client.request(state);
const actual = findPublicHint(state);
fake.workers[3].onmessage({ data: actual });
assert.deepEqual(await request, actual);
assert.deepEqual(await client.request(state), actual);
assert.equal(fake.workers.length, 4, 'Repeated hints at unchanged state should use cache');
const crashed = createHintClient({ ...fake.options, createWorker: () => { throw new Error('Worker unsupported'); } });
assert.equal((await crashed.request(state)).status, 'unavailable');
const broken = client.request(start(1));
fake.workers[4].onerror({ preventDefault() {} });
assert.equal((await broken).status, 'unavailable');

// Run the actual browser worker module in a Node worker adapter, including imports and messaging.
const workerUrl = new URL('../web-prototype/src/hint-worker.js', import.meta.url).href;
const workerSource = `const { parentPort } = require('node:worker_threads');
globalThis.self = { postMessage: data => parentPort.postMessage(data) };
import(${JSON.stringify(workerUrl)}).then(() => {
  parentPort.on('message', data => self.onmessage({ data }));
  parentPort.postMessage({ ready: true });
});`;
const worker = new NodeWorker(workerSource, { eval: true });
try {
  await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  const result = new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  worker.postMessage(projectHintState(start(1)));
  assert.deepEqual(await result, findPublicHint(start(1)));
} finally { await worker.terminate(); }
console.log(`Hint validation passed: ${recommendations}/40 recommended checkpoints, ${hiddenChecks} hidden-color invariance checks, all compatible color assignments replayed, cancellation/timeout/stale/cache/worker recovery.`);
console.log(`Initial-level hint coverage: ${report.map(r => `${r.stage}:${r.status}`).join(', ')}`);
