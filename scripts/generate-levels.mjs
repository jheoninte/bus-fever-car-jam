import { writeFile } from 'node:fs/promises';
import { DIRECTIONS, VEHICLE_COLORS, createSimState } from '../web-prototype/src/game-state.js';
import { buildStageState } from '../web-prototype/src/level-loader.js';
import { replaySolution, solvePuzzle, measureRandomPlay } from '../web-prototype/src/solver.js';

const profiles = [
  [4, 0, 2, 0, 0, 0, 20, 35, '같은 색 승객 태우기'],
  [5, 1, 2, 0, 0, 0, 30, 45, '버스와 정류장 회전'],
  [6, 1, 3, 0, 0, 0, 35, 50, '세 가지 색의 순서'],
  [7, 2, 3, 0, 0, 0, 40, 60, '앞길을 여는 순서'],
  [8, 2, 4, 0, 0, 0, 50, 75, '빈 정류장 남기기'],
  [7, 1, 3, 2, 0, 0, 45, 65, '물음표 차량 발견'],
  [8, 2, 3, 3, 0, 0, 50, 70, '공개와 출발의 순서'],
  [9, 2, 4, 3, 0, 0, 55, 80, '물음표 버스'],
  [9, 3, 4, 4, 0, 0, 60, 85, '숨겨진 길 열기'],
  [10, 3, 4, 5, 0, 0, 70, 95, '물음표 종합 연습'],
  [8, 1, 3, 0, 1, 0, 50, 75, '얼음 해제색 찾기'],
  [9, 2, 4, 0, 2, 0, 60, 85, '순서대로 해동하기'],
  [10, 3, 4, 0, 2, 0, 65, 90, '얼어붙은 버스'],
  [10, 3, 5, 2, 2, 0, 75, 100, '물음표와 얼음'],
  [11, 3, 5, 0, 3, 0, 80, 110, '해동 순서의 선택'],
  [9, 1, 4, 0, 0, 1, 60, 85, '같은 색 터널 탑승'],
  [10, 2, 4, 0, 0, 2, 65, 95, '뒤쪽 승객 먼저 태우기'],
  [11, 3, 5, 0, 1, 2, 75, 105, '터널과 얼음'],
  [12, 4, 5, 1, 1, 2, 85, 115, '세 기믹 연결하기'],
  [13, 4, 6, 2, 1, 2, 90, 120, '첫 번째 챕터 완성']
];
const tutorials = [
  '앞길이 트인 차를 누르면 같은 색 승객이 정류장에서 자동으로 탑승해요.',
  '물음표 차량은 정류장에 도착하면 색이 공개돼요. 빈 칸을 남겨 두세요.',
  '얼음에 표시된 색의 승객이 맨 앞에 도착하면 얼음이 풀려요.',
  '터널 차량은 대기열 뒤쪽에 있는 같은 색 승객도 먼저 태울 수 있어요.'
];
function rngFor(seed) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
function shuffle(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function candidateFor(stage, profile, seed) {
  const [count, buses, colors, mysteries, frozen, tunnels, minTime, maxTime, title] = profile;
  const random = rngFor(seed);
  const cols = stage <= 3 ? 5 : 6;
  const rows = cols;
  const busIds = new Set(shuffle(Array.from({ length: count }, (_, i) => i), random).slice(0, buses));
  const vehicles = [];
  const occupied = new Set();
  const directions = Object.keys(DIRECTIONS);
  for (let i = 0; i < count; i++) {
    let placed = false;
    const length = busIds.has(i) ? 2 : 1;
    for (let attempt = 0; attempt < 1500; attempt++) {
      const dir = directions[Math.floor(random() * directions.length)];
      const direction = DIRECTIONS[dir];
      const head = { c: Math.floor(random() * cols), r: Math.floor(random() * rows) };
      const cells = Array.from({ length }, (_, offset) => ({ c: head.c - direction.dc * offset, r: head.r - direction.dr * offset }));
      if (cells.some(cell => cell.c < 0 || cell.r < 0 || cell.c >= cols || cell.r >= rows || occupied.has(`${cell.c},${cell.r}`))) continue;
      let clear = true;
      for (let c = head.c + direction.dc, r = head.r + direction.dr; c >= 0 && r >= 0 && c < cols && r < rows; c += direction.dc, r += direction.dr) {
        if (occupied.has(`${c},${r}`)) { clear = false; break; }
      }
      if (!clear) continue;
      cells.forEach(cell => occupied.add(`${cell.c},${cell.r}`));
      vehicles.push({ id: `v_${i + 1}`, colorId: VEHICLE_COLORS[i % colors].id, dir, length, cells, gimmick: 'normal' });
      placed = true;
      break;
    }
    if (!placed) return null;
  }
  const order = [...vehicles].reverse();
  const groupSize = stage <= 3 ? 1 : stage >= 9 ? 3 : 2;
  const tunnelCandidates = order.map((_, i) => i).filter(i => i % groupSize === 0 && i + 1 < order.length);
  for (const index of tunnelCandidates.slice(0, tunnels)) order[index].gimmick = 'tunnel';
  if (order.filter(v => v.gimmick === 'tunnel').length !== tunnels) return null;
  const frozenCandidates = shuffle(order.map((_, i) => i).filter(i => i >= groupSize && order[i].gimmick === 'normal'), random);
  for (const index of frozenCandidates.slice(0, frozen)) {
    const previous = order.slice(0, index - index % groupSize).filter(v => v.colorId !== order[0].colorId);
    if (!previous.length) return null;
    order[index].gimmick = 'frozen';
    order[index].unlockColorId = previous[previous.length - 1].colorId;
  }
  const mysteryCandidates = shuffle(order.filter(v => v.gimmick === 'normal'), random);
  for (const vehicle of mysteryCandidates.slice(0, mysteries)) vehicle.gimmick = 'mystery';
  const passengerQueue = [];
  for (let offset = 0; offset < order.length; offset += groupSize) {
    let group = order.slice(offset, offset + groupSize);
    if (group[0].gimmick === 'tunnel' && group.length > 1) group = [...group.slice(1), group[0]];
    const passengers = group.map(v => ({ color: v.colorId, remaining: v.length === 2 ? 6 : 4 }));
    while (passengers.some(item => item.remaining > 0)) {
      for (const item of passengers) {
        const take = Math.min(2, item.remaining);
        passengerQueue.push(...Array(take).fill(item.color));
        item.remaining -= take;
      }
    }
  }
  return { stage, seed, title, cols, rows, dockCount: 4, slotLimit: 4, tutorial: tutorials[Math.floor((stage - 1) / 5)],
    design: { vehicles: count, buses, colors, mysteries, frozen, tunnels, targetSeconds: [minTime, maxTime] },
    vehicles, passengerQueue, constructionPath: order.map(vehicle => vehicle.id) };
}

const stages = [];
const report = [];
for (let index = 0; index < profiles.length; index++) {
  const stage = index + 1;
  let accepted = null;
  for (let attempt = 0; attempt < 600; attempt++) {
    const seed = stage * 1009 + attempt * 7919;
    const candidate = candidateFor(stage, profiles[index], seed);
    if (!candidate) continue;
    const state = buildStageState(createSimState(), stage, { stages: [candidate] });
    try { if (!replaySolution(state, candidate.constructionPath).isClear) continue; } catch { continue; }
    const randomPlay = measureRandomPlay(state, { runs: 100, seed: 17000 + stage });
    if (stage >= 4 && !randomPlay.failurePath) continue;
    const solution = solvePuzzle(state, { maxStates: 30000 });
    const replayed = solution.path ? replaySolution(state, solution.path) : null;
    if (solution.status !== 'solved' || !replayed.isClear) continue;
    if (stage >= 16 && !replayed.tunnelBoardedCount) continue;
    if (stage === 8 && !candidate.vehicles.some(v => v.gimmick === 'mystery' && v.length === 2)) continue;
    if (stage === 13 && !candidate.vehicles.some(v => v.gimmick === 'frozen' && v.length === 2)) continue;
    const { constructionPath, ...level } = candidate;
    accepted = level;
    report.push({ stage, seed, solution: solution.path, visited: solution.visited, tunnelBoarded: replayed.tunnelBoardedCount, randomPlay });
    console.log(`Stage ${stage}: ${solution.path.length} exits, random wins ${randomPlay.wins}/${randomPlay.runs}, seed ${seed}`);
    break;
  }
  if (!accepted) throw new Error(`Could not construct verified stage ${stage}`);
  stages.push(accepted);
}
await writeFile(new URL('../data/levels_seed.json', import.meta.url), `${JSON.stringify({ schemaVersion: 2, stages }, null, 2)}\n`);
await writeFile(new URL('../data/level-verification.json', import.meta.url), `${JSON.stringify({
  solverPolicy: 'sequential exits with automatic boarding to quiescence; no boosters, ads or purchases',
  randomPlayPolicy: 'uniform random legal vehicle, settle after each exit; 100 seeded runs per level', stages: report
}, null, 2)}\n`);
console.log(`Generated ${stages.length} authored levels with replayed solutions.`);
