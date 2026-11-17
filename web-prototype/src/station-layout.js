// Presentation coordinates only. Vehicle cells, dock ownership and level seeds remain in the rules engine.
export function computeStationLayout(w, h, cols, rows, dockCount) {
  const compact = h < 740;
  const contentW = Math.min(w, 500);
  const left = (w - contentW) / 2;
  const queueTop = compact ? 149 : 164;
  const queueHeight = compact ? 76 : 100;
  const dockH = compact ? 65 : 78;
  const dockY = queueTop + queueHeight + 43;
  const dockW = Math.min(66, (contentW - 42 - (dockCount - 1) * 12) / dockCount);
  const gridTop = dockY + dockH / 2 + (compact ? 30 : 40);
  const cell = Math.max(16, Math.min((contentW - 44) / cols, (h - (compact ? 104 : 126) - gridTop) / rows, 72));
  const gridW = cell * cols, gridH = cell * rows;
  return { w, h, contentW, left, queueTop, queueHeight, queueY: queueTop + queueHeight - 10,
    dockY, dockW, dockH, gridTop, gridLeft: (w - gridW) / 2, gridW, gridH, cell };
}

// Head first: a visible serpentine queue, never sorted by hidden vehicle information.
export function getQueuePoint(index, metrics) {
  const columns = 12;
  const row = Math.floor(index / columns), col = index % columns;
  const direction = row % 2 ? -1 : 1;
  const step = Math.min(28, (metrics.contentW - 88) / (columns - 1));
  return { x: metrics.w / 2 + (direction * (col - 5.5)) * step,
    y: metrics.queueY - row * (metrics.queueHeight / 3.3) };
}

export function getExitWaypoints(metrics, direction, start, destination) {
  const { gridLeft, gridTop, gridW, gridH, dockY, dockH, left, contentW } = metrics;
  const laneY = dockY + dockH / 2 + 14;
  const sideX = direction === 'LEFT' ? left + 10 : left + contentW - 10;
  const points = direction === 'UP' ? [{ x: start.x, y: gridTop - 19 }]
    : direction === 'DOWN' ? [{ x: start.x, y: gridTop + gridH + 15 }, { x: sideX, y: gridTop + gridH + 15 }, { x: sideX, y: laneY }]
    : [{ x: direction === 'LEFT' ? Math.min(sideX, gridLeft - 8) : Math.max(sideX, gridLeft + gridW + 8), y: start.y }, { x: sideX, y: laneY }];
  points.push({ x: destination.x, y: laneY }, destination);
  return points;
}
