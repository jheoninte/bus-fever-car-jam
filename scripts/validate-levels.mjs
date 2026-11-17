import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSimState, VEHICLE_COLORS } from '../web-prototype/src/game-state.js';
import { normalizeStageSeed, buildStageState } from '../web-prototype/src/level-loader.js';
import { validateLevelDefinition } from '../web-prototype/src/level-schema.js';
import { getPassengerBalanceErrors } from '../web-prototype/src/puzzle-engine.js';
import { solvePuzzle, replaySolution, measureRandomPlay } from '../web-prototype/src/solver.js';

export async function validateLevelPack(root, { quiet = true } = {}) {
const pack = normalizeStageSeed(JSON.parse(await readFile(path.join(root, 'data/levels_seed.json'), 'utf8')));
const report = JSON.parse(await readFile(path.join(root, 'data/level-verification.json'), 'utf8'));
assert.equal(pack.schemaVersion, 2);
assert.deepEqual(pack.stages.map(stage => stage.stage), Array.from({ length: 20 }, (_, i) => i + 1));
assert.equal(new Set(VEHICLE_COLORS.map(c => c.symbol)).size, 6);
assert.equal(new Set(VEHICLE_COLORS.map(c => c.altSymbol)).size, 6);
assert.equal(report.stages.length, pack.stages.length);
for (const level of pack.stages) {
  assert.deepEqual(validateLevelDefinition(level), [], `Invalid stage ${level.stage}`);
  const state = buildStageState(createSimState(), level.stage, pack);
  state.shufflesLeft = 0;
  state.vipLeft = 0;
  assert.equal(state.dock.count, 4);
  assert.deepEqual(getPassengerBalanceErrors(state), []);
  const design = level.design;
  assert.equal(state.vehicles.length, design.vehicles);
  assert.equal(state.vehicles.filter(v => v.length === 2).length, design.buses);
  assert.equal(new Set(state.vehicles.map(v => v.colorId)).size, design.colors);
  for (const [tag, count] of [['mystery', design.mysteries], ['frozen', design.frozen], ['tunnel', design.tunnels]]) {
    assert.equal(state.vehicles.filter(v => v.gimmick === tag).length, count, `Stage ${level.stage}: ${tag} count`);
  }
  if (level.stage === 8) assert.ok(state.vehicles.some(v => v.gimmick === 'mystery' && v.length === 2));
  if (level.stage === 13) assert.ok(state.vehicles.some(v => v.gimmick === 'frozen' && v.length === 2));
  const solution = solvePuzzle(state);
  assert.equal(solution.status, 'solved', `Stage ${level.stage}: no verified path`);
  const replayed = replaySolution(state, solution.path);
  assert.equal(replayed.isClear, true);
  assert.equal(replayed.boardedCount, state.totalPassengers);
  assert.equal(replayed.passengerQueue.length, 0);
  assert.equal(replayed.shufflesLeft, 0);
  assert.equal(replayed.vipLeft, 0);
  if (level.stage >= 16) assert.ok(replayed.tunnelBoardedCount > 0, `Stage ${level.stage}: tutorial solution must exercise tunnel`);
  const random = measureRandomPlay(state, { runs: 100, seed: 17000 + level.stage });
  if (level.stage >= 4) {
    assert.ok(random.failurePath, `Stage ${level.stage}: missing reachable failure branch`);
    assert.equal(replaySolution(state, random.failurePath).isOver, true);
  }
  const recorded = report.stages.find(item => item.stage === level.stage);
  assert.equal(recorded.seed, level.seed);
  assert.deepEqual(recorded.solution, solution.path, 'Regenerate the level verification report');
  assert.deepEqual(recorded.randomPlay, random, 'Regenerate the random play report');
  assert.equal(recorded.tunnelBoarded, replayed.tunnelBoardedCount);
  if (!quiet) console.log(`Stage ${level.stage}: solved, ${solution.visited} states, random wins ${random.wins}/100.`);
}
return { stages: pack.stages.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await validateLevelPack(fileURLToPath(new URL('../', import.meta.url)), { quiet: process.argv.includes('--quiet') });
  console.log('Level validation passed: 20 replayed no-booster solutions, color conservation, gimmick progression, seeded random-play report.');
}
