import { MAP_CONFIG } from "../models/mapData.js";

const DEFAULT_GRID = 120;

export function buildNavGrid(mapData, gridSize) {
  const size = gridSize || DEFAULT_GRID;
  const cols = Math.ceil(MAP_CONFIG.width / size);
  const rows = Math.ceil(MAP_CONFIG.height / size);
  const blocked = new Array(cols * rows).fill(false);
  const roadDist = new Array(cols * rows).fill(Infinity);

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const index = y * cols + x;
      const cx = x * size + size / 2;
      const cy = y * size + size / 2;

      if (mapData.buildings) {
        for (let i = 0; i < mapData.buildings.length; i += 1) {
          const b = mapData.buildings[i];
          const padded = {
            x: b.x - 16,
            y: b.y - 16,
            width: b.width + 32,
            height: b.height + 32
          };
          if (rectContainsPoint(padded, cx, cy) || rectIntersectsCell(padded, x * size, y * size, size, size)) {
            blocked[index] = true;
            break;
          }
        }
      }

      if (mapData.roads && mapData.roads.length > 0) {
        let best = Infinity;
        for (let r = 0; r < mapData.roads.length; r += 1) {
          const road = mapData.roads[r];
          if (road.points && road.points.length >= 2) {
            for (let s = 0; s < road.points.length - 1; s += 1) {
              const d = distancePointToSegment(
                { x: cx, y: cy },
                road.points[s],
                road.points[s + 1]
              );
              if (d < best) {
                best = d;
              }
            }
          }
        }
        roadDist[index] = best;
      }
    }
  }

  return {
    gridSize: size,
    cols: cols,
    rows: rows,
    blocked: blocked,
    roadDist: roadDist
  };
}

export function findPath(start, goal, unit, nav) {
  if (!nav) {
    return [];
  }
  if (unit && unit.category === "Aircraft") {
    return [goal];
  }
  const startNode = worldToCell(start, nav);
  const goalNode = worldToCell(goal, nav);

  const startIndex = startNode.y * nav.cols + startNode.x;
  const goalIndex = goalNode.y * nav.cols + goalNode.x;

  if (nav.blocked[startIndex] || nav.blocked[goalIndex]) {
    return [goal];
  }

  const open = [startIndex];
  const cameFrom = new Array(nav.cols * nav.rows).fill(-1);
  const gScore = new Array(nav.cols * nav.rows).fill(Infinity);
  const fScore = new Array(nav.cols * nav.rows).fill(Infinity);
  gScore[startIndex] = 0;
  fScore[startIndex] = heuristic(startNode, goalNode);

  let iterations = 0;
  const maxIterations = nav.cols * nav.rows * 4;

  while (open.length > 0 && iterations < maxIterations) {
    iterations += 1;
    let currentIndex = open[0];
    let bestF = fScore[currentIndex];
    let bestIdx = 0;
    for (let i = 1; i < open.length; i += 1) {
      const idx = open[i];
      if (fScore[idx] < bestF) {
        bestF = fScore[idx];
        currentIndex = idx;
        bestIdx = i;
      }
    }

    if (currentIndex === goalIndex) {
      return reconstructPath(cameFrom, currentIndex, nav);
    }

    open.splice(bestIdx, 1);
    const current = indexToCell(currentIndex, nav);
    const neighbors = getNeighbors(current, nav);

    for (let n = 0; n < neighbors.length; n += 1) {
      const neighbor = neighbors[n];
      const neighborIndex = neighbor.y * nav.cols + neighbor.x;
      if (nav.blocked[neighborIndex]) {
        continue;
      }
      const stepCost = movementCost(neighbor, nav, unit) * (neighbor.diagonal ? 1.4 : 1);
      const tentative = gScore[currentIndex] + stepCost;
      if (tentative < gScore[neighborIndex]) {
        cameFrom[neighborIndex] = currentIndex;
        gScore[neighborIndex] = tentative;
        fScore[neighborIndex] = tentative + heuristic(neighbor, goalNode);
        if (!arrayContains(open, neighborIndex)) {
          open.push(neighborIndex);
        }
      }
    }
  }

  return [];
}

function movementCost(cell, nav, unit) {
  const index = cell.y * nav.cols + cell.x;
  if (!unit || !unit.usesRoads) {
    return 1;
  }
  const dist = nav.roadDist[index];
  if (dist < nav.gridSize * 0.55) {
    return 0.6;
  }
  return 1.25;
}

function reconstructPath(cameFrom, currentIndex, nav) {
  const points = [];
  let cur = currentIndex;
  while (cur !== -1) {
    const cell = indexToCell(cur, nav);
    points.push({
      x: cell.x * nav.gridSize + nav.gridSize / 2,
      y: cell.y * nav.gridSize + nav.gridSize / 2
    });
    cur = cameFrom[cur];
  }
  points.reverse();
  return points;
}

function getNeighbors(cell, nav) {
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: -1 }
  ];
  const neighbors = [];
  for (let i = 0; i < dirs.length; i += 1) {
    const nx = cell.x + dirs[i].dx;
    const ny = cell.y + dirs[i].dy;
    if (nx < 0 || ny < 0 || nx >= nav.cols || ny >= nav.rows) {
      continue;
    }
    neighbors.push({ x: nx, y: ny, diagonal: dirs[i].dx !== 0 && dirs[i].dy !== 0 });
  }
  return neighbors;
}

function worldToCell(point, nav) {
  const x = Math.min(nav.cols - 1, Math.max(0, Math.floor(point.x / nav.gridSize)));
  const y = Math.min(nav.rows - 1, Math.max(0, Math.floor(point.y / nav.gridSize)));
  return { x: x, y: y };
}

function indexToCell(index, nav) {
  const y = Math.floor(index / nav.cols);
  const x = index - y * nav.cols;
  return { x: x, y: y };
}

function heuristic(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function arrayContains(arr, value) {
  for (let i = 0; i < arr.length; i += 1) {
    if (arr[i] === value) {
      return true;
    }
  }
  return false;
}

function rectContainsPoint(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function rectIntersectsCell(rect, x, y, w, h) {
  return !(
    rect.x + rect.width < x ||
    rect.x > x + w ||
    rect.y + rect.height < y ||
    rect.y > y + h
  );
}

function distancePointToSegment(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const abLen = abx * abx + aby * aby || 1;
  let t = (apx * abx + apy * aby) / abLen;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  return Math.hypot(point.x - cx, point.y - cy);
}
