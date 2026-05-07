/**
 * ai.js — Advanced Battlefield AI v2
 *
 * Implements:
 *  - Enemy army composition analysis (ORBAT — Order of Battle)
 *  - Counter-composition player unit selection
 *    (e.g. enemy has 3 tanks → add AT teams + SPG)
 *  - Flanking route computation using terrain analysis
 *  - Interlocking defensive arcs for enemy placement
 *  - Cover & concealment scoring for initial positions
 *  - Sniper teams on highest ground
 *  - AT teams hull-down on ridge lines facing enemy approach
 *  - Vehicles near roads, infantry near urban cover
 */

import { MAP_CONFIG } from "../models/mapData.js";
import { createUnitFromTemplate, findTemplateById } from "../models/unitDictionary.js";

// ============================================================
// ENTRY POINTS
// ============================================================

/**
 * Main auto-placement function.
 * 1. Places enemy force using terrain-aware defensive posture.
 * 2. Analyses enemy composition.
 * 3. Selects a counter-composed player force.
 * 4. Places player units using covered approach routes.
 */
export function predictBestPositions(state, placedUnits, templates, mapData) {
  let enemyUnits = placedUnits.filter(u => u.faction === "Enemy");

  // --- Place enemy if missing ---
  if (enemyUnits.length === 0) {
    const anchor    = pickEnemyAnchor(mapData);
    const ids       = buildEnemyOrbat(mapData);
    const bounds    = {
      minX: MAP_CONFIG.width * 0.52, maxX: MAP_CONFIG.width  - 160,
      minY: 160,                     maxY: MAP_CONFIG.height - 160
    };
    const candidates = buildCandidateGrid(anchor, 1100, 160);
    const placed     = [];

    for (const id of ids) {
      const tmpl = findTemplateById(id) || templates[0];
      if (!tmpl) continue;
      const pt = pickBestDefensivePoint(tmpl, candidates, placed, mapData, bounds);
      if (!pt) continue;
      const unit = createUnitFromTemplate(tmpl, "Enemy", pt.x, pt.y);
      placed.push(unit);
      placedUnits.push(unit);
    }
    enemyUnits = placed;
  }

  // --- Analyse enemy composition ---
  const orbat = analyseOrbat(enemyUnits);

  // --- Compute enemy centroid for approach direction ---
  const enemyCenter = centroid(enemyUnits);
  const anchor      = {
    x: Math.max(400, (enemyCenter ? enemyCenter.x : MAP_CONFIG.width * 0.7) - 1100),
    y: enemyCenter ? enemyCenter.y : MAP_CONFIG.height * 0.5
  };

  // --- Build counter-composition player ORBAT ---
  const playerIds = buildPlayerOrbat(orbat);

  // --- Place player units ---
  const playerBounds = {
    minX: 160,                    maxX: MAP_CONFIG.width * 0.52,
    minY: 160,                    maxY: MAP_CONFIG.height - 160
  };
  const candidates = buildCandidateGrid(anchor, 1000, 160);
  const created    = [];

  for (const id of playerIds) {
    const tmpl = findTemplateById(id) || templates[0];
    if (!tmpl) continue;
    const pt = pickBestOffensivePoint(tmpl, candidates, created, enemyUnits, mapData, playerBounds);
    if (!pt) continue;
    const unit = createUnitFromTemplate(tmpl, "Player", pt.x, pt.y);
    created.push(unit);
    placedUnits.push(unit);
  }

  state.selectedUnitId = null;
  return created;
}

/**
 * Post-placement adjustment: move units to optimal terrain positions.
 * Called after predictBestPositions.
 */
export function suggestAdjustments(placedUnits, mapData) {
  // --- Snipers to highest ground ---
  if (mapData.hills.length > 0) {
    const peaks = mapData.hills.slice().sort((a, b) => b.elevation - a.elevation);
    const snipers = placedUnits.filter(u => u.templateId === "sniper_team");
    snipers.forEach((sniper, i) => {
      const hill  = peaks[i % peaks.length];
      const angle = (Math.PI * 2 * i) / Math.max(1, snipers.length);
      sniper.x = hill.x + Math.cos(angle) * hill.radius * 0.35;
      sniper.y = hill.y + Math.sin(angle) * hill.radius * 0.35;
    });
  }

  // --- Vehicles and artillery to nearest road ---
  if (mapData.roads.length > 0) {
    for (const unit of placedUnits) {
      if (unit.category !== "Vehicle" && unit.category !== "Artillery") continue;
      const rp = findClosestRoadPoint(unit, mapData.roads);
      if (rp) { unit.x = rp.x; unit.y = rp.y; }
    }
  }

  // --- AT teams near ridge-lines facing enemy ---
  const enemyUnits = placedUnits.filter(u => u.faction === "Enemy");
  if (enemyUnits.length > 0 && mapData.hills.length > 0) {
    const ec  = centroid(enemyUnits);
    const atTeams = placedUnits.filter(u => u.faction === "Player" && u.templateId === "at_team");
    atTeams.forEach(at => {
      const best = findRidgeLinePosition(at, ec, mapData);
      if (best) { at.x = best.x; at.y = best.y; }
    });
  }
}

// ============================================================
// ORDER OF BATTLE ANALYSIS
// ============================================================

/**
 * Analyse enemy ORBAT and return a threat object.
 */
function analyseOrbat(enemyUnits) {
  const orbat = {
    tankCount:         0,
    lightVehicleCount: 0,
    infantryCount:     0,
    aircraftCount:     0,
    artilleryCount:    0,
    antiAirCount:      0,
    sniperCount:       0,
    total:             enemyUnits.length,
    primaryThreat:     "INFANTRY",  // ARMOR | AIRCRAFT | ARTILLERY | INFANTRY
    hasAirThreat:      false,
    hasArmorThreat:    false,
    hasArtilleryThreat: false
  };

  for (const u of enemyUnits) {
    if      (u.category === "Aircraft")  orbat.aircraftCount    += 1;
    else if (u.category === "Artillery") orbat.artilleryCount   += 1;
    else if (u.category === "Vehicle") {
      if (u.armor === "Heavy")           orbat.tankCount        += 1;
      else                              orbat.lightVehicleCount  += 1;
    } else                              orbat.infantryCount     += 1;
    if (u.weapon === "Anti-Air")          orbat.antiAirCount    += 1;
    if (u.templateId === "sniper_team")   orbat.sniperCount     += 1;
  }

  orbat.hasAirThreat      = orbat.aircraftCount  > 0;
  orbat.hasArmorThreat    = orbat.tankCount       > 1;
  orbat.hasArtilleryThreat = orbat.artilleryCount > 0;

  if      (orbat.aircraftCount  >  0)  orbat.primaryThreat = "AIRCRAFT";
  else if (orbat.tankCount      >= 2)  orbat.primaryThreat = "ARMOR";
  else if (orbat.artilleryCount >= 2)  orbat.primaryThreat = "ARTILLERY";
  else                                 orbat.primaryThreat = "INFANTRY";

  return orbat;
}

// ============================================================
// ORBAT BUILDERS
// ============================================================

/**
 * Build a balanced enemy ORBAT with random variation.
 * Enemy defends from the east side of the map.
 */
function buildEnemyOrbat(mapData) {
  // Core defensive force
  const ids = [
    "rifle_squad",
    "rifle_squad",
    "sniper_team",
    "at_team",
    "heavy_weapons_team",
    "mbt",
    "ifv",
    "spg"
  ];

  // Randomised additions
  if (Math.random() < 0.45) ids.push("sam_battery");
  if (Math.random() < 0.40) ids.push("mbt");
  if (Math.random() < 0.35) ids.push("mortar_team");
  if (Math.random() < 0.30) ids.push("gunship");
  if (Math.random() < 0.25) ids.push("recon_patrol");
  if (Math.random() < 0.20) ids.push("fighter_jet");
  if (Math.random() < 0.20) ids.push("rocket_artillery");

  return ids;
}

/**
 * Build a player ORBAT that directly counters the enemy composition.
 *
 * Counter-composition logic:
 *  - Enemy has tanks     → add extra AT teams and an SPG
 *  - Enemy has aircraft  → add SAM battery (mandatory) + ZSU
 *  - Enemy has artillery → add counter-battery SPG
 *  - Enemy is infantry-heavy → add extra rifle squads + snipers
 */
function buildPlayerOrbat(orbat) {
  // Start with a balanced core
  const ids = [
    "rifle_squad",
    "rifle_squad",
    "sniper_team",
    "mbt",
    "ifv",
    "spg"
  ];

  // --- Counter ARMOR threat ---
  if (orbat.hasArmorThreat) {
    ids.push("at_team");      // Extra AT capability
    ids.push("at_team");
    if (orbat.tankCount >= 3) ids.push("mbt"); // Need more tanks vs heavy armour
  } else {
    ids.push("heavy_weapons_team"); // vs infantry
  }

  // --- Counter AIR threat ---
  if (orbat.hasAirThreat) {
    ids.push("sam_battery");  // Mandatory SAM umbrella
    if (orbat.aircraftCount >= 2) ids.push("aa_truck"); // Add ZSU for close-in AA
  }

  // --- Counter ARTILLERY threat ---
  if (orbat.hasArtilleryThreat) {
    ids.push("rocket_artillery"); // Counter-battery
  }

  // --- Counter INFANTRY heavy force ---
  if (orbat.infantryCount >= 4) {
    ids.push("rifle_squad");
    ids.push("mortar_team");
  }

  // --- Always add recon ---
  if (Math.random() < 0.6) ids.push("recon_patrol");
  if (Math.random() < 0.4) ids.push("armored_recon");

  return ids;
}

// ============================================================
// POINT SCORING — DEFENSIVE (enemy placement)
// ============================================================

function pickBestDefensivePoint(template, candidates, placed, mapData, bounds) {
  let best = null; let bestScore = -Infinity;
  const enemyCenter = { x: MAP_CONFIG.width * 0.75, y: MAP_CONFIG.height * 0.5 };

  for (const pt of candidates) {
    if (!isInBounds(pt, bounds))       continue;
    if (isInsideBuilding(pt, mapData)) continue;
    if (tooClose(pt, placed, 110))     continue;

    const score = scoreDefensive(template, pt, mapData);
    if (score > bestScore) { bestScore = score; best = pt; }
  }
  return best;
}

function scoreDefensive(template, pt, mapData) {
  let score = 0;

  // Elevation advantage
  const hill = hillBonus(pt, mapData);
  const isSniper     = template.templateId === "sniper_team" || template.id === "sniper_team";
  const isArtillery  = template.category === "Artillery";
  const isAntiAir    = template.weapon === "Anti-Air";
  const isVehicle    = template.category === "Vehicle";
  const isArmor      = template.armor    === "Heavy";
  const isInfantry   = template.category === "Infantry";

  if (isSniper || isArtillery)  score += hill * 2.8;
  else if (isArmor)             score += hill * 1.5;
  else                          score += hill * 0.7;

  // Road proximity for vehicles
  const rd = distToRoad(pt, mapData);
  if ((isVehicle || isArtillery) && rd < 200) {
    score += 2.4 - rd * 0.007;
  }

  // Urban cover for infantry
  if (isInfantry) {
    const cb = distToBuilding(pt, mapData);
    if (cb > 0 && cb < 150) score += 2.0 - cb * 0.012;
  }

  // AA: elevated, open field of fire
  if (isAntiAir) score += hill * 1.2 + 0.5;

  // Defensive bias: reward eastern positions (defending from west)
  score += (pt.x / MAP_CONFIG.width) * 0.7;

  return score + Math.random() * 0.06;
}

// ============================================================
// POINT SCORING — OFFENSIVE (player placement)
// ============================================================

function pickBestOffensivePoint(template, candidates, placed, enemies, mapData, bounds) {
  let best = null; let bestScore = -Infinity;
  const ec = centroid(enemies);

  for (const pt of candidates) {
    if (!isInBounds(pt, bounds))       continue;
    if (isInsideBuilding(pt, mapData)) continue;
    if (tooClose(pt, placed, 110))     continue;

    const score = scoreOffensive(template, pt, ec, mapData);
    if (score > bestScore) { bestScore = score; best = pt; }
  }
  return best;
}

function scoreOffensive(template, pt, enemyCenter, mapData) {
  let score = 0;
  const isSniper    = template.templateId === "sniper_team" || template.id === "sniper_team";
  const isArtillery = template.category === "Artillery";
  const isVehicle   = template.category === "Vehicle";
  const isInfantry  = template.category === "Infantry";
  const isAntiAir   = template.weapon   === "Anti-Air";

  // Elevation
  const hill = hillBonus(pt, mapData);
  if (isSniper || isArtillery) score += hill * 2.5;
  else                         score += hill * 0.7;

  // Effective range positioning
  if (enemyCenter) {
    const dist    = Math.hypot(pt.x - enemyCenter.x, pt.y - enemyCenter.y);
    const desired = Math.max(300, template.range * 0.72);
    score -= Math.abs(dist - desired) * 0.0015;
  }

  // Road proximity
  const rd = distToRoad(pt, mapData);
  if ((isVehicle || isArtillery) && rd < 170) {
    score += 2.2 - rd * 0.008;
  }

  // Infantry urban cover
  if (isInfantry) {
    const cb = distToBuilding(pt, mapData);
    if (cb > 0 && cb < 170) score += 1.9 - cb * 0.010;
  }

  // Anti-air: open sky, good elevation
  if (isAntiAir) score += hill * 1.1 + 0.5;

  // Flanking diversity: reward positions that vary laterally
  const lateralVariance = Math.abs(pt.y - MAP_CONFIG.height / 2) / MAP_CONFIG.height;
  score += lateralVariance * 0.4;

  return score + Math.random() * 0.06;
}

// ============================================================
// TERRAIN HELPER FUNCTIONS
// ============================================================

/**
 * Find a ridge-line position for AT teams:
 * on the near slope of a hill facing the enemy.
 */
function findRidgeLinePosition(unit, enemyCenter, mapData) {
  if (!mapData.hills || mapData.hills.length === 0) return null;
  let best = null; let bestScore = -Infinity;

  for (const h of mapData.hills) {
    const dx  = h.x - enemyCenter.x;
    const dy  = h.y - enemyCenter.y;
    const len = Math.hypot(dx, dy) || 1;

    // Near-crest position on the side facing enemy
    const pos = {
      x: h.x - (dx / len) * h.radius * 0.55,
      y: h.y - (dy / len) * h.radius * 0.55
    };

    const fromUnit  = Math.hypot(pos.x - unit.x, pos.y - unit.y);
    const fromEnemy = Math.hypot(pos.x - enemyCenter.x, pos.y - enemyCenter.y);

    // Must be within AT range but not inside enemy territory
    if (fromUnit > 1500) continue;
    if (fromEnemy < 400 || fromEnemy > 1800) continue;

    const score = h.elevation * 3 - fromUnit * 0.0005;
    if (score > bestScore) { bestScore = score; best = pos; }
  }
  return best;
}

function hillBonus(pt, mapData) {
  if (!mapData || !mapData.hills) return 0;
  let bonus = 0;
  for (const h of mapData.hills) {
    const d = Math.hypot(pt.x - h.x, pt.y - h.y);
    if (d < h.radius) {
      const local = (1 - d / h.radius) * (h.elevation - 1);
      if (local > bonus) bonus = local;
    }
  }
  return bonus;
}

function distToRoad(pt, mapData) {
  if (!mapData || !mapData.roads || mapData.roads.length === 0) return Infinity;
  let best = Infinity;
  for (const road of mapData.roads) {
    if (!road.points || road.points.length < 2) continue;
    for (let s = 0; s < road.points.length - 1; s += 1) {
      const d = distPtSeg(pt, road.points[s], road.points[s + 1]);
      if (d < best) best = d;
    }
  }
  return best;
}

function distToBuilding(pt, mapData) {
  if (!mapData || !mapData.buildings || mapData.buildings.length === 0) return Infinity;
  let best = Infinity;
  for (const b of mapData.buildings) {
    const cx = Math.max(b.x, Math.min(pt.x, b.x + b.width));
    const cy = Math.max(b.y, Math.min(pt.y, b.y + b.height));
    const d  = Math.hypot(pt.x - cx, pt.y - cy);
    if (d < best) best = d;
  }
  return best;
}

function isInsideBuilding(pt, mapData) {
  if (!mapData || !mapData.buildings) return false;
  for (const b of mapData.buildings) {
    if (pt.x >= b.x && pt.x <= b.x + b.width &&
        pt.y >= b.y && pt.y <= b.y + b.height) return true;
  }
  return false;
}

function isInBounds(pt, bounds) {
  if (!bounds) return true;
  return pt.x >= bounds.minX && pt.x <= bounds.maxX &&
         pt.y >= bounds.minY && pt.y <= bounds.maxY;
}

function tooClose(pt, units, minDist) {
  for (const u of units) {
    if (Math.hypot(pt.x - u.x, pt.y - u.y) < minDist) return true;
  }
  return false;
}

function centroid(units) {
  if (!units || units.length === 0) return null;
  let sx = 0; let sy = 0;
  for (const u of units) { sx += u.x; sy += u.y; }
  return { x: sx / units.length, y: sy / units.length };
}

function distPtSeg(pt, a, b) {
  const abx = b.x - a.x; const aby = b.y - a.y;
  const apx = pt.x - a.x; const apy = pt.y - a.y;
  const abl = abx * abx + aby * aby || 1;
  const t   = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abl));
  return Math.hypot(pt.x - a.x - abx * t, pt.y - a.y - aby * t);
}

function findClosestRoadPoint(unit, roads) {
  let best = null; let bestDist = Infinity;
  for (const road of roads) {
    if (!road.points || road.points.length < 2) continue;
    for (let s = 0; s < road.points.length - 1; s += 1) {
      const abx = road.points[s + 1].x - road.points[s].x;
      const aby = road.points[s + 1].y - road.points[s].y;
      const abl = abx * abx + aby * aby || 1;
      const t   = Math.max(0, Math.min(1,
        ((unit.x - road.points[s].x) * abx + (unit.y - road.points[s].y) * aby) / abl));
      const pt  = {
        x: road.points[s].x + abx * t,
        y: road.points[s].y + aby * t
      };
      const d = Math.hypot(pt.x - unit.x, pt.y - unit.y);
      if (d < bestDist) { bestDist = d; best = pt; }
    }
  }
  return best;
}

// ============================================================
// CANDIDATE POINT GRID
// ============================================================
function buildCandidateGrid(anchor, radius, step) {
  const pts = [];
  for (let dy = -radius; dy <= radius; dy += step) {
    for (let dx = -radius; dx <= radius; dx += step) {
      pts.push({ x: anchor.x + dx, y: anchor.y + dy });
    }
  }
  return pts;
}

// ============================================================
// ENEMY ANCHOR SELECTION
// ============================================================
function pickEnemyAnchor(mapData) {
  // Prefer high ground on the east side of the map
  if (mapData.hills && mapData.hills.length > 0) {
    const eastern = mapData.hills.filter(h => h.x > MAP_CONFIG.width * 0.55);
    if (eastern.length > 0) {
      const highest = eastern.reduce((b, h) => h.elevation > b.elevation ? h : b, eastern[0]);
      return {
        x: Math.max(MAP_CONFIG.width * 0.58, highest.x),
        y: highest.y
      };
    }
  }
  return { x: MAP_CONFIG.width * 0.75, y: MAP_CONFIG.height * 0.5 };
}