import { mapData, MAP_CONFIG } from "../models/mapData.js";
import { buildNavGrid, findPath } from "./pathfinding.js";

export default class SimulationEngine {
  constructor(state, renderer, callbacks) {
    this.state = state;
    this.renderer = renderer;
    this.callbacks = callbacks || {};
    this.intervalId = null;
    this.running = false;
    this.elapsed = 0;
    this.snapshot = null;
    this.stats = this.createStats();
    this.navGrid = null;
    this.navVersion = -1;
  }

  createStats() {
    return {
      Player: { casualties: 0, ammoSpent: 0 },
      Enemy: { casualties: 0, ammoSpent: 0 }
    };
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.elapsed = 0;
    this.stats = this.createStats();
    this.snapshot = JSON.parse(JSON.stringify(this.state.units));
    this.intervalId = setInterval(() => this.tick(0.1), 100);
  }

  stop() {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  reset() {
    this.stop();
    if (this.snapshot) {
      this.state.units.length = 0;
      this.snapshot.forEach((unit) => this.state.units.push(unit));
      if (typeof this.callbacks.onUnitsReset === "function") {
        this.callbacks.onUnitsReset();
      }
    }
  }

  tick(dt) {
    if (!this.running) {
      return;
    }

    this.elapsed += dt;

    const units = this.state.units;
    const playerUnits = units.filter((u) => u.faction === "Player" && !u.neutralized);
    const enemyUnits = units.filter((u) => u.faction === "Enemy" && !u.neutralized);

    if (playerUnits.length === 0 || enemyUnits.length === 0) {
      const outcome = playerUnits.length === 0 ? "Duşman ýeňşi" : "Öz goşunymyz ýeňşi";
      this.endSimulation(outcome);
      return;
    }

    if (this.state.simulation.mode === "time" && this.elapsed >= this.state.simulation.timeLimit) {
      this.endSimulation("Wagt çägi doldy");
      return;
    }

    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i];
      if (unit.neutralized) {
        continue;
      }

      this.ensureUnitTiming(unit);

      unit.pathAge = (unit.pathAge || 0) + dt;

      unit.suppression = Math.max(0, unit.suppression - 0.12 * dt);
      unit.cooldown = Math.max(0, unit.cooldown - dt);

      if (unit.ammo <= 0) {
        unit.state = "idle";
        continue;
      }

      const enemies = unit.faction === "Player" ? enemyUnits : playerUnits;
      if (this.handleThreatResponse(unit, enemies, dt)) {
        continue;
      }
      const targetInfo = this.getTargetInfo(unit, enemies, dt);
      if (targetInfo && targetInfo.inRange) {
        if (unit.cooldown <= 0) {
          this.fireAtTarget(unit, targetInfo.target, targetInfo.distance);
          unit.cooldown = unit.fireInterval * (0.85 + Math.random() * 0.3);
        }
      } else if (targetInfo && targetInfo.target) {
        this.advanceToward(unit, targetInfo.target, dt);
      } else {
        this.searchAdvance(unit, enemies, dt);
      }
    }

    for (let i = units.length - 1; i >= 0; i -= 1) {
      if (units[i].neutralized) {
        units.splice(i, 1);
      }
    }

    if (this.state.selectedUnitId) {
      const stillThere = units.some((u) => u.id === this.state.selectedUnitId);
      if (!stillThere) {
        this.state.selectedUnitId = null;
        if (typeof this.callbacks.onSelectionCleared === "function") {
          this.callbacks.onSelectionCleared();
        }
      }
    }
  }

  ensureUnitTiming(unit) {
    if (typeof unit.fireInterval !== "number") {
      unit.fireInterval = this.deriveFireInterval(unit);
    }
    if (typeof unit.speed !== "number") {
      unit.speed = this.deriveSpeed(unit);
    }
    if (typeof unit.usesRoads !== "boolean") {
      unit.usesRoads = unit.category === "Vehicle" || (unit.category === "Artillery" && unit.armor !== "Unarmored");
    }
    if (typeof unit.cooldown !== "number") {
      unit.cooldown = Math.random() * unit.fireInterval;
    }
    if (!unit.path) {
      unit.path = [];
      unit.pathIndex = 0;
      unit.pathTargetId = "";
      unit.pathAge = 0;
      unit.pathTargetKey = "";
      unit.pathGoal = null;
    }
    if (typeof unit.targetId !== "string") {
      unit.targetId = "";
      unit.targetLostTime = 0;
    }
    if (typeof unit.lastUnderFireAt !== "number") {
      unit.lastUnderFireAt = -Infinity;
    }
    if (typeof unit.lastAttackerId !== "string") {
      unit.lastAttackerId = "";
    }
    if (typeof unit.retreatUntil !== "number") {
      unit.retreatUntil = 0;
    }
    if (!unit.retreatTarget) {
      unit.retreatTarget = null;
    }
  }

  getNavGrid() {
    const version = typeof mapData.navVersion === "number" ? mapData.navVersion : 0;
    if (!this.navGrid || this.navVersion !== version) {
      this.navGrid = buildNavGrid(mapData, 200);
      this.navVersion = version;
    }
    return this.navGrid;
  }

  deriveFireInterval(unit) {
    if (unit.weapon === "Small Arms") {
      return 1.1;
    }
    if (unit.weapon === "Heavy MG") {
      return 0.7;
    }
    if (unit.weapon === "Anti-Armor") {
      return 3.5;
    }
    if (unit.weapon === "Explosive") {
      if (unit.category === "Artillery") {
        return 5.8;
      }
      return 2.4;
    }
    if (unit.weapon === "Anti-Air") {
      return unit.category === "Aircraft" ? 2.2 : 3.6;
    }
    return 4;
  }

  deriveSpeed(unit) {
    if (unit.category === "Infantry") {
      return 1.4 * unit.mobility;
    }
    if (unit.category === "Vehicle") {
      return (unit.armor === "Heavy" ? 11 : 15) * unit.mobility;
    }
    if (unit.category === "Artillery") {
      return (unit.armor === "Unarmored" ? 1.2 : 8.5) * unit.mobility;
    }
    if (unit.category === "Aircraft") {
      return 80 * unit.mobility;
    }
    return 4 * unit.mobility;
  }

  endSimulation(outcome) {
    this.stop();
    const report = {
      outcome: outcome,
      Player: this.stats.Player,
      Enemy: this.stats.Enemy
    };
    if (typeof this.callbacks.onSimulationEnd === "function") {
      this.callbacks.onSimulationEnd(report);
    }
  }

  canDamageTarget(attacker, target) {
    const armorMult = this.getArmorMultiplier(attacker.weapon, target.armor, target.category);
    return armorMult > 0.08;
  }

  findTarget(unit, enemies) {
    let best = null;
    let bestScore = -Infinity;
    let inRange = false;

    const elevMult = this.getElevationMultiplier(unit);
    const unitRange = unit.range * elevMult;

    for (let i = 0; i < enemies.length; i += 1) {
      const enemy = enemies[i];
      const dx = enemy.x - unit.x;
      const dy = enemy.y - unit.y;
      const dist = Math.hypot(dx, dy);

      if (dist > unit.detection * elevMult) {
        continue;
      }

      if (!this.hasLineOfSight(unit, enemy)) {
        continue;
      }

      // CRITICAL: Skip targets that this unit cannot damage
      if (!this.canDamageTarget(unit, enemy)) {
        continue;
      }

      const withinRange = dist <= unitRange;

      const threatScore = this.calculateTargetPriority(unit, enemy, dist);

      const rangeBonus = withinRange ? 500 : 0;
      const distanceFactor = Math.max(1, 1000 - dist);
      const score = threatScore + rangeBonus + distanceFactor;

      if (score > bestScore) {
        best = enemy;
        bestScore = score;
        inRange = withinRange;
      }
    }

    if (!best) {
      return null;
    }

    return {
      target: best,
      distance: Math.hypot(best.x - unit.x, best.y - unit.y),
      inRange: inRange
    };
  }

  calculateTargetPriority(attacker, target, distance) {
    let score = 0;

    // Base score from weapon effectiveness vs target armor
    const armorMult = this.getArmorMultiplier(attacker.weapon, target.armor, target.category);
    score += armorMult * 200;

    const targetIsDangerousToThis = this.isThreatTo(attacker, target);

    // --- UNIT-TYPE-SPECIFIC PRIORITIES ---

    // SNIPERS: ONLY target infantry (unarmored). Ignore vehicles/armor.
    if (attacker.templateId === "sniper_team") {
      if (target.armor === "Unarmored") score += 800;
      if (target.weapon === "Anti-Armor") score += 400; // dangerous to everyone
      return score; // snipers already filtered via canDamage
    }

    // ANTI-ARMOR UNITS (tanks, AT teams): Prioritize armored threats, ignore infantry
    if (attacker.weapon === "Anti-Armor") {
      if (target.armor === "Heavy") score += 500;  // TOP priority: enemy tanks
      if (target.armor === "Light") score += 350;  // Secondary: vehicles
      if (target.weapon === "Anti-Armor" && target.armor === "Heavy") score += 400; // enemy tank with AT weapon
      if (target.armor === "Unarmored") score += 30; // Very low: infantry
      return score;
    }

    // HEAVY MG UNITS (IFV, APC): Prioritize light vehicles and infantry, avoid heavy armor
    if (attacker.weapon === "Heavy MG") {
      if (target.armor === "Unarmored") score += 300;  // Good vs infantry
      if (target.armor === "Light") score += 250;      // Good vs light vehicles
      if (target.armor === "Heavy") score -= 200;      // CANNOT damage heavy armor
      if (target.weapon === "Anti-Armor") score += 300; // Dangerous threat
      return score;
    }

    // SMALL ARMS UNITS (rifle, recon): Only target infantry, ignore armor
    if (attacker.weapon === "Small Arms") {
      if (target.armor === "Unarmored") score += 300;
      if (target.armor !== "Unarmored") score -= 500; // Heavily penalize vs armor
      if (target.weapon === "Small Arms") score += 100;
      return score;
    }

    // ANTI-AIR UNITS: Absolute priority on aircraft
    if (attacker.weapon === "Anti-Air") {
      if (target.category === "Aircraft") score += 1000;
      return score; // ignore ground targets entirely if aircraft exist
    }

    // EXPLOSIVE UNITS (combat engineers, artillery): Good area damage
    if (attacker.weapon === "Explosive") {
      if (attacker.category === "Infantry") {
        // Combat engineers: prioritize vehicles
        if (target.armor === "Light") score += 300;
        if (target.armor === "Heavy") score += 250;
        if (target.armor === "Unarmored") score += 100;
      } else {
        // Artillery: prioritize clusters, heavy targets
        if (target.armor === "Heavy") score += 200;
        if (target.category === "Vehicle") score += 150;
        if (target.armor === "Light") score += 100;
      }
      return score;
    }

    // AIRCRAFT: Prioritize other aircraft, then light/medium targets
    if (attacker.category === "Aircraft") {
      if (target.category === "Aircraft") score += 500;
      if (target.weapon === "Anti-Air") score += 400; // dangerous to aircraft
      if (target.armor === "Unarmored") score += 150;
      if (target.armor === "Heavy") score += 50;
      return score;
    }

    // FALLBACK for any unhandled types
    if (targetIsDangerousToThis) {
      score += 300;
    }

    return score;
  }

  isThreatTo(myUnit, otherUnit) {
    // Can the other unit damage this unit effectively?
    const armorMult = this.getArmorMultiplier(otherUnit.weapon, myUnit.armor, myUnit.category);
    if (armorMult > 0.5) {
      return true;
    }
    // Specific threat checks
    if (myUnit.category === "Vehicle" && otherUnit.weapon === "Anti-Armor") return true;
    if (myUnit.category === "Aircraft" && otherUnit.weapon === "Anti-Air") return true;
    if (myUnit.category === "Aircraft" && otherUnit.weapon === "Explosive") return true;
    return false;
  }

  getTargetInfo(unit, enemies, dt) {
    if (unit.targetId) {
      const locked = this.findEnemyById(enemies, unit.targetId);
      if (locked) {
        const info = this.evaluateTarget(unit, locked);
        if (info) {
          unit.targetLostTime = 0;
          return info;
        }
        unit.targetLostTime += dt;
        if (unit.targetLostTime < 2.2) {
          return null;
        }
      }
    }

    const fallback = this.findTarget(unit, enemies);
    if (fallback && fallback.target) {
      unit.targetId = fallback.target.id;
      unit.targetLostTime = 0;
    }
    return fallback;
  }

  findEnemyById(enemies, id) {
    for (let i = 0; i < enemies.length; i += 1) {
      if (enemies[i].id === id) {
        return enemies[i];
      }
    }
    return null;
  }

  evaluateTarget(unit, enemy) {
    const dx = enemy.x - unit.x;
    const dy = enemy.y - unit.y;
    const dist = Math.hypot(dx, dy);
    const elevMult = this.getElevationMultiplier(unit);
    if (dist > unit.detection * elevMult) {
      return null;
    }
    if (!this.hasLineOfSight(unit, enemy)) {
      return null;
    }
    const withinRange = dist <= unit.range * elevMult;
    return {
      target: enemy,
      distance: dist,
      inRange: withinRange
    };
  }

  fireAtTarget(unit, target, distance) {
    const elevMult = this.getElevationMultiplier(unit);
    const rangeRatio = Math.min(1, distance / (unit.range * elevMult));
    const rangeFalloff = Math.max(0.12, 1 - Math.pow(rangeRatio, 1.3));
    const armorMultiplier = this.getArmorMultiplier(unit.weapon, target.armor, target.category);
    const suppressionPenalty = Math.max(0.2, 1 - unit.suppression);

    let hitChance = unit.accuracy * rangeFalloff * armorMultiplier * suppressionPenalty;
    hitChance = Math.max(0, Math.min(0.85, hitChance));

    unit.ammo -= 1;
    unit.ammoSpent += 1;
    this.stats[unit.faction].ammoSpent += 1;

    target.suppression = Math.min(1, target.suppression + unit.suppressionPower);
    target.lastUnderFireAt = this.elapsed;
    target.lastAttackerId = unit.id;

    // Determine projectile color based on weapon type
    let projectileColor = "rgba(52, 152, 219, 0.9)";
    let projectileRadius = 3;
    if (unit.weapon === "Explosive") {
      projectileColor = "rgba(241, 196, 15, 0.9)";
      projectileRadius = 5;
    } else if (unit.weapon === "Anti-Armor") {
      projectileColor = "rgba(231, 76, 60, 0.9)";
      projectileRadius = 4;
    } else if (unit.weapon === "Anti-Air") {
      projectileColor = "rgba(155, 89, 182, 0.9)";
      projectileRadius = 4;
    } else if (unit.weapon === "Heavy MG") {
      projectileColor = "rgba(241, 196, 15, 0.9)";
      projectileRadius = 3;
    } else if (unit.weapon === "Small Arms") {
      projectileColor = "rgba(52, 152, 219, 0.9)";
      projectileRadius = 2;
    }

    if (this.renderer) {
      // Add projectile effect (moving bullet/shell)
      this.renderer.addEffect({
        type: "projectile",
        from: { x: unit.x, y: unit.y },
        to: { x: target.x, y: target.y },
        ttl: 0.25,
        baseTtl: 0.25,
        color: projectileColor,
        radius: projectileRadius
      });

      // Add muzzle flash at the firing unit
      this.renderer.addEffect({
        type: "muzzle_flash",
        x: unit.x,
        y: unit.y,
        radius: unit.size * 0.6,
        ttl: 0.12,
        baseTtl: 0.12
      });

      // Also add a laser/beam line for tracer effect
      this.renderer.addEffect({
        type: "laser",
        from: { x: unit.x, y: unit.y },
        to: { x: target.x, y: target.y },
        ttl: 0.08,
        color: projectileColor
      });
    }

    // Trigger muzzle flash animation on the unit's renderer anim state
    if (this.renderer.unitAnim && this.renderer.unitAnim[unit.id]) {
      this.renderer.unitAnim[unit.id].flashTimer = 0.6;
    }

    if (Math.random() < hitChance) {
      target.neutralized = true;
      unit.kills += 1;
      this.stats[target.faction].casualties += 1;
      if (this.renderer) {
        // Enhanced explosion with debris
        this.renderer.addEffect({
          type: "explosion",
          x: target.x,
          y: target.y,
          radius: target.size * 2.4,
          ttl: 0.5,
          baseTtl: 0.5
        });
      }
    }
  }

  advanceToward(unit, target, dt) {
    const distToTarget = Math.hypot(target.x - unit.x, target.y - unit.y);
    if (distToTarget < 16) {
      return;
    }
    this.moveAlongPath(unit, target, dt, target.id, 7, 1);
  }

  searchAdvance(unit, enemies, dt) {
    if (enemies.length === 0) {
      return;
    }
    let closest = enemies[0];
    let bestDist = Infinity;
    for (let i = 0; i < enemies.length; i += 1) {
      const enemy = enemies[i];
      const dist = Math.hypot(enemy.x - unit.x, enemy.y - unit.y);
      if (dist < bestDist) {
        bestDist = dist;
        closest = enemy;
      }
    }
    this.moveAlongPath(unit, closest, dt, "search", 8, 0.45);
  }

  handleThreatResponse(unit, enemies, dt) {
    if (unit.category === "Aircraft") {
      return false;
    }
    const underFire = this.elapsed - unit.lastUnderFireAt < 1.6;
    if (!underFire && this.elapsed > unit.retreatUntil) {
      unit.retreatTarget = null;
      return false;
    }
    const attacker = this.findEnemyById(enemies, unit.lastAttackerId);
    if (!attacker) {
      return false;
    }
    const shouldRetreat = attacker.category === "Aircraft" || unit.suppression > 0.6;
    if (!shouldRetreat) {
      return false;
    }
    if (!unit.retreatTarget || this.elapsed > unit.retreatUntil) {
      unit.retreatTarget = this.findCoverPoint(unit, attacker);
      unit.retreatUntil = this.elapsed + 2.6;
    }
    if (!unit.retreatTarget) {
      return false;
    }
    this.moveAlongPath(unit, unit.retreatTarget, dt, "retreat", 5, 0.9);
    return true;
  }

  findCoverPoint(unit, attacker) {
    if (!attacker) {
      return null;
    }
    let best = null;
    let bestDist = Infinity;
    if (mapData.buildings) {
      for (let i = 0; i < mapData.buildings.length; i += 1) {
        const b = mapData.buildings[i];
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        const vx = cx - attacker.x;
        const vy = cy - attacker.y;
        const len = Math.hypot(vx, vy) || 1;
        const offset = Math.max(b.width, b.height) / 2 + 24;
        const candidate = this.clampPointToMap({
          x: cx + (vx / len) * offset,
          y: cy + (vy / len) * offset
        });
        if (this.isPointInsideBuilding(candidate)) {
          continue;
        }
        const dist = Math.hypot(candidate.x - unit.x, candidate.y - unit.y);
        if (dist < bestDist && dist < 700) {
          bestDist = dist;
          best = candidate;
        }
      }
    }
    if (best) {
      return best;
    }

    const awayX = unit.x - attacker.x;
    const awayY = unit.y - attacker.y;
    const awayLen = Math.hypot(awayX, awayY) || 1;
    return this.clampPointToMap({
      x: unit.x + (awayX / awayLen) * 240,
      y: unit.y + (awayY / awayLen) * 240
    });
  }

  clampPointToMap(point) {
    return {
      x: Math.max(20, Math.min(MAP_CONFIG.width - 20, point.x)),
      y: Math.max(20, Math.min(MAP_CONFIG.height - 20, point.y))
    };
  }

  isPointInsideBuilding(point) {
    if (!mapData.buildings) {
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

  moveAlongPath(unit, destination, dt, pathId, repathAge, speedScale) {
    const nav = this.getNavGrid();
    const targetKey = this.navCellKey(destination, nav);
    const goalDist = unit.pathGoal
      ? Math.hypot(destination.x - unit.pathGoal.x, destination.y - unit.pathGoal.y)
      : Infinity;
    const needsPath =
      !unit.path ||
      unit.path.length === 0 ||
      unit.pathTargetId !== pathId ||
      unit.pathTargetKey !== targetKey ||
      unit.pathAge > repathAge ||
      goalDist > 140;

    if (needsPath) {
      unit.path = findPath({ x: unit.x, y: unit.y }, { x: destination.x, y: destination.y }, unit, nav);
      unit.pathIndex = 0;
      unit.pathTargetId = pathId;
      unit.pathTargetKey = targetKey;
      unit.pathAge = 0;
      unit.pathGoal = { x: destination.x, y: destination.y };
    }

    this.advancePathIndex(unit, 16);
    const waypoint = this.getLookaheadWaypoint(unit);
    const dest = waypoint || destination;
    this.moveToward(unit, dest, dt, speedScale);
    this.advancePathIndex(unit, 14);
  }

  advancePathIndex(unit, threshold) {
    if (!unit.path || unit.path.length === 0) {
      return;
    }
    while (unit.pathIndex < unit.path.length) {
      const point = unit.path[unit.pathIndex];
      const dist = Math.hypot(point.x - unit.x, point.y - unit.y);
      if (dist > threshold) {
        break;
      }
      unit.pathIndex += 1;
    }
  }

  getLookaheadWaypoint(unit) {
    if (!unit.path || unit.pathIndex >= unit.path.length) {
      return null;
    }
    const lookahead = Math.min(unit.path.length - 1, unit.pathIndex + 2);
    return unit.path[lookahead];
  }

  moveToward(unit, dest, dt, speedScale) {
    const dx = dest.x - unit.x;
    const dy = dest.y - unit.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 6) {
      return;
    }
    const speed = this.getSpeed(unit) * speedScale * dt;
    const step = Math.min(speed, dist);
    unit.x += (dx / dist) * step;
    unit.y += (dy / dist) * step;
    unit.heading = Math.atan2(dy, dx);
  }

  navCellKey(point, nav) {
    const x = Math.min(nav.cols - 1, Math.max(0, Math.floor(point.x / nav.gridSize)));
    const y = Math.min(nav.rows - 1, Math.max(0, Math.floor(point.y / nav.gridSize)));
    return x + "_" + y;
  }

  getSpeed(unit) {
    let speed = unit.speed !== undefined ? unit.speed : unit.mobility * 12;
    const suppressionFactor = 1 - unit.suppression * 0.75;
    speed *= Math.max(0.2, suppressionFactor);

    if (unit.usesRoads) {
      const roadFactor = this.getRoadFactor(unit);
      speed *= roadFactor;
    }

    return speed;
  }

  getRoadFactor(unit) {
    const roadInfo = this.isOnRoad(unit);
    if (!roadInfo.onRoad) {
      return 0.7;
    }
    return roadInfo.type === "Highway" ? 1.35 : 1.15;
  }

  isOnRoad(unit) {
    let closest = { onRoad: false, type: "" };
    for (let i = 0; i < mapData.roads.length; i += 1) {
      const road = mapData.roads[i];
      if (road.points && road.points.length >= 2) {
        for (let s = 0; s < road.points.length - 1; s += 1) {
          const dist = this.distancePointToSegment(unit, road.points[s], road.points[s + 1]);
          if (dist < 30) {
            closest = { onRoad: true, type: road.type };
            return closest;
          }
        }
      }
    }
    return closest;
  }

  distancePointToSegment(point, a, b) {
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

  getElevationMultiplier(unit) {
    let elevation = 1;
    for (let i = 0; i < mapData.hills.length; i += 1) {
      const hill = mapData.hills[i];
      const dist = Math.hypot(unit.x - hill.x, unit.y - hill.y);
      if (dist <= hill.radius && hill.elevation > elevation) {
        elevation = hill.elevation;
      }
    }
    return 1 + (elevation - 1) * 0.4;
  }

  hasLineOfSight(unit, target) {
    if (unit.category === "Aircraft" || target.category === "Aircraft") {
      return true;
    }
    const ux = unit.x;
    const uy = unit.y;
    const tx = target.x;
    const ty = target.y;

    for (let i = 0; i < mapData.hills.length; i += 1) {
      const hill = mapData.hills[i];
      const hillHeight = hill.elevation;
      if (hillHeight <= unit.height || hillHeight <= target.height) {
        continue;
      }
      if (this.lineIntersectsCircle(ux, uy, tx, ty, hill.x, hill.y, hill.radius)) {
        return false;
      }
    }

    if (mapData.buildings) {
      for (let i = 0; i < mapData.buildings.length; i += 1) {
        const b = mapData.buildings[i];
        if (this.lineIntersectsRect(ux, uy, tx, ty, b.x, b.y, b.width, b.height)) {
          return false;
        }
      }
    }
    return true;
  }

  lineIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
    const left = this.lineIntersectsLine(x1, y1, x2, y2, rx, ry, rx, ry + rh);
    const right = this.lineIntersectsLine(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh);
    const top = this.lineIntersectsLine(x1, y1, x2, y2, rx, ry, rx + rw, ry);
    const bottom = this.lineIntersectsLine(x1, y1, x2, y2, rx, ry + rh, rx + rw, ry + rh);
    return left || right || top || bottom;
  }

  lineIntersectsLine(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (denom === 0) {
      return false;
    }
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  lineIntersectsCircle(x1, y1, x2, y2, cx, cy, radius) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const fx = x1 - cx;
    const fy = y1 - cy;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    let discriminant = b * b - 4 * a * c;
    if (discriminant < 0) {
      return false;
    }
    discriminant = Math.sqrt(discriminant);
    const t1 = (-b - discriminant) / (2 * a);
    const t2 = (-b + discriminant) / (2 * a);
    return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
  }

  getArmorMultiplier(weapon, armor, targetCategory) {
    // Anti-Air weapons: highly effective vs aircraft, nearly useless vs ground
    if (weapon === "Anti-Air") {
      return targetCategory === "Aircraft" ? 1.5 : 0.05;
    }
    if (weapon === "None") {
      return 0;
    }
    // Aircraft are immune to ground weapons except explosives and anti-air
    if (targetCategory === "Aircraft") {
      if (weapon === "Explosive") return 0.5;
      if (weapon === "Anti-Armor") return 0.3;
      if (weapon === "Combined Arms") return 0.6;
      if (weapon === "Auto Cannon") return 0.15;
      return 0;
    }
    // Combined Arms (MBT main gun + mg): best all-rounder
    if (weapon === "Combined Arms") {
      if (armor === "Heavy") return 1.4;   // APFSDS - excellent vs heavy armor
      if (armor === "Medium") return 1.2;  // Good vs medium armor
      if (armor === "Light") return 1.0;   // Good vs light vehicles
      return 0.6;                          // Coaxial MG vs infantry
    }
    // Auto Cannon (20-40mm): great vs light/medium, poor vs heavy
    if (weapon === "Auto Cannon") {
      if (armor === "Heavy") return 0.1;   // Cannot penetrate MBT front
      if (armor === "Medium") return 0.55; // Side/rear shots possible
      if (armor === "Light") return 1.0;   // Excellent vs IFV/APC
      return 0.7;                          // Devastating vs infantry
    }
    // Anti-Armor weapons: designed for vehicles, less effective vs infantry
    if (weapon === "Anti-Armor") {
      if (armor === "Heavy") return 1.2;   // Excellent vs heavy armor (tanks)
      if (armor === "Medium") return 1.1;  // Good vs medium armor
      if (armor === "Light") return 1.0;   // Good vs light armor
      return 0.4;                          // Poor vs unarmored infantry
    }
    // Explosive weapons: good vs unarmored, decent vs light, reduced vs heavy
    if (weapon === "Explosive") {
      if (armor === "Heavy") return 0.8;   // Reduced vs heavy armor
      if (armor === "Medium") return 1.0;  // Decent vs medium
      if (armor === "Light") return 1.1;   // Good splash damage
      return 1.3;                          // Excellent vs infantry
    }
    // Heavy MG: good vs light, reduced vs heavy, poor vs unarmored
    if (weapon === "Heavy MG") {
      if (armor === "Heavy") return 0.15;  // Very poor vs heavy armor
      if (armor === "Medium") return 0.3;  // Poor vs medium
      if (armor === "Light") return 0.85;  // Good vs light vehicles
      return 0.4;                          // Poor vs infantry
    }
    // Small Arms: effective vs infantry, useless vs heavy armor
    if (weapon === "Small Arms") {
      if (armor === "Heavy") return 0;     // Cannot penetrate
      if (armor === "Medium") return 0.05; // Cannot penetrate
      if (armor === "Light") return 0.3;   // Very poor vs light armor
      return 0.65;                         // Standard vs infantry
    }
    return 0.4;
  }
}
