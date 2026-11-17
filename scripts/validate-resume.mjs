import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSimState } from '../web-prototype/src/game-state.js';
import { buildStageState } from '../web-prototype/src/level-loader.js';
import { clonePuzzle, solvePuzzle, replaySolution } from '../web-prototype/src/solver.js';
import { beginVehicleExit, completeVehicleArrival, boardPassenger, beginVehicleDeparture, getPassengerBalanceErrors, settlePuzzle, playSequentialMove } from '../web-prototype/src/puzzle-engine.js';
import { exportRound, restoreRound } from '../web-prototype/src/round-save.js';
import { applySafeShuffle, applySafeVip } from '../web-prototype/src/boosters.js';

const pack = JSON.parse(await readFile(new URL('../data/levels_seed.json', import.meta.url)));
const start = stage => buildStageState(createSimState(), stage, pack);
const serial = data => JSON.parse(JSON.stringify(data));
let seed = 417;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
let shuffleCount = 0;
let vipCount = 0;
let resumeCount = 0;
for (const level of pack.stages) {
  const state = start(level.stage);
  const solution = solvePuzzle(state);
  // Every sequential checkpoint, including completed-but-not-yet-rewarded rounds.
  for (let turn = 0; turn <= solution.path.length; turn++) {
    state.isClear = false;
    const round = serial(exportRound(state));
    const restored = start(level.stage);
    assert.equal(restoreRound(restored, round, pack).restored, true);
    assert.deepEqual(exportRound(restored), round);
    assert.deepEqual(getPassengerBalanceErrors(restored), []);
    assert.equal(replaySolution(restored, solution.path.slice(turn)).isClear, true);
    resumeCount++;
    if (turn === 0 || turn === Math.floor(solution.path.length / 2)) {
      const shuffled = clonePuzzle(state);
      const before = serial(shuffled);
      const result = applySafeShuffle(shuffled, random);
      if (result.ok) {
        shuffleCount++;
        assert.equal(shuffled.shufflesLeft, before.shufflesLeft - 1);
        assert.deepEqual([...shuffled.passengerQueue].sort(), [...before.passengerQueue].sort());
        assert.deepEqual(getPassengerBalanceErrors(shuffled), []);
        const solved = solvePuzzle(shuffled);
        assert.equal(replaySolution(shuffled, solved.path).isClear, true);
      } else assert.deepEqual(serial(shuffled), before);
      const vip = clonePuzzle(state);
      const oldVip = vip.vipLeft;
      const boosted = applySafeVip(vip);
      assert.equal(boosted.ok, true, `VIP unavailable at stage ${level.stage}, turn ${turn}`);
      vipCount++;
      assert.equal(vip.vipLeft, oldVip - 1);
      assert.ok(beginVehicleDeparture(vip, boosted.vehicle));
      boosted.vehicle.status = 'DEPARTED';
      assert.deepEqual(getPassengerBalanceErrors(vip), []);
      const afterVip = start(level.stage);
      assert.equal(restoreRound(afterVip, serial(exportRound(vip)), pack).restored, true);
      const solved = solvePuzzle(vip);
      assert.equal(solved.status, 'solved');
      assert.equal(replaySolution(vip, solved.path).isClear, true);
    }
    if (turn < solution.path.length) assert.ok(playSequentialMove(state, solution.path[turn]));
  }
}
assert.ok(shuffleCount >= 20);
assert.equal(vipCount, 40);

// Save halfway through arrival or boarding, without advancing automatic passengers on load.
const moving = start(1);
const first = solvePuzzle(moving).path[0];
const car = moving.vehicles.find(v => v.id === first);
assert.ok(beginVehicleExit(moving, car));
const arrived = start(1);
assert.equal(restoreRound(arrived, serial(exportRound(moving)), pack).restored, true);
assert.equal(arrived.vehicles.find(v => v.id === first).status, 'DOCKED');
assert.equal(arrived.boardedCount, 0);
completeVehicleArrival(moving, car);
boardPassenger(moving);
moving.reviveUsed = true;
const partiallyBoarded = start(1);
assert.ok(restoreRound(partiallyBoarded, serial(exportRound(moving)), pack).restored);
assert.equal(partiallyBoarded.boardedCount, 1);
assert.equal(partiallyBoarded.reviveUsed, true);

const valid = serial(exportRound(moving));
const changes = [
  round => { round.version = 99; },
  round => { round.levelSignature += 'changed'; },
  round => { round.passengerQueue.pop(); },
  round => { round.passengerQueue[0] = 'unknown'; },
  round => { round.vehicles[1].id = round.vehicles[0].id; },
  round => { round.vehicles[0].passengers = -1; },
  round => { round.vehicles[0].status = 'MOVING'; },
  round => { round.vehicles.find(v => v.status === 'DOCKED').dockIdx = 4; },
  round => { round.vehicles[0].isFrozen = true; },
  round => { round.tunnelBoardedCount = 999; },
  round => { round.vehicles[0] = null; }
];
for (const change of changes) {
  const corrupt = serial(valid);
  change(corrupt);
  const fresh = start(1);
  const before = serial(fresh);
  assert.equal(restoreRound(fresh, corrupt, pack).restored, false);
  assert.deepEqual(serial(fresh), before, 'Rejected snapshot mutated live state');
}
const injected = serial(valid);
injected.vehicles[0].capacity = 1000;
injected.vehicles[0].cells = [];
const trusted = start(1);
assert.equal(restoreRound(trusted, injected, pack).restored, true);
assert.equal(trusted.vehicles[0].capacity, 4);
assert.equal(trusted.vehicles[0].cells.length, 1);

// No charge or mutation on a blocked/invalid attempt, including solver budget exhaustion.
for (const kind of ['moving', 'invalid', 'no_stock', 'budget']) {
  const round = start(1);
  if (kind === 'moving') beginVehicleExit(round, round.vehicles[0]);
  if (kind === 'invalid') round.passengerQueue.pop();
  if (kind === 'no_stock') { round.vipLeft = 0; round.shufflesLeft = 0; }
  const before = serial(round);
  assert.equal(applySafeShuffle(round, random, { maxStates: 0 }).ok, false);
  assert.equal(applySafeVip(round, { maxStates: 0 }).ok, false);
  assert.deepEqual(serial(round), before);
}
// Failed rounds must reopen failure UI after restore, rather than resume hidden in a stopped state.
const report = JSON.parse(await readFile(new URL('../data/level-verification.json', import.meta.url)));
const failure = replaySolution(start(4), report.stages[3].randomPlay.failurePath);
const resumedFailure = start(4);
assert.ok(restoreRound(resumedFailure, serial(exportRound(failure)), pack).restored);
assert.equal(resumedFailure.isOver, false);
assert.equal(settlePuzzle(resumedFailure).isOver, true);
console.log(`Resume/booster validation passed: ${resumeCount} checkpoints, ${shuffleCount} safe shuffles, ${vipCount} VIP continuations, transient saves, corruption rejection, failed-round restoration.`);
