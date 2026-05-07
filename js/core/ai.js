import { MAP_CONFIG } from "../models/mapData.js";
import { createUnitFromTemplate, findTemplateById } from "../models/unitDictionary.js";

export function predictBestPositions(state, placedUnits, templates, mapData) {
  const enemyUnits = placedUnits.filter((u) => u.faction === "Enemy");
  let anchor = { x: MAP_CONFIG.width * 0.2, y: MAP_CONFIG.height * 0.5 };

  if (enemyUnits.length === 0) {
    const enemyAnchor = pickEnemyAnchor(mapData);
    const enemyTemplates = buildEnemyTemplateIds();
    const enemyCandidates = buildCandidatePoints(enemyAnchor, 900, 180);
    const enemyBounds = {
      minX: MAP_CONFIG.width * 0.55,
      maxX: MAP_CONFIG.width - 160,
      minY: 160,
      maxY: MAP_CONFIG.height - 160
    };
    const createdEnemies = [];
    for (let i = 0; i < enemyTemplates.length; i += 1) {
      const template = findTemplateById(enemyTemplates[i]) || templates[0];
      if (!template) {
        continue;
      }
      const point = pickBestPoint(template, enemyCandidates, createdEnemies, [], mapData, scoreDefensivePoint, enemyBounds);
      if (!point) {
        continue;
      }
      const unit = createUnitFromTemplate(template, "Enemy", point.x, point.y);
      createdEnemies.push(unit);
    }
    createdEnemies.forEach((unit) => placedUnits.push(unit));
  }

  const updatedEnemies = placedUnits.filter((u) => u.faction === "Enemy");

  if (updatedEnemies.length > 0) {
    let sumX = 0;
    let sumY = 0;
    updatedEnemies.forEach((u) => {
      sumX += u.x;
      sumY += u.y;
    });
    anchor = { x: Math.max(400, sumX / updatedEnemies.length - 900), y: sumY / updatedEnemies.length };
  }

  const needsAirDefense = updatedEnemies.some((u) => u.category === "Aircraft");
  const enemyHasArmor = updatedEnemies.some((u) => u.armor === "Light" || u.armor === "Heavy");

  const templateIds = ["rifle_squad", "rifle_squad", "sniper_team", "mbt", "ifv", "spg"];
  if (needsAirDefense) {
    templateIds.push("sam_battery");
  }
  if (enemyHasArmor) {
    templateIds.push("at_team");
  }

  const created = [];
  const candidates = buildCandidatePoints(anchor, 900, 180);
  const playerBounds = {
    minX: 160,
    maxX: MAP_CONFIG.width * 0.6,
    minY: 160,
    maxY: MAP_CONFIG.height - 160
  };

  for (let i = 0; i < templateIds.length; i += 1) {
    const template = findTemplateById(templateIds[i]) || templates[0];
    if (!template) {
      continue;
    }
    const point = pickBestPoint(template, candidates, created, updatedEnemies, mapData, scorePoint, playerBounds);
    if (!point) {
      continue;
    }
    const unit = createUnitFromTemplate(template, "Player", point.x, point.y);
    created.push(unit);
  }

  created.forEach((unit) => placedUnits.push(unit));
  state.selectedUnitId = null;
  return created;
}

export function suggestAdjustments(placedUnits, mapData) {
  if (mapData.hills.length > 0) {
    const highest = mapData.hills.reduce((best, hill) => {
      return hill.elevation > best.elevation ? hill : best;
    }, mapData.hills[0]);

    const snipers = placedUnits.filter((u) => u.templateId === "sniper_team");
    for (let i = 0; i < snipers.length; i += 1) {
      const angle = (Math.PI * 2 * i) / Math.max(1, snipers.length);
      snipers[i].x = highest.x + Math.cos(angle) * (highest.radius * 0.4);
      snipers[i].y = highest.y + Math.sin(angle) * (highest.radius * 0.4);
    }
  }

  if (mapData.roads.length > 0) {
    for (let i = 0; i < placedUnits.length; i += 1) {
      const unit = placedUnits[i];
      if (unit.category !== "Vehicle" && unit.category !== "Artillery") {
        continue;
      }
      const best = findClosestRoadPoint(unit, mapData.roads);
      if (best) {
        unit.x = best.x;
        unit.y = best.y;
      }
    }
  }
}

function buildCandidatePoints(anchor, radius, step) {
  const points = [];
  const span = radius || 800;
  const stride = step || 200;
  for (let y = -span; y <= span; y += stride) {
    for (let x = -span; x <= span; x += stride) {
      points.push({ x: anchor.x + x, y: anchor.y + y });
    }
  }
  return points;
}

function pickBestPoint(template, candidates, placed, enemies, mapData, scoreFn, bounds) {
  let best = null;
  let bestScore = -Infinity;
  const enemyCenter = getEnemyCenter(enemies);
  const scorer = scoreFn || scorePoint;

  for (let i = 0; i < candidates.length; i += 1) {
    const point = candidates[i];
    if (!isPointInBounds(point, bounds)) {
      continue;
    }
    if (isInsideBuilding(point, mapData)) {
      continue;
    }
    if (tooCloseToUnits(point, placed, 120)) {
      continue;
    }
    const score = scorer(template, point, enemyCenter, mapData);
    if (score > bestScore) {
      bestScore = score;
      best = point;
    }
  }
  return best;
}

function scorePoint(template, point, enemyCenter, mapData) {
  let score = 0;
  if (enemyCenter) {
    const dist = Math.hypot(point.x - enemyCenter.x, point.y - enemyCenter.y);
    const desired = Math.max(300, template.range * 0.7);
    score -= Math.abs(dist - desired) * 0.002;
  }

  const hill = getHillBonus(point, mapData);
  if (template.id === "sniper_team" || template.category === "Artillery") {
    score += hill * 2.2;
  } else {
    score += hill * 0.6;
  }

  const roadDist = distanceToRoad(point, mapData);
  if ((template.category === "Vehicle" || template.category === "Artillery") && roadDist < 160) {
    score += 2.2 - roadDist * 0.008;
  }

  if (template.category === "Infantry") {
    const cover = distanceToBuilding(point, mapData);
    if (cover > 0 && cover < 160) {
      score += 1.8 - cover * 0.01;
    }
  }

  return score + Math.random() * 0.05;
}

function scoreDefensivePoint(template, point, enemyCenter, mapData) {
  let score = 0;
  const hill = getHillBonus(point, mapData);
  if (template.id === "sniper_team" || template.category === "Artillery") {
    score += hill * 2.4;
  } else {
    score += hill * 0.9;
  }

  const roadDist = distanceToRoad(point, mapData);
  if ((template.category === "Vehicle" || template.category === "Artillery") && roadDist < 200) {
    score += 2.0 - roadDist * 0.006;
  }

  if (template.category === "Infantry") {
    const cover = distanceToBuilding(point, mapData);
    if (cover > 0 && cover < 140) {
      score += 1.6 - cover * 0.012;
    }
  }

  score += (point.x / MAP_CONFIG.width) * 0.6;
  return score + Math.random() * 0.05;
}

function getEnemyCenter(enemies) {
  if (!enemies || enemies.length === 0) {
    return null;
  }
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < enemies.length; i += 1) {
    sumX += enemies[i].x;
    sumY += enemies[i].y;
  }
  return { x: sumX / enemies.length, y: sumY / enemies.length };
}

function isPointInBounds(point, bounds) {
  if (!bounds) {
    return point.x >= 0 && point.x <= MAP_CONFIG.width && point.y >= 0 && point.y <= MAP_CONFIG.height;
  }
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

function pickEnemyAnchor(mapData) {
  if (mapData.hills && mapData.hills.length > 0) {
    const highest = mapData.hills.reduce((best, hill) => {
      return hill.elevation > best.elevation ? hill : best;
    }, mapData.hills[0]);
    return {
      x: Math.max(MAP_CONFIG.width * 0.55, highest.x + highest.radius * 0.2),
      y: highest.y
    };
  }
  return { x: MAP_CONFIG.width * 0.75, y: MAP_CONFIG.height * 0.5 };
}

function buildEnemyTemplateIds() {
  const ids = ["rifle_squad", "rifle_squad", "at_team", "heavy_weapons_team", "sniper_team", "mbt", "ifv", "spg"];
  if (Math.random() < 0.4) {
    ids.push("sam_battery");
  }
  return ids;
}

function tooCloseToUnits(point, units, minDist) {
  for (let i = 0; i < units.length; i += 1) {
    const dist = Math.hypot(point.x - units[i].x, point.y - units[i].y);
    if (dist < minDist) {
      return true;
    }
  }
  return false;
}

function isInsideBuilding(point, mapData) {
  if (!mapData || !mapData.buildings) {
    return false;
  }
  for (let i = 0; i < mapData.buildings.length; i += 1) {
    const b = mapData.buildings[i];
    if (point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height) {
      return true;
    }
  }
  return false;
}

function distanceToBuilding(point, mapData) {
  if (!mapData || !mapData.buildings || mapData.buildings.length === 0) {
    return Infinity;
  }
  let best = Infinity;
  for (let i = 0; i < mapData.buildings.length; i += 1) {
    const b = mapData.buildings[i];
    const cx = Math.max(b.x, Math.min(point.x, b.x + b.width));
    const cy = Math.max(b.y, Math.min(point.y, b.y + b.height));
    const dist = Math.hypot(point.x - cx, point.y - cy);
    if (dist < best) {
      best = dist;
    }
  }
  return best;
}

function distanceToRoad(point, mapData) {
  if (!mapData || !mapData.roads || mapData.roads.length === 0) {
    return Infinity;
  }
  let best = Infinity;
  for (let i = 0; i < mapData.roads.length; i += 1) {
    const road = mapData.roads[i];
    if (road.points && road.points.length >= 2) {
      for (let s = 0; s < road.points.length - 1; s += 1) {
        const dist = distancePointToSegment(point, road.points[s], road.points[s + 1]);
        if (dist < best) {
          best = dist;
        }
      }
    }
  }
  return best;
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

function getHillBonus(point, mapData) {
  if (!mapData || !mapData.hills) {
    return 0;
  }
  let bonus = 0;
  for (let i = 0; i < mapData.hills.length; i += 1) {
    const hill = mapData.hills[i];
    const dist = Math.hypot(point.x - hill.x, point.y - hill.y);
    if (dist < hill.radius) {
      const local = (1 - dist / hill.radius) * (hill.elevation - 1);
      if (local > bonus) {
        bonus = local;
      }
    }
  }
  return bonus;
}

function findClosestRoadPoint(unit, roads) {
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < roads.length; i += 1) {
    const road = roads[i];
    if (!road.points || road.points.length < 2) {
      continue;
    }
    for (let s = 0; s < road.points.length - 1; s += 1) {
      const point = closestPointOnSegment(unit, road.points[s], road.points[s + 1]);
      const dist = Math.hypot(point.x - unit.x, point.y - unit.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = point;
      }
    }
  }
  return best;
}

function closestPointOnSegment(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abLen = abx * abx + aby * aby || 1;
  let t = ((point.x - a.x) * abx + (point.y - a.y) * aby) / abLen;
  t = Math.max(0, Math.min(1, t));
  return {
    x: a.x + abx * t,
    y: a.y + aby * t
  };
}
