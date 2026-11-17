import { getQueuePoint } from './station-layout.js';

const ink = 0x23485a;
export const blendColor = (a, b, t) => [16, 8, 0].reduce((n, shift) => n | Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t) << shift, 0);

export function paintToyBus(g, { color, width, length, direction = 'UP', seats = 4, filled = 0, mystery = false, frozen = false, tunnel = false, hint = false }) {
  const w = width, h = length;
  const angle = { UP: 0, RIGHT: Math.PI / 2, DOWN: Math.PI, LEFT: -Math.PI / 2 }[direction];
  const light = blendColor(color, 0xffffff, .38), dark = blendColor(color, 0x142c44, .32);
  g.clear();
  g.save(); g.rotateCanvas(angle);
  g.fillStyle(0x294e61, .18); g.fillRoundedRect(-w / 2 + 2, -h / 2 + 7, w + 3, h, w * .2);
  // Four protruding rubber wheels, chassis and a deep colored skirt give the body height.
  for (const y of [-h * .27, h * .29]) {
    g.fillStyle(0x233546); g.fillRoundedRect(-w / 2 - 3, y - 5, 7, 12, 3);
    g.fillRoundedRect(w / 2 - 4, y - 5, 7, 12, 3);
    g.fillStyle(0x8ca1ad); g.fillRect(-w / 2 - 2, y - 2, 2, 5); g.fillRect(w / 2 + 1, y - 2, 2, 5);
  }
  g.fillStyle(dark); g.fillRoundedRect(-w / 2, -h / 2 + 4, w, h, 9);
  g.fillStyle(color); g.fillRoundedRect(-w / 2, -h / 2, w, h - 3, 9);
  g.fillStyle(light); g.fillRoundedRect(-w / 2 + 3, -h / 2 + 2, w - 6, h - 11, 7);
  // White side rails and three pairs of tinted passenger windows.
  for (const side of [-1, 1]) {
    const x = side < 0 ? -w / 2 + 1 : w / 2 - 6;
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0x215470); g.fillRoundedRect(x, -h * .16 + i * h * .155, 5, h * .12, 2);
      g.fillStyle(0x8edbea, .7); g.fillRect(x + 1, -h * .16 + i * h * .155 + 1, 2, h * .07);
    }
    g.fillStyle(0xffffff, .55); g.fillRoundedRect(x, h * .38, 5, 3, 1);
  }
  g.fillStyle(0x25485b); g.fillRoundedRect(-w * .35, -h / 2 + 5, w * .7, h * .21, 5);
  g.fillStyle(0x69c5e7); g.fillRoundedRect(-w * .3, -h / 2 + 6, w * .59, h * .14, 3);
  g.fillStyle(0xc9f5fa, .8); g.fillTriangle(-w * .27, -h / 2 + 7, w * .1, -h / 2 + 7, -w * .27, -h / 2 + h * .15);
  g.fillStyle(0xf3f5de); g.fillRoundedRect(-w * .45, h / 2 - 7, w * .9, 5, 2);
  for (const x of [-w * .34, w * .25]) {
    g.fillStyle(0xfff4b2); g.fillRoundedRect(x, -h / 2 + 2, w * .1, 4, 1);
    g.fillStyle(0xff7868); g.fillRect(x, h / 2 - 4, w * .1, 2);
  }
  // Seat lights also work without color: the individual filled seats remain countable.
  for (let i = 0; i < seats; i++) {
    const x = (i % 2 ? 1 : -1) * w * .12, y = -h * .04 + Math.floor(i / 2) * h * .12;
    g.fillStyle(i < filled ? 0xfff7be : dark, i < filled ? 1 : .26); g.fillCircle(x, y, Math.max(1.8, w * .055));
  }
  // Roof direction arrow. The permanent occupancy chip is rendered separately upright.
  if (!mystery) {
    const s = Math.min(w * .23, h * .14), y = h * .13;
    g.lineStyle(Math.max(5, w * .16), dark, .65); g.lineBetween(0, y + s, 0, y - s * .8);
    g.lineStyle(Math.max(3, w * .105), 0xffffff, 1); g.lineBetween(0, y + s, 0, y - s * .8);
    g.fillStyle(0xffffff); g.fillTriangle(0, y - s * 1.35, -s * .75, y - s * .25, s * .75, y - s * .25);
  }
  if (mystery) {
    g.lineStyle(2, 0xffffff, .6);
    for (let y = -h * .15; y < h * .35; y += 8) g.lineBetween(-w * .22, y, w * .22, y + 5);
  }
  if (frozen) {
    g.fillStyle(0xbcefff, .35); g.fillRoundedRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 8, 9);
    g.lineStyle(2, 0xeaffff, .9); g.strokeRoundedRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 8, 9);
  }
  if (tunnel) { g.lineStyle(3, 0xe9b5ff); g.strokeCircle(0, h * .12, w * .26); }
  if (hint) {
    g.lineStyle(4, 0xffd349); g.strokeRoundedRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 15, 12);
    g.lineStyle(1.5, 0xffffff); g.strokeRoundedRect(-w / 2 - 8, -h / 2 - 8, w + 16, h + 19, 14);
  }
  g.restore();
}

// Small articulated toy people. A gait tween moves the two legs in opposite phases.
export function createToyPassenger(scene, color, symbol, size = 1) {
  const holder = scene.add.container(0, 0);
  const shadow = scene.add.ellipse(0, 8, 15, 6, 0x264c45, .18);
  const leftLeg = scene.add.rectangle(-3, 5, 4.5, 8, blendColor(color, 0x193c57, .25)).setOrigin(.5, 0);
  const rightLeg = scene.add.rectangle(3, 5, 4.5, 8, blendColor(color, 0x193c57, .25)).setOrigin(.5, 0);
  const body = scene.add.graphics();
  body.fillStyle(blendColor(color, 0x16384c, .2)); body.fillRoundedRect(-7, -4, 14, 14, 5);
  body.fillStyle(color); body.fillRoundedRect(-7, -6, 14, 13, 5);
  body.fillStyle(blendColor(color, 0xffffff, .22)); body.fillEllipse(-1, -2, 10, 7);
  body.fillStyle(blendColor(color, 0x153748, .15)); body.fillCircle(0, -10, 8.5);
  body.fillStyle(color); body.fillCircle(0, -12, 8.2);
  body.fillStyle(0xffffff, .28); body.fillEllipse(-2.5, -15, 7, 4);
  body.fillStyle(color); body.fillRoundedRect(-10, -3, 4, 9, 2); body.fillRoundedRect(6, -3, 4, 9, 2);
  const label = scene.add.text(0, -10, symbol, { fontFamily: 'Arial, sans-serif', fontSize: '7px', fontStyle: 'bold', color: '#ffffff', stroke: '#23485a', strokeThickness: 1.5 }).setOrigin(.5);
  holder.add([shadow, leftLeg, rightLeg, body, label]); holder.setScale(size);
  holder.setData({ leftLeg, rightLeg, body, symbol: label, baseScale: size });
  return holder;
}

function tree(g, x, y, size = 1) {
  g.fillStyle(0x33664c, .16); g.fillEllipse(x + 3, y + 11 * size, 38 * size, 16 * size);
  g.fillStyle(0x9c7956); g.fillRoundedRect(x - 3 * size, y - 3 * size, 6 * size, 16 * size, 2);
  for (const [dx, dy, r, color] of [[0, -10, 17, 0x4a9d64], [-9, -9, 12, 0x5aad6b], [8, -16, 13, 0x78c77c], [-3, -21, 11, 0x9ad78b]]) {
    g.fillStyle(color); g.fillCircle(x + dx * size, y + dy * size, r * size);
  }
}

export function paintStationEnvironment(scene, g, m, state) {
  const { w, h, contentW, left, queueTop, queueHeight, dockY, dockW, dockH, gridLeft, gridTop, gridW, gridH, cell } = m;
  g.clear();
  g.fillStyle(0xc8e6b7); g.fillRect(0, 0, w, h);
  g.fillStyle(0xd9efc9); g.fillRoundedRect(left + 6, 75, contentW - 12, h - 85, 45);
  // Landscaped edges, with fixed decorative positions independent of level randomness.
  for (let i = 0; i < 16; i++) {
    const x = left + 12 + (i * 67) % Math.max(contentW - 24, 1), y = 155 + (i * 113) % Math.max(h - 230, 1);
    g.fillStyle(i % 2 ? 0xa5cf8e : 0xb2d99b, .7); g.fillEllipse(x, y, 11, 5);
    if (i % 3 === 0) { g.fillStyle(0xffffee); g.fillCircle(x + 4, y - 2, 2); g.fillStyle(0xf7c94f); g.fillCircle(x + 4, y - 2, .8); }
  }
  // Crowd concourse and continuous curb. The clear strip below is the walking route.
  g.fillStyle(0x86979c, .2); g.fillRoundedRect(left + 25, queueTop - 14, contentW - 50, queueHeight + 44, 24);
  g.fillStyle(0xf4f0dd); g.fillRoundedRect(left + 22, queueTop - 17, contentW - 44, queueHeight + 39, 24);
  g.fillStyle(0xd8d5c1); g.fillRoundedRect(left + 29, queueTop - 11, contentW - 58, queueHeight + 25, 19);
  g.fillStyle(0xb7bab1); g.fillRoundedRect(left + 33, queueTop - 8, contentW - 66, queueHeight + 17, 16);
  // A paved bus lane runs behind the four numbered boarding bays.
  const roadTop = dockY - dockH / 2 - 13;
  g.fillStyle(0x8d999f); g.fillRoundedRect(left + 7, roadTop - 6, contentW - 14, dockH + 36, 18);
  g.fillStyle(0xf6f6e8); g.fillRoundedRect(left + 7, roadTop - 10, contentW - 14, dockH + 33, 18);
  g.fillStyle(0x7c8992); g.fillRoundedRect(left + 8, roadTop - 5, contentW - 16, dockH + 31, 17);
  for (let x = left + 18; x < left + contentW - 22; x += 24) {
    g.fillStyle(0xf5efd0, .7); g.fillRoundedRect(x, roadTop + dockH + 16, 12, 2, 1);
  }
  // Parking plaza is asphalt, not a board of dark clickable squares.
  g.fillStyle(0x94a1a4, .3); g.fillRoundedRect(gridLeft - 13, gridTop - 11, gridW + 26, gridH + 29, 24);
  g.fillStyle(0xf5f4e9); g.fillRoundedRect(gridLeft - 13, gridTop - 16, gridW + 26, gridH + 29, 24);
  g.fillStyle(0xb9c4ce); g.fillRoundedRect(gridLeft - 10, gridTop - 13, gridW + 20, gridH + 23, 20);
  g.fillStyle(0xcbd4df); g.fillRoundedRect(gridLeft - 7, gridTop - 10, gridW + 14, gridH + 18, 18);
  for (let r = 0; r < state.rows; r++) for (let c = 0; c < state.cols; c++) {
    const x = gridLeft + c * cell, y = gridTop + r * cell;
    g.lineStyle(1.5, 0xf7fafc, .53);
    g.lineBetween(x + 6, y + cell - 4, x + 6, y + cell - 10);
    g.lineBetween(x + 6, y + cell - 4, x + cell - 6, y + cell - 4);
    g.lineBetween(x + cell - 6, y + cell - 4, x + cell - 6, y + cell - 10);
  }
  const docks = [], total = state.dockCount * dockW + (state.dockCount - 1) * 12;
  for (let i = 0; i < state.dockCount; i++) {
    const x = (w - total) / 2 + i * (dockW + 12), y = dockY - dockH / 2;
    g.fillStyle(0x566a76, .34); g.fillRoundedRect(x, y, dockW, dockH, 9);
    g.lineStyle(2, 0xf7f7e9, .9); g.strokeRoundedRect(x, y, dockW, dockH, 9);
    g.fillStyle(0xffffff, .16); g.fillRoundedRect(x + 6, y + 6, dockW - 12, dockH - 12, 5);
    docks.push({ x: x + dockW / 2, y: dockY });
    // Mini crossing from the crowd's curb to each bus door.
    for (let j = 0; j < 3; j++) { g.fillStyle(0xfff9e8, .85); g.fillRect(x + dockW - 8, y - 12 + j * 3, 11, 1.5); }
  }
  tree(g, left + 17, queueTop + 20, .65); tree(g, left + contentW - 15, queueTop + 42, .7);
  tree(g, left + 13, gridTop + gridH - 13, .6); tree(g, left + contentW - 9, gridTop + 22, .64);
  // A little shelter with a blue roof and bench along the waiting area.
  g.fillStyle(0x5c889b, .2); g.fillRoundedRect(w / 2 - 34, queueTop - 24, 72, 16, 6);
  g.fillStyle(0x4595b3); g.fillRoundedRect(w / 2 - 35, queueTop - 28, 70, 12, 5);
  g.fillStyle(0x92dbe6); g.fillRoundedRect(w / 2 - 32, queueTop - 29, 64, 6, 3);
  return docks;
}
