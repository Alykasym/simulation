/**
 * simulation.js — Advanced Tactical Battle Simulation Engine v2
 *
 * Implements:
 *  - Tactical Finite State Machine (FSM) per unit
 *  - Bounding Overwatch fire-and-movement for infantry
 *  - Wedge / echelon formations for vehicles
 *  - Army Intelligence: composition analysis every 3s
 *  - Flanking maneuvers (perpendicular axis to enemy front)
 *  - Hull-down positioning for MBTs
 *  - Terrain-cover-aware advance routes
 *  - Aircraft: ORBIT → ATTACK_RUN → EGRESS cycle
 *    * Fixed-wing: high-speed strafing passes
 *    * Rotary-wing: pop-up attacks from cover
 *    * Drones: slow-loiter precision strikes
 *  - Artillery: indirect fire, minimum range dead-zone,
 *    area-of-effect splash, cluster targeting, shoot-and-scoot
 *  - Suppression → Retreat → Rally lifecycle
 *  - Proper weapon–target matching (tanks don't shoot aircraft)
 */

import { mapData, MAP_CONFIG } from "../models/mapData.js";
import { buildNavGrid, findPath } from "./pathfinding.js";

// ============================================================
// TACTICAL STATE CONSTANTS
// ============================================================
const TAC = {
  IDLE:        "IDLE",
  ADVANCE:     "ADVANCE",      // Moving toward objective under cover
  ENGAGE:      "ENGAGE",       // Target in range — direct fire
  SUPPRESS:    "SUPPRESS",     // Providing suppressive fire for bounding element
  OVERWATCH:   "OVERWATCH",    // Holding position, ready to engage
  FLANK:       "FLANK",        // Moving around enemy's exposed flank
  HOLD:        "HOLD",         // Static defence / artillery fire position
  RETREAT:     "RETREAT",      // Tactical withdrawal to cover
  RALLY:       "RALLY",        // Recovering suppression at cover point
  HULL_DOWN:   "HULL_DOWN",    // Tank repositioning to defilade
  ORBIT:       "ORBIT",        // Aircraft loitering
  ATTACK_RUN:  "ATTACK_RUN",   // Aircraft making a firing pass
  EGRESS:      "EGRESS",       // Aircraft exiting attack zone
  REARM:       "REARM"         // Unit is Winchester — out of ammo
};

// ============================================================
// FORMATION ROLES
// ============================================================
const ROLE = {
  LEAD:       "LEAD",
  SUPPORT:    "SUPPORT",
  FLANK_L:    "FLANK_L",
  FLANK_R:    "FLANK_R",
  REAR:       "REAR",
  BOUND_A:    "BOUND_A",  // Bounding overwatch — Group A moves
  BOUND_B:    "BOUND_B"   // Bounding overwatch — Group B covers
};

// ============================================================
// MAIN ENGINE CLASS
// ============================================================
export default class SimulationEngine {
  constructor(state, renderer, callbacks) {
    this.state     = state;
    this.renderer  = renderer;
    this.callbacks = callbacks || {};

    this.intervalId = null;
    this.running    = false;
    this.elapsed    = 0;
    this.snapshot   = null;
    this.stats      = this.createStats();

    this.navGrid    = null;
    this.navVersion = -1;

    // Army-level intelligence (refreshed every INTEL_INTERVAL seconds)
    this.INTEL_INTERVAL  = 3.0;
    this.intelClock      = 0;
    this.armyIntel       = { Player: null, Enemy: null };

    // Bounding overwatch phase per faction (A or B group moves)
    this.BOUND_INTERVAL  = 4.5;
    this.boundTimer      = { Player: 0, Enemy: 0 };
    this.boundPhase      = { Player: "A", Enemy: "A" };

    // Computed flank objectives per faction
    this.flankObj        = { Player: null, Enemy: null };
  }

  createStats() {
    return {
      Player: { casualties: 0, ammoSpent: 0 },
      Enemy:  { casualties: 0, ammoSpent: 0 }
    };
  }

  // ============================================================
  // LIFECYCLE
  // ============================================================
  start() {
    if (this.running) return;
    this.running   = true;
    this.elapsed   = 0;
    this.intelClock = this.INTEL_INTERVAL; // force immediate intel update
    this.stats     = this.createStats();
    this.snapshot  = JSON.parse(JSON.stringify(this.state.units));
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
      this.snapshot.forEach(u => this.state.units.push(u));
      this.armyIntel   = { Player: null, Enemy: null };
      this.flankObj    = { Player: null, Enemy: null };
      this.boundPhase  = { Player: "A", Enemy: "A" };
      this.boundTimer  = { Player: 0, Enemy: 0 };
      if (typeof this.callbacks.onUnitsReset === "function") {
        this.callbacks.onUnitsReset();
      }
    }
  }

  // ============================================================
  // MAIN TICK
  // ============================================================
  tick(dt) {
    if (!this.running) return;
    this.elapsed    += dt;
    this.intelClock += dt;
    this.boundTimer.Player += dt;
    this.boundTimer.Enemy  += dt;

    const units       = this.state.units;
    const playerUnits = units.filter(u => u.faction === "Player" && !u.neutralized);
    const enemyUnits  = units.filter(u => u.faction === "Enemy"  && !u.neutralized);

    // --- Victory check ---
    if (playerUnits.length === 0 || enemyUnits.length === 0) {
      this.endSimulation(playerUnits.length === 0 ? "Duşman ýeňşi" : "Öz goşunymyz ýeňşi");
      return;
    }
    if (this.state.simulation.mode === "time" &&
        this.elapsed >= this.state.simulation.timeLimit) {
      this.endSimulation("Wagt çägi doldy");
      return;
    }

    // --- Army-level intelligence refresh ---
    if (this.intelClock >= this.INTEL_INTERVAL) {
      this.intelClock = 0;
      this.armyIntel.Player = this.analyzeArmy(playerUnits, enemyUnits);
      this.armyIntel.Enemy  = this.analyzeArmy(enemyUnits,  playerUnits);
      this.assignFormationRoles(playerUnits, "Player");
      this.assignFormationRoles(enemyUnits,  "Enemy");
      this.updateFlankObjectives(playerUnits, enemyUnits);
    }

    // --- Bounding overwatch phase flip ---
    if (this.boundTimer.Player >= this.BOUND_INTERVAL) {
      this.boundTimer.Player = 0;
      this.boundPhase.Player = this.boundPhase.Player === "A" ? "B" : "A";
    }
    if (this.boundTimer.Enemy >= this.BOUND_INTERVAL) {
      this.boundTimer.Enemy = 0;
      this.boundPhase.Enemy = this.boundPhase.Enemy === "A" ? "B" : "A";
    }

    // --- Per-unit update ---
    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i];
      if (unit.neutralized) continue;

      this.ensureUnitState(unit);
      unit.pathAge    = (unit.pathAge    || 0) + dt;
      unit.cooldown   = Math.max(0, unit.cooldown   - dt);
      unit.suppression = Math.max(0, unit.suppression - 0.08 * dt);

      const allies  = unit.faction === "Player" ? playerUnits : enemyUnits;
      const enemies = unit.faction === "Player" ? enemyUnits  : playerUnits;
      const intel   = this.armyIntel[unit.faction];

      this.updateTacticalState(unit, allies, enemies, intel, dt);
      this.executeTacticalState(unit, allies, enemies, intel, dt);
    }

    // --- Purge neutralized ---
    for (let i = units.length - 1; i >= 0; i -= 1) {
      if (units[i].neutralized) units.splice(i, 1);
    }

    // --- Selection housekeeping ---
    if (this.state.selectedUnitId) {
      if (!units.some(u => u.id === this.state.selectedUnitId)) {
        this.state.selectedUnitId = null;
        if (typeof this.callbacks.onSelectionCleared === "function") {
          this.callbacks.onSelectionCleared();
        }
      }
    }
  }

  // ============================================================
  // ARMY INTELLIGENCE ANALYSIS
  // ============================================================
  /**
   * Produces a rich intelligence picture of the enemy force,
   * informing every unit's tactical decisions.
   */
  analyzeArmy(friendlies, enemies) {
    const intel = {
      tankCount:          0,
      lightVehicleCount:  0,
      infantryCount:      0,
      aircraftCount:      0,
      artilleryCount:     0,
      antiAirCount:       0,
      antiArmorCount:     0,
      totalStrength:      enemies.length,
      primaryThreat:      "INFANTRY",   // ARMOR | AIRCRAFT | ARTILLERY | INFANTRY
      threatLevel:        "MEDIUM",     // LOW | MEDIUM | HIGH | CRITICAL
      enemyCenter:        null,
      enemyFrontLine:     null,
      ownCenter:          null,
      avgEnemySuppression: 0,
      ammoState:          "FULL"        // FULL | ADEQUATE | LOW | CRITICAL
    };

    let totalSuppression = 0;
    for (const e of enemies) {
      if      (e.category === "Aircraft")   intel.aircraftCount    += 1;
      else if (e.category === "Artillery")  intel.artilleryCount   += 1;
      else if (e.category === "Vehicle") {
        if (e.armor === "Heavy")            intel.tankCount        += 1;
        else                               intel.lightVehicleCount  += 1;
      } else                               intel.infantryCount     += 1;
      if (e.weapon === "Anti-Air")          intel.antiAirCount     += 1;
      if (e.weapon === "Anti-Armor")        intel.antiArmorCount   += 1;
      totalSuppression += (e.suppression || 0);
    }
    intel.avgEnemySuppression = enemies.length > 0
      ? totalSuppression / enemies.length : 0;

    // Primary threat determines default posture
    if      (intel.aircraftCount  >  0)   intel.primaryThreat = "AIRCRAFT";
    else if (intel.tankCount      >= 2)   intel.primaryThreat = "ARMOR";
    else if (intel.artilleryCount >= 2)   intel.primaryThreat = "ARTILLERY";
    else                                  intel.primaryThreat = "INFANTRY";

    // Threat level (drives dispersion and aggression)
    const threat = intel.tankCount * 3 + intel.aircraftCount * 4 +
                   intel.lightVehicleCount * 1.5 + intel.infantryCount * 0.5;
    if      (threat > 15) intel.threatLevel = "CRITICAL";
    else if (threat >  8) intel.threatLevel = "HIGH";
    else if (threat >  3) intel.threatLevel = "MEDIUM";
    else                  intel.threatLevel = "LOW";

    // Spatial
    if (enemies.length > 0) {
      intel.enemyCenter = this.centroid(enemies);
      const ownCtr = this.centroid(friendlies);
      if (ownCtr) {
        const sorted = enemies.slice().sort((a, b) =>
          Math.hypot(a.x - ownCtr.x, a.y - ownCtr.y) -
          Math.hypot(b.x - ownCtr.x, b.y - ownCtr.y)
        );
        intel.enemyFrontLine = { x: sorted[0].x, y: sorted[0].y };
      }
    }
    if (friendlies.length > 0) {
      intel.ownCenter = this.centroid(friendlies);
    }

    // Own ammo state
    const avgRatio = friendlies.length > 0
      ? friendlies.reduce((s, u) => s + (u.ammoLimit > 0 ? u.ammo / u.ammoLimit : 1), 0)
        / friendlies.length
      : 1;
    if      (avgRatio < 0.15) intel.ammoState = "CRITICAL";
    else if (avgRatio < 0.35) intel.ammoState = "LOW";
    else if (avgRatio < 0.65) intel.ammoState = "ADEQUATE";
    else                      intel.ammoState = "FULL";

    return intel;
  }

  // ============================================================
  // FORMATION ROLE ASSIGNMENT
  // ============================================================
  assignFormationRoles(units, faction) {
    let boundIdx = 0;
    for (const u of units) {
      if (u.category === "Infantry") {
        u.boundGroup     = (boundIdx % 2 === 0) ? "A" : "B";
        u.formationRole  = (boundIdx % 2 === 0) ? ROLE.BOUND_A : ROLE.BOUND_B;
        boundIdx += 1;
      } else if (u.category === "Vehicle") {
        // Tanks hold the line; light vehicles get a flank role
        if (u.armor === "Heavy") {
          u.formationRole = ROLE.LEAD;
        } else {
          // Alternate IFVs left/right of tanks
          const vIdx = units.filter(x => x.category === "Vehicle").indexOf(u);
          u.formationRole = (vIdx % 2 === 0) ? ROLE.FLANK_L : ROLE.FLANK_R;
        }
      } else if (u.category === "Artillery") {
        u.formationRole = ROLE.SUPPORT;
      } else if (u.category === "Aircraft") {
        u.formationRole = ROLE.LEAD;
      }
    }
  }

  // ============================================================
  // FLANK OBJECTIVE — perpendicular to direct approach axis
  // ============================================================
  updateFlankObjectives(playerUnits, enemyUnits) {
    if (playerUnits.length > 0 && enemyUnits.length > 0) {
      this.flankObj.Player = this.computeFlankObjective(playerUnits, enemyUnits);
    }
    if (enemyUnits.length > 0 && playerUnits.length > 0) {
      this.flankObj.Enemy  = this.computeFlankObjective(enemyUnits, playerUnits);
    }
  }

  computeFlankObjective(ownForce, enemyForce) {
    const own   = this.centroid(ownForce);
    const enemy = this.centroid(enemyForce);
    if (!own || !enemy) return null;

    const dx  = enemy.x - own.x;
    const dy  = enemy.y - own.y;
    const len = Math.hypot(dx, dy) || 1;

    // Perpendicular (left-flank direction)
    const perpX = -dy / len;
    const perpY =  dx / len;

    // Flank point: 60% forward along approach + 45% sideways
    const fwdFrac  = 0.60;
    const sideDist = Math.min(len * 0.45, 1400);

    return this.clampPointToMap({
      x: own.x + (dx / len) * len * fwdFrac + perpX * sideDist,
      y: own.y + (dy / len) * len * fwdFrac + perpY * sideDist
    });
  }

  // ============================================================
  // TACTICAL STATE MACHINE — TRANSITIONS
  // ============================================================
  updateTacticalState(unit, allies, enemies, intel, dt) {
    // ---- AIRCRAFT ----
    if (unit.category === "Aircraft") {
      this.updateAircraftFSM(unit, enemies, dt);
      return;
    }

    // ---- ARTILLERY ----
    if (unit.category === "Artillery") {
      this.updateArtilleryFSM(unit, enemies, dt);
      return;
    }

    // ---- OUT OF AMMO ----
    if (unit.ammo <= 0) {
      unit.tacState = TAC.REARM;
      return;
    }

    const underFire        = this.elapsed - unit.lastUnderFireAt < 2.5;
    const suppressed       = unit.suppression > 0.55;
    const heavilySuppressed = unit.suppression > 0.82;
    const target           = this.findBestTarget(unit, enemies);
    const inRange          = target && target.inRange;

    // Critical suppression: forced retreat
    if (heavilySuppressed && underFire && unit.tacState !== TAC.RETREAT) {
      unit.retreatTarget = this.findBestCoverPoint(unit, enemies);
      unit.retreatUntil  = this.elapsed + 4.0 + Math.random() * 2.0;
      unit.tacState      = TAC.RETREAT;
      return;
    }

    // Persisting retreat
    if (unit.tacState === TAC.RETREAT) {
      if (this.elapsed > unit.retreatUntil && !underFire) {
        unit.tacState = TAC.RALLY;
        unit.rallyTimer = 2.5 + Math.random() * 1.5;
      }
      return;
    }

    // Rally: recover at cover
    if (unit.tacState === TAC.RALLY) {
      unit.rallyTimer = (unit.rallyTimer || 0) - dt;
      if (unit.rallyTimer <= 0) {
        unit.tacState = TAC.ADVANCE;
      }
      return;
    }

    // In range and not suppressed → ENGAGE
    if (inRange && !suppressed) {
      unit.tacState = TAC.ENGAGE;
      return;
    }

    // Bounding overwatch infantry
    if (unit.category === "Infantry") {
      const phase = this.boundPhase[unit.faction];
      if (unit.boundGroup === phase) {
        // My group bounds (moves)
        unit.tacState = this.shouldUnitFlank(unit, intel) ? TAC.FLANK : TAC.ADVANCE;
      } else {
        // Other group bounds — I provide covering fire or overwatch
        unit.tacState = target ? TAC.SUPPRESS : TAC.OVERWATCH;
      }
      return;
    }

    // Tanks: seek hull-down when facing armor threat
    if (unit.armor === "Heavy" && intel && intel.primaryThreat === "ARMOR") {
      const hdPos = this.findHullDownPosition(unit, enemies);
      if (hdPos && Math.hypot(hdPos.x - unit.x, hdPos.y - unit.y) > 80) {
        unit.hullDownTarget = hdPos;
        unit.tacState       = TAC.HULL_DOWN;
        return;
      }
    }

    // Default: advance or flank
    unit.tacState = this.shouldUnitFlank(unit, intel) ? TAC.FLANK : TAC.ADVANCE;
  }

  // ---- Aircraft FSM ----
  updateAircraftFSM(unit, enemies, dt) {
    if (!unit.tacState || unit.tacState === TAC.IDLE) {
      unit.tacState = TAC.ORBIT;
    }

    switch (unit.tacState) {
      case TAC.ORBIT: {
        if (unit.ammo <= 0) { unit.tacState = TAC.REARM; return; }
        const t = this.findBestTarget(unit, enemies);
        if (t && t.target) {
          unit.attackTarget = t.target;
          // Fixed-wing: only enter run if roughly aligned
          if (unit.speed > 350) {
            unit.attackRunTimer = 4.5;
          } else {
            // Rotary-wing: only run when within 1.1× range
            const d = Math.hypot(t.target.x - unit.x, t.target.y - unit.y);
            if (d > unit.range * 1.15) return; // Keep orbiting
            unit.attackRunTimer = 5.5;
          }
          unit.tacState = TAC.ATTACK_RUN;
        }
        break;
      }
      case TAC.ATTACK_RUN: {
        if (unit.ammo <= 0) { unit.tacState = TAC.EGRESS; unit.egressTimer = 2.0; return; }
        if (!unit.attackTarget || unit.attackTarget.neutralized) {
          unit.tacState = TAC.EGRESS; unit.egressTimer = 2.0; return;
        }
        unit.attackRunTimer = (unit.attackRunTimer || 4) - dt;
        if (unit.attackRunTimer <= 0) {
          unit.tacState   = TAC.EGRESS;
          unit.egressTimer = unit.speed > 350 ? 4.0 : 2.5;
          unit.attackTarget = null;
        }
        break;
      }
      case TAC.EGRESS: {
        unit.egressTimer = (unit.egressTimer || 2) - dt;
        if (unit.egressTimer <= 0) {
          unit.tacState = TAC.ORBIT;
        }
        break;
      }
      case TAC.REARM:
        // Out of ammo — aircraft just orbits harmlessly
        break;
      default:
        unit.tacState = TAC.ORBIT;
    }
  }

  // ---- Artillery FSM ----
  updateArtilleryFSM(unit, enemies, dt) {
    if (unit.ammo <= 0) { unit.tacState = TAC.REARM; return; }
    const minRange = unit.range * 0.18;
    const t = this.findArtilleryTarget(unit, enemies, minRange);
    if (t) {
      unit.artTarget = t;
      unit.tacState  = TAC.HOLD;
    } else {
      // No target in range — try to reposition
      unit.tacState = TAC.ADVANCE;
    }
  }

  // ============================================================
  // TACTICAL STATE EXECUTION
  // ============================================================
  executeTacticalState(unit, allies, enemies, intel, dt) {
    switch (unit.tacState) {
      case TAC.ENGAGE:      this.executeEngage(unit, enemies, dt);         break;
      case TAC.SUPPRESS:    this.executeSuppress(unit, enemies, dt);       break;
      case TAC.OVERWATCH:   this.executeOverwatch(unit, enemies, dt);      break;
      case TAC.ADVANCE:     this.executeAdvance(unit, enemies, intel, dt); break;
      case TAC.FLANK:       this.executeFlank(unit, enemies, intel, dt);   break;
      case TAC.RETREAT:     this.executeRetreat(unit, enemies, dt);        break;
      case TAC.RALLY:       /* Stand still — recover suppression */        break;
      case TAC.HULL_DOWN:   this.executeHullDown(unit, enemies, dt);       break;
      case TAC.ORBIT:       this.executeOrbit(unit, enemies, dt);          break;
      case TAC.ATTACK_RUN:  this.executeAttackRun(unit, enemies, dt);      break;
      case TAC.EGRESS:      this.executeEgress(unit, dt);                  break;
      case TAC.HOLD:        this.executeHold(unit, enemies, dt);           break;
      case TAC.REARM:       /* Inert — no action */                        break;
      default:              this.executeAdvance(unit, enemies, intel, dt); break;
    }
  }

  // ---- ENGAGE ----
  executeEngage(unit, enemies, dt) {
    const ti = this.getTargetInfo(unit, enemies, dt);
    if (!ti) return;
    if (ti.inRange && unit.cooldown <= 0) {
      this.fireAtTarget(unit, ti.target, ti.distance);
      unit.cooldown = unit.fireInterval * (0.85 + Math.random() * 0.3);
    } else if (!ti.inRange) {
      this.moveAlongPath(unit, ti.target, dt, ti.target.id, 5, 0.85);
    }
  }

  // ---- SUPPRESS (covering fire, less accurate but faster) ----
  executeSuppress(unit, enemies, dt) {
    const elevMult = this.getElevationMultiplier(unit);
    let best = null; let bestDist = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - unit.x, e.y - unit.y);
      if (d > unit.range * elevMult * 1.15) continue;
      if (!this.hasLineOfSight(unit, e)) continue;
      if (!this.canDamageTarget(unit, e)) continue;
      if (d < bestDist) { bestDist = d; best = e; }
    }
    if (!best || unit.cooldown > 0 || unit.ammo <= 0) return;

    // Suppressive burst: higher rate, applies suppression, reduced kill chance
    best.suppression = Math.min(1, best.suppression + unit.suppressionPower * 1.4);
    best.lastUnderFireAt = this.elapsed;
    best.lastAttackerId  = unit.id;
    unit.ammo  -= 1;
    unit.ammoSpent = (unit.ammoSpent || 0) + 1;
    this.stats[unit.faction].ammoSpent += 1;
    unit.cooldown = unit.fireInterval * 0.55; // Faster suppressive rate
    this.addFireEffect(unit, best, false);

    // Small chance of suppression shot causing a kill
    const armorMult = this.getArmorMultiplier(unit.weapon, best.armor, best.category);
    if (Math.random() < unit.accuracy * 0.25 * armorMult) {
      this.neutralizeUnit(unit, best);
    }
  }

  // ---- OVERWATCH (hold position, engage if target appears) ----
  executeOverwatch(unit, enemies, dt) {
    const ti = this.getTargetInfo(unit, enemies, dt);
    if (ti && ti.inRange && unit.cooldown <= 0) {
      this.fireAtTarget(unit, ti.target, ti.distance);
      unit.cooldown = unit.fireInterval * (0.9 + Math.random() * 0.2);
    }
    // No movement
  }

  // ---- ADVANCE (cover-to-cover movement toward enemy) ----
  executeAdvance(unit, enemies, intel, dt) {
    if (enemies.length === 0) return;
    const ti = this.getTargetInfo(unit, enemies, dt);

    let dest;
    if (ti && ti.target) {
      // Advance to a covered position at effective range
      const coverPos = this.findAdvanceCoverPosition(unit, ti.target);
      dest = coverPos || ti.target;
    } else {
      const ec = (intel && intel.enemyCenter) || this.centroid(enemies);
      const coverPos = this.findAdvanceCoverPosition(unit, ec);
      dest = coverPos || ec;
    }

    // Add formation spacing offset so units don't stack
    const offset = this.getFormationOffset(unit);
    const finalDest = this.clampPointToMap({ x: dest.x + offset.x, y: dest.y + offset.y });

    // Slow down as we close with the enemy (tactical caution)
    const distToEnemy = enemies.reduce((m, e) =>
      Math.min(m, Math.hypot(e.x - unit.x, e.y - unit.y)), Infinity);
    const speedScale = distToEnemy < 350 ? 0.55 : (distToEnemy < 700 ? 0.78 : 1.0);

    this.moveAlongPath(unit, finalDest, dt, "adv_" + unit.id, 5, speedScale);

    // Opportunity fire while advancing (suppression-only to avoid halting)
    if (ti && ti.inRange && unit.cooldown <= 0) {
      this.executeSuppress(unit, enemies, dt);
    }
  }

  // ---- FLANK ----
  executeFlank(unit, enemies, intel, dt) {
    const obj = this.flankObj[unit.faction];
    if (!obj) { this.executeAdvance(unit, enemies, intel, dt); return; }

    const dist = Math.hypot(obj.x - unit.x, obj.y - unit.y);
    if (dist < 120) {
      // Reached flank position — switch to engage
      unit.tacState = TAC.ENGAGE;
      return;
    }

    this.moveAlongPath(unit, obj, dt, "flank_" + unit.faction, 5, 0.92);

    // Opportunity fire from the flank approach
    const ti = this.getTargetInfo(unit, enemies, dt);
    if (ti && ti.inRange && unit.cooldown <= 0) {
      this.fireAtTarget(unit, ti.target, ti.distance);
      unit.cooldown = unit.fireInterval;
    }
  }

  // ---- RETREAT (to cover) ----
  executeRetreat(unit, enemies, dt) {
    if (!unit.retreatTarget) {
      unit.retreatTarget = this.findBestCoverPoint(unit, enemies);
      if (!unit.retreatTarget) {
        // Pure fallback: move directly away from threat
        const td = this.getThreatDirection(unit, enemies);
        unit.retreatTarget = this.clampPointToMap({
          x: unit.x - td.x * 350,
          y: unit.y - td.y * 350
        });
      }
    }
    this.moveAlongPath(unit, unit.retreatTarget, dt, "retreat", 3, 1.15);
  }

  // ---- HULL DOWN (tank finds defilade on reverse slope) ----
  executeHullDown(unit, enemies, dt) {
    if (!unit.hullDownTarget) { unit.tacState = TAC.ENGAGE; return; }
    const d = Math.hypot(unit.hullDownTarget.x - unit.x, unit.hullDownTarget.y - unit.y);
    if (d < 55) {
      unit.hullDownTarget = null;
      unit.tacState = TAC.ENGAGE;
      return;
    }
    this.moveAlongPath(unit, unit.hullDownTarget, dt, "hd", 5, 0.75);
    // Snap-shot while repositioning
    const ti = this.getTargetInfo(unit, enemies, dt);
    if (ti && ti.inRange && unit.cooldown <= 0) {
      this.fireAtTarget(unit, ti.target, ti.distance);
      unit.cooldown = unit.fireInterval * 1.4; // Slower while moving
    }
  }

  // ---- HOLD (artillery indirect fire + shoot-and-scoot) ----
  executeHold(unit, enemies, dt) {
    if (unit.category === "Artillery") {
      const minRange = unit.range * 0.18;
      const t = unit.artTarget || this.findArtilleryTarget(unit, enemies, minRange);
      if (!t) return;
      unit.artTarget = t;
      if (unit.cooldown <= 0 && unit.ammo > 0) {
        this.fireIndirect(unit, t);
        unit.cooldown = unit.fireInterval * (0.9 + Math.random() * 0.4);
        unit.artShotsFired = (unit.artShotsFired || 0) + 1;
        // Shoot-and-scoot: after 2–3 rounds, relocate to avoid counter-battery
        if (unit.artShotsFired >= 2 + Math.floor(Math.random() * 2)) {
          unit.artShotsFired = 0;
          unit.artTarget     = null;
          this.scootArtillery(unit);
        }
      }
      return;
    }
    // Non-artillery in HOLD: static fire
    const ti = this.getTargetInfo(unit, enemies, dt);
    if (ti && ti.inRange && unit.cooldown <= 0) {
      this.fireAtTarget(unit, ti.target, ti.distance);
      unit.cooldown = unit.fireInterval * (0.9 + Math.random() * 0.2);
    }
  }

  // ---- ORBIT (aircraft loiters around enemy) ----
  executeOrbit(unit, enemies, dt) {
    const ec = this.centroid(enemies);
    if (!ec) return;
    const orbitR = unit.range * 0.85;
    unit.orbitAngle = (unit.orbitAngle || Math.random() * Math.PI * 2) +
                      dt * (unit.speed / (orbitR * 6.28));
    const tx = ec.x + Math.cos(unit.orbitAngle) * orbitR;
    const ty = ec.y + Math.sin(unit.orbitAngle) * orbitR;
    this.moveToward(unit, { x: tx, y: ty }, dt, 1.0);
  }

  // ---- ATTACK RUN ----
  executeAttackRun(unit, enemies, dt) {
    if (!unit.attackTarget || unit.attackTarget.neutralized) {
      unit.tacState = TAC.EGRESS; unit.egressTimer = 2.0;
      return;
    }
    // Fixed-wing comes in fast; rotary-wing more deliberate
    const speedMult = unit.speed > 350 ? 1.35 : 1.1;
    this.moveToward(unit, unit.attackTarget, dt, speedMult);

    const dist = Math.hypot(unit.attackTarget.x - unit.x, unit.attackTarget.y - unit.y);
    if (dist <= unit.range && unit.cooldown <= 0 && unit.ammo > 0) {
      this.fireAtTarget(unit, unit.attackTarget, dist);
      unit.cooldown = unit.fireInterval * (0.8 + Math.random() * 0.4);
    }
    // Jets pull out after a very close pass
    if (dist < unit.range * 0.2) {
      unit.tacState   = TAC.EGRESS;
      unit.egressTimer = unit.speed > 350 ? 4.5 : 2.5;
    }
  }

  // ---- EGRESS (aircraft exits attack zone) ----
  executeEgress(unit, dt) {
    // Fly away from last known threat area
    const ec = unit.attackTarget
      ? { x: unit.attackTarget.x, y: unit.attackTarget.y }
      : { x: MAP_CONFIG.width / 2, y: MAP_CONFIG.height / 2 };
    const dx  = unit.x - ec.x;
    const dy  = unit.y - ec.y;
    const len = Math.hypot(dx, dy) || 1;
    // Fixed-wing egresses faster and farther
    const egDist = unit.speed > 350 ? unit.range * 0.7 : unit.range * 0.45;
    const egressDest = this.clampPointToMap({
      x: unit.x + (dx / len) * egDist,
      y: unit.y + (dy / len) * egDist
    });
    this.moveToward(unit, egressDest, dt, unit.speed > 350 ? 1.4 : 1.1);
  }

  // ============================================================
  // INDIRECT FIRE (Artillery / Mortars / MLRS)
  // ============================================================
  fireIndirect(unit, target) {
    if (unit.ammo <= 0) return;
    unit.ammo  -= 1;
    unit.ammoSpent = (unit.ammoSpent || 0) + 1;
    this.stats[unit.faction].ammoSpent += 1;

    // Dispersion increases with range
    const dist     = Math.hypot(target.x - unit.x, target.y - unit.y);
    const rangeRatio = Math.min(1, dist / unit.range);
    const baseDisp = unit.templateId === "rocket_artillery" ? 120 : 45;
    const dispersion = baseDisp + rangeRatio * baseDisp;

    const impactX = target.x + (Math.random() - 0.5) * dispersion * 2;
    const impactY = target.y + (Math.random() - 0.5) * dispersion * 2;

    // Splash radius: MLRS larger, mortars smaller
    const splashR = unit.templateId === "rocket_artillery" ? 250
                  : unit.templateId === "mortar_team"       ? 120
                  : 180;

    // Visual effects
    if (this.renderer) {
      this.renderer.addEffect({
        type: "projectile",
        from: { x: unit.x, y: unit.y },
        to:   { x: impactX, y: impactY },
        ttl: 0.7, baseTtl: 0.7,
        color: "rgba(241,180,15,0.9)", radius: 7
      });
      setTimeout(() => {
        if (this.renderer) {
          this.renderer.addEffect({
            type: "explosion",
            x: impactX, y: impactY,
            radius: splashR * 0.35,
            ttl: 0.9, baseTtl: 0.9
          });
        }
      }, 600);
    }

    // Apply splash to all enemy units in radius
    const allUnits = this.state.units;
    for (const u of allUnits) {
      if (u.neutralized || u.faction === unit.faction) continue;
      const sd = Math.hypot(u.x - impactX, u.y - impactY);
      if (sd > splashR) continue;
      const falloff = 1 - sd / splashR;

      u.suppression      = Math.min(1, u.suppression + unit.suppressionPower * falloff * 1.6);
      u.lastUnderFireAt  = this.elapsed;
      u.lastAttackerId   = unit.id;

      // Kill chance — falls off sharply at range from impact
      const armorMult = this.getArmorMultiplier(unit.weapon, u.armor, u.category);
      const killChance = unit.accuracy * armorMult * falloff * falloff; // square law
      if (Math.random() < killChance) {
        this.neutralizeUnit(unit, u);
      }
    }
  }

  /** Move artillery to a new position after firing to avoid counter-battery */
  scootArtillery(unit) {
    const scdist = 250 + Math.random() * 300;
    const angle  = Math.random() * Math.PI * 2;
    unit.scootTarget = this.clampPointToMap({
      x: unit.x + Math.cos(angle) * scdist,
      y: unit.y + Math.sin(angle) * scdist
    });
    unit.tacState = TAC.ADVANCE;
    unit.path     = [];
    unit.pathIndex = 0;
  }

  /** Select best artillery target: in range, beyond dead-zone, clustered targets preferred */
  findArtilleryTarget(unit, enemies, minRange) {
    let best = null; let bestScore = -Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - unit.x, e.y - unit.y);
      if (d < minRange || d > unit.range) continue;
      // Cluster bonus: enemies near this target
      let cluster = 0;
      for (const o of enemies) {
        if (o !== e && Math.hypot(o.x - e.x, o.y - e.y) < 200) cluster += 4;
      }
      const typeScore = e.category === "Vehicle" ? 8
                      : e.category === "Artillery" ? 12
                      : 3;
      const score = cluster + typeScore - d * 0.0001;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  // ============================================================
  // TERRAIN ANALYSIS
  // ============================================================
  /** Find a covered position between unit and destination */
  findAdvanceCoverPosition(unit, destination) {
    const dx  = destination.x - unit.x;
    const dy  = destination.y - unit.y;

    let bestScore = -Infinity;
    let bestPoint = null;

    // Sample positions along approach axis
    for (let t = 0.15; t <= 0.85; t += 0.12) {
      const mx = unit.x + dx * t;
      const my = unit.y + dy * t;

      // Check for nearby building cover
      if (mapData.buildings) {
        for (const b of mapData.buildings) {
          const bCx = b.x + b.width / 2;
          const bCy = b.y + b.height / 2;
          const dm  = Math.hypot(bCx - mx, bCy - my);
          if (dm < 220) {
            // Position on friendly-side edge of building
            const bx = b.x + b.width / 2 - (dx / (Math.hypot(dx, dy) || 1)) * (b.width / 2 + 18);
            const by = b.y + b.height / 2 - (dy / (Math.hypot(dx, dy) || 1)) * (b.height / 2 + 18);
            if (!this.isPointInsideBuilding({ x: bx, y: by })) {
              const score = t * 10 - dm * 0.008;
              if (score > bestScore) { bestScore = score; bestPoint = { x: bx, y: by }; }
            }
          }
        }
      }

      // Hillside cover
      for (const h of mapData.hills) {
        const dh = Math.hypot(h.x - mx, h.y - my);
        if (dh < h.radius * 0.65) {
          const score = t * 7 + h.elevation * 1.5;
          if (score > bestScore) { bestScore = score; bestPoint = { x: mx, y: my }; }
        }
      }
    }
    return bestPoint;
  }

  /** Find a reverse-slope (defilade) position for a tank */
  findHullDownPosition(unit, enemies) {
    if (!mapData.hills || mapData.hills.length === 0) return null;
    const ec = this.centroid(enemies);
    if (!ec) return null;

    let best = null; let bestScore = -Infinity;
    for (const h of mapData.hills) {
      const dx = h.x - ec.x;
      const dy = h.y - ec.y;
      const len = Math.hypot(dx, dy) || 1;

      // Position just behind crest on friendly side
      const pos = {
        x: h.x + (dx / len) * h.radius * 0.50,
        y: h.y + (dy / len) * h.radius * 0.50
      };

      const fromUnit  = Math.hypot(pos.x - unit.x, pos.y - unit.y);
      const fromEnemy = Math.hypot(pos.x - ec.x, pos.y - ec.y);
      if (fromUnit > 1400) continue;
      if (fromEnemy < unit.range * 0.45 || fromEnemy > unit.range * 1.05) continue;

      const score = h.elevation * 3 - fromUnit * 0.0008;
      if (score > bestScore) { bestScore = score; best = pos; }
    }
    return best;
  }

  /** Find best cover to retreat to, away from threat direction */
  findBestCoverPoint(unit, enemies) {
    const td = this.getThreatDirection(unit, enemies);
    let best = null; let bestScore = -Infinity;

    if (mapData.buildings) {
      for (const b of mapData.buildings) {
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        // Far side of building from threat
        const sx = cx - td.x * (b.width / 2 + 22);
        const sy = cy - td.y * (b.height / 2 + 22);
        if (this.isPointInsideBuilding({ x: sx, y: sy })) continue;
        const d = Math.hypot(sx - unit.x, sy - unit.y);
        const score = 100 - d * 0.04;
        if (score > bestScore) { bestScore = score; best = { x: sx, y: sy }; }
      }
    }
    for (const h of mapData.hills) {
      const pos = {
        x: h.x - td.x * h.radius * 0.55,
        y: h.y - td.y * h.radius * 0.55
      };
      const d = Math.hypot(pos.x - unit.x, pos.y - unit.y);
      const score = h.elevation * 18 - d * 0.04;
      if (score > bestScore) { bestScore = score; best = this.clampPointToMap(pos); }
    }
    return best;
  }

  // ============================================================
  // FORMATION OFFSET (prevent stacking)
  // ============================================================
  getFormationOffset(unit) {
    const s = unit.category === "Vehicle" ? 90 : 45;
    switch (unit.formationRole) {
      case ROLE.LEAD:    return { x: 0, y: 0 };
      case ROLE.FLANK_L: return { x: -s * 0.9, y: s * 0.5 };
      case ROLE.FLANK_R: return { x:  s * 0.9, y: s * 0.5 };
      case ROLE.REAR:    return { x: 0, y:  s * 1.2 };
      case ROLE.SUPPORT: return { x: 0, y:  s * 2.2 };
      case ROLE.BOUND_A: return { x: -s * 0.3, y: -s * 0.2 };
      case ROLE.BOUND_B: return { x:  s * 0.3, y:  s * 0.2 };
      default: {
        const seed = parseInt((unit.id || "0").replace(/\D/g, ""), 10) || 0;
        return {
          x: (((seed * 1731 + 13) % 7) - 3) * s * 0.3,
          y: (((seed * 2311 + 7)  % 7) - 3) * s * 0.3
        };
      }
    }
  }

  // ============================================================
  // FLANKING DECISION
  // ============================================================
  shouldUnitFlank(unit, intel) {
    if (!intel) return false;
    if (unit.category === "Artillery" || unit.category === "Aircraft") return false;
    if (unit.armor === "Heavy") return false; // Tanks hold the centre
    if (intel.totalStrength < 2) return false;
    // Use unit-id hash for deterministic but varied assignment
    const n = parseInt((unit.id || "0").replace(/\D/g, ""), 10) || 0;
    return n % 3 === 1;
  }

  // ============================================================
  // DIRECTION HELPERS
  // ============================================================
  getThreatDirection(unit, enemies) {
    if (!enemies || enemies.length === 0) return { x: 0, y: -1 };
    let closest = enemies[0]; let closestD = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - unit.x, e.y - unit.y);
      if (d < closestD) { closestD = d; closest = e; }
    }
    const dx = closest.x - unit.x; const dy = closest.y - unit.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  centroid(units) {
    if (!units || units.length === 0) return null;
    let sx = 0; let sy = 0;
    for (const u of units) { sx += u.x; sy += u.y; }
    return { x: sx / units.length, y: sy / units.length };
  }

  // ============================================================
  // UNIT STATE INITIALISATION
  // ============================================================
  ensureUnitState(unit) {
    if (typeof unit.fireInterval !== "number") unit.fireInterval = this.deriveFireInterval(unit);
    if (typeof unit.speed       !== "number") unit.speed        = this.deriveSpeed(unit);
    if (typeof unit.usesRoads   !== "boolean") {
      unit.usesRoads = unit.category === "Vehicle" ||
        (unit.category === "Artillery" && unit.armor !== "Unarmored");
    }
    if (typeof unit.cooldown !== "number") unit.cooldown = Math.random() * unit.fireInterval;
    if (!unit.path) {
      unit.path = []; unit.pathIndex = 0;
      unit.pathTargetId = ""; unit.pathAge = 0;
      unit.pathTargetKey = ""; unit.pathGoal = null;
    }
    if (typeof unit.targetId        !== "string") { unit.targetId = ""; unit.targetLostTime = 0; }
    if (typeof unit.lastUnderFireAt !== "number") unit.lastUnderFireAt = -Infinity;
    if (typeof unit.lastAttackerId  !== "string") unit.lastAttackerId  = "";
    if (typeof unit.retreatUntil    !== "number") unit.retreatUntil = 0;
    if (!unit.retreatTarget) unit.retreatTarget = null;
    if (!unit.tacState) unit.tacState = unit.category === "Aircraft" ? TAC.ORBIT : TAC.ADVANCE;
    if (!unit.formationRole) unit.formationRole = ROLE.LEAD;
  }

  // ============================================================
  // NAV GRID
  // ============================================================
  getNavGrid() {
    const ver = typeof mapData.navVersion === "number" ? mapData.navVersion : 0;
    if (!this.navGrid || this.navVersion !== ver) {
      this.navGrid    = buildNavGrid(mapData, 200);
      this.navVersion = ver;
    }
    return this.navGrid;
  }

  // ============================================================
  // TARGETING
  // ============================================================
  findBestTarget(unit, enemies) {
    return this.getTargetInfo(unit, enemies, 0);
  }

  getTargetInfo(unit, enemies, dt) {
    // Try locked target first
    if (unit.targetId) {
      const locked = this.findEnemyById(enemies, unit.targetId);
      if (locked) {
        const info = this.evaluateTarget(unit, locked);
        if (info) { unit.targetLostTime = 0; return info; }
        unit.targetLostTime += dt;
        if (unit.targetLostTime < 2.2) return null;
      }
    }
    const best = this.findTarget(unit, enemies);
    if (best && best.target) { unit.targetId = best.target.id; unit.targetLostTime = 0; }
    return best;
  }

  findTarget(unit, enemies) {
    let best = null; let bestScore = -Infinity; let inRange = false;
    const elevMult = this.getElevationMultiplier(unit);
    // Use weapon range for targeting, not detection range
    const unitRange = unit.range * elevMult;
    // Detection should be limited by weapon effectiveness - you can spot further than you can shoot
    const effectiveDetection = Math.min(unit.detection, unitRange * 1.4) * elevMult;

    for (const enemy of enemies) {
      const dist = Math.hypot(enemy.x - unit.x, enemy.y - unit.y);
      if (dist > effectiveDetection) continue;
      if (!this.hasLineOfSight(unit, enemy)) continue;
      if (!this.canDamageTarget(unit, enemy)) continue;

      const withinRange = dist <= unitRange;
      const score = this.calculateTargetPriority(unit, enemy, dist)
                  + (withinRange ? 500 : 0)
                  + Math.max(0, 1000 - dist);

      if (score > bestScore) { best = enemy; bestScore = score; inRange = withinRange; }
    }
    if (!best) return null;
    return { target: best, distance: Math.hypot(best.x - unit.x, best.y - unit.y), inRange };
  }

  evaluateTarget(unit, enemy) {
    const dist = Math.hypot(enemy.x - unit.x, enemy.y - unit.y);
    const elevMult = this.getElevationMultiplier(unit);
    // Use effective detection based on weapon range
    const effectiveDetection = Math.min(unit.detection, unit.range * 1.4) * elevMult;
    if (dist > effectiveDetection) return null;
    if (!this.hasLineOfSight(unit, enemy)) return null;
    if (!this.canDamageTarget(unit, enemy)) return null;
    return { target: enemy, distance: dist, inRange: dist <= unit.range * elevMult };
  }

  findEnemyById(enemies, id) {
    for (const e of enemies) { if (e.id === id) return e; }
    return null;
  }

  canDamageTarget(attacker, target) {
    return this.getArmorMultiplier(attacker.weapon, target.armor, target.category) > 0.08;
  }

  calculateTargetPriority(attacker, target, distance) {
    let score = this.getArmorMultiplier(attacker.weapon, target.armor, target.category) * 200;

    if (attacker.templateId === "sniper_team") {
      return score + (target.armor === "Unarmored" ? 800 : 0)
                   + (target.weapon === "Anti-Armor" ? 400 : 0);
    }
    if (attacker.weapon === "Anti-Armor") {
      return score + (target.armor === "Heavy"    ? 600 : 0)
                   + (target.armor === "Light"    ? 350 : 0)
                   + (target.armor === "Unarmored" ? -200 : 0);
    }
    if (attacker.weapon === "Anti-Air") {
      return score + (target.category === "Aircraft" ? 1500 : -500);
    }
    if (attacker.weapon === "Heavy MG" || attacker.weapon === "Auto Cannon") {
      return score + (target.armor === "Unarmored" ? 300 : 0)
                   + (target.armor === "Light"    ? 250 : 0)
                   + (target.armor === "Heavy"    ? -400 : 0);
    }
    if (attacker.weapon === "Small Arms") {
      return score + (target.armor === "Unarmored" ? 400 : -500);
    }
    if (attacker.category === "Aircraft") {
      return score + (target.category === "Aircraft" ? 500 : 0)
                   + (target.weapon === "Anti-Air"   ? 450 : 0)
                   + (target.armor  === "Unarmored"  ? 150 : 0);
    }
    if (target.suppression > 0.4) score += 50; // Finish off suppressed targets
    return score;
  }

  // ============================================================
  // FIRE RESOLUTION
  // ============================================================
  fireAtTarget(unit, target, distance) {
    // Re-validate that this unit can actually damage the target
    const armorMult = this.getArmorMultiplier(unit.weapon, target.armor, target.category);
    if (armorMult <= 0.08) return; // Cannot damage this target type
    
    const elevMult    = this.getElevationMultiplier(unit);
    const rangeRatio  = Math.min(1, distance / (unit.range * elevMult));
    // Steeper range falloff: accuracy drops significantly beyond 50% of max range
    const rangeFalloff = Math.max(0.08, 1 - Math.pow(rangeRatio, 0.9));
    const suppPenalty = Math.max(0.18, 1 - unit.suppression);
    const coverBonus  = this.isInCover(target) ? 0.65 : 1.0; // cover reduces hit chance

    let hitChance = unit.accuracy * rangeFalloff * armorMult * suppPenalty * coverBonus;
    hitChance = Math.max(0, Math.min(0.85, hitChance));

    unit.ammo  -= 1;
    unit.ammoSpent = (unit.ammoSpent || 0) + 1;
    this.stats[unit.faction].ammoSpent += 1;
    target.suppression    = Math.min(1, target.suppression + unit.suppressionPower);
    target.lastUnderFireAt = this.elapsed;
    target.lastAttackerId  = unit.id;

    this.addFireEffect(unit, target, true);

    if (Math.random() < hitChance) {
      this.neutralizeUnit(unit, target);
    }
  }

  neutralizeUnit(attacker, target) {
    target.neutralized = true;
    attacker.kills = (attacker.kills || 0) + 1;
    this.stats[target.faction].casualties += 1;
    if (this.renderer) {
      this.renderer.addEffect({
        type: "explosion",
        x: target.x, y: target.y,
        radius: target.size * 2.4,
        ttl: 0.5, baseTtl: 0.5
      });
    }
  }

  addFireEffect(unit, target, withLaser) {
    if (!this.renderer) return;
    let color = "rgba(52,152,219,0.9)"; let radius = 3;
    if (unit.weapon === "Explosive")   { color = "rgba(241,196,15,0.9)";  radius = 5; }
    if (unit.weapon === "Anti-Armor")  { color = "rgba(231,76,60,0.9)";   radius = 4; }
    if (unit.weapon === "Anti-Air")    { color = "rgba(155,89,182,0.9)";  radius = 4; }
    if (unit.weapon === "Heavy MG")    { color = "rgba(241,196,15,0.9)";  radius = 3; }
    if (unit.weapon === "Combined Arms") { color = "rgba(231,76,60,0.9)"; radius = 5; }

    this.renderer.addEffect({ type: "projectile",
      from: { x: unit.x, y: unit.y }, to: { x: target.x, y: target.y },
      ttl: 0.25, baseTtl: 0.25, color, radius });
    this.renderer.addEffect({ type: "muzzle_flash",
      x: unit.x, y: unit.y, radius: unit.size * 0.6, ttl: 0.12, baseTtl: 0.12 });
    if (withLaser) {
      this.renderer.addEffect({ type: "laser",
        from: { x: unit.x, y: unit.y }, to: { x: target.x, y: target.y },
        ttl: 0.08, color });
    }
    if (this.renderer.unitAnim && this.renderer.unitAnim[unit.id]) {
      this.renderer.unitAnim[unit.id].flashTimer = 0.6;
    }
  }

  /** Returns true if unit is inside a building or on a hill */
  isInCover(unit) {
    if (this.isPointInsideBuilding(unit)) return true;
    for (const h of mapData.hills) {
      if (Math.hypot(unit.x - h.x, unit.y - h.y) < h.radius * 0.45) return true;
    }
    return false;
  }

  // ============================================================
  // MOVEMENT
  // ============================================================
  moveAlongPath(unit, destination, dt, pathId, repathAge, speedScale) {
    const nav = this.getNavGrid();
    if (unit.category === "Aircraft") {
      this.moveToward(unit, destination, dt, speedScale);
      return;
    }
    const targetKey = this.navCellKey(destination, nav);
    const goalDist  = unit.pathGoal
      ? Math.hypot(destination.x - unit.pathGoal.x, destination.y - unit.pathGoal.y)
      : Infinity;
    const needsPath = !unit.path || unit.path.length === 0
      || unit.pathTargetId  !== pathId
      || unit.pathTargetKey !== targetKey
      || unit.pathAge       > repathAge
      || goalDist           > 140;

    if (needsPath) {
      unit.path      = findPath({ x: unit.x, y: unit.y }, destination, unit, nav);
      unit.pathIndex = 0;
      unit.pathTargetId  = pathId;
      unit.pathTargetKey = targetKey;
      unit.pathAge       = 0;
      unit.pathGoal      = { x: destination.x, y: destination.y };
    }

    this.advancePathIndex(unit, 16);
    const waypoint = this.getLookaheadWaypoint(unit);
    this.moveToward(unit, waypoint || destination, dt, speedScale);
    this.advancePathIndex(unit, 14);
  }

  advancePathIndex(unit, threshold) {
    if (!unit.path || unit.path.length === 0) return;
    while (unit.pathIndex < unit.path.length) {
      if (Math.hypot(unit.path[unit.pathIndex].x - unit.x,
                     unit.path[unit.pathIndex].y - unit.y) > threshold) break;
      unit.pathIndex += 1;
    }
  }

  getLookaheadWaypoint(unit) {
    if (!unit.path || unit.pathIndex >= unit.path.length) return null;
    return unit.path[Math.min(unit.path.length - 1, unit.pathIndex + 2)];
  }

  moveToward(unit, dest, dt, speedScale) {
    const dx = dest.x - unit.x; const dy = dest.y - unit.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 6) return;
    const speed = this.getSpeed(unit) * (speedScale || 1) * dt;
    const step  = Math.min(speed, dist);
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
    // unit.speed is defined in km/h in the unit dictionary
    // Convert to game units: divide by 3.6 to get realistic tactical movement
    let spd = unit.speed !== undefined ? unit.speed / 3.6 : unit.mobility * 12;
    spd *= Math.max(0.18, 1 - unit.suppression * 0.75);
    if (unit.usesRoads) spd *= this.getRoadFactor(unit);
    return spd;
  }

  getRoadFactor(unit) {
    const ri = this.isOnRoad(unit);
    if (!ri.onRoad) return 0.72;
    return ri.type === "Highway" ? 1.38 : 1.16;
  }

  isOnRoad(unit) {
    for (const road of mapData.roads) {
      if (!road.points || road.points.length < 2) continue;
      for (let s = 0; s < road.points.length - 1; s += 1) {
        if (this.distPtSeg(unit, road.points[s], road.points[s + 1]) < 32) {
          return { onRoad: true, type: road.type };
        }
      }
    }
    return { onRoad: false, type: "" };
  }

  // ============================================================
  // SPEED / FIRE INTERVAL DERIVATION
  // ============================================================
  deriveSpeed(unit) {
    if (unit.category === "Infantry")  return 1.4 * unit.mobility;
    if (unit.category === "Vehicle")   return (unit.armor === "Heavy" ? 11 : 15) * unit.mobility;
    if (unit.category === "Artillery") return (unit.armor === "Unarmored" ? 1.2 : 8.5) * unit.mobility;
    if (unit.category === "Aircraft")  return 80 * unit.mobility;
    return 4 * unit.mobility;
  }

  deriveFireInterval(unit) {
    if (unit.weapon === "Small Arms")  return 1.1;
    if (unit.weapon === "Heavy MG")    return 0.7;
    if (unit.weapon === "Auto Cannon") return 1.0;
    if (unit.weapon === "Anti-Armor")  return 3.5;
    if (unit.weapon === "Explosive") return unit.category === "Artillery" ? 5.8 : 2.4;
    if (unit.weapon === "Anti-Air")  return unit.category === "Aircraft"  ? 2.2 : 3.6;
    if (unit.weapon === "Combined Arms") return 3.2;
    return 4;
  }

  // ============================================================
  // LINE OF SIGHT & GEOMETRY
  // ============================================================
  getElevationMultiplier(unit) {
    let elev = 1;
    for (const h of mapData.hills) {
      if (Math.hypot(unit.x - h.x, unit.y - h.y) <= h.radius && h.elevation > elev)
        elev = h.elevation;
    }
    return 1 + (elev - 1) * 0.4;
  }

  hasLineOfSight(unit, target) {
    if (unit.category === "Aircraft" || target.category === "Aircraft") return true;
    for (const h of mapData.hills) {
      if (h.elevation <= unit.height || h.elevation <= target.height) continue;
      if (this.lineIntersectsCircle(unit.x, unit.y, target.x, target.y,
                                    h.x, h.y, h.radius)) return false;
    }
    if (mapData.buildings) {
      for (const b of mapData.buildings) {
        if (this.lineIntersectsRect(unit.x, unit.y, target.x, target.y,
                                    b.x, b.y, b.width, b.height)) return false;
      }
    }
    return true;
  }

  lineIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
    return this.lineIntersectsLine(x1, y1, x2, y2, rx, ry, rx, ry + rh) ||
           this.lineIntersectsLine(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh) ||
           this.lineIntersectsLine(x1, y1, x2, y2, rx, ry, rx + rw, ry) ||
           this.lineIntersectsLine(x1, y1, x2, y2, rx, ry + rh, rx + rw, ry + rh);
  }

  lineIntersectsLine(x1, y1, x2, y2, x3, y3, x4, y4) {
    const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (d === 0) return false;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  lineIntersectsCircle(x1, y1, x2, y2, cx, cy, r) {
    const dx = x2 - x1; const dy = y2 - y1;
    const fx = x1 - cx; const fy = y1 - cy;
    const a  = dx * dx + dy * dy;
    const b  = 2 * (fx * dx + fy * dy);
    const c  = fx * fx + fy * fy - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a);
    const t2 = (-b + sq) / (2 * a);
    return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
  }

  distPtSeg(point, a, b) {
    const abx = b.x - a.x; const aby = b.y - a.y;
    const apx = point.x - a.x; const apy = point.y - a.y;
    const abL = abx * abx + aby * aby || 1;
    const t   = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abL));
    return Math.hypot(point.x - a.x - abx * t, point.y - a.y - aby * t);
  }

  isPointInsideBuilding(point) {
    if (!mapData.buildings) return false;
    for (const b of mapData.buildings) {
      if (point.x >= b.x && point.x <= b.x + b.width &&
          point.y >= b.y && point.y <= b.y + b.height) return true;
    }
    return false;
  }

  clampPointToMap(point) {
    return {
      x: Math.max(20, Math.min(MAP_CONFIG.width  - 20, point.x)),
      y: Math.max(20, Math.min(MAP_CONFIG.height - 20, point.y))
    };
  }

  // ============================================================
  // ARMOR MULTIPLIER TABLE (unchanged from v1 — correct values)
  // ============================================================
  getArmorMultiplier(weapon, armor, targetCategory) {
    if (weapon === "Anti-Air") return targetCategory === "Aircraft" ? 1.5 : 0.05;
    if (weapon === "None")     return 0;
    // Only Anti-Air weapons can effectively engage aircraft
    // All other weapons cannot target aircraft (no fire control systems, etc.)
    if (targetCategory === "Aircraft") {
      return 0;
    }
    if (weapon === "Combined Arms") {
      if (armor === "Heavy")   return 1.4;
      if (armor === "Medium")  return 1.2;
      if (armor === "Light")   return 1.0;
      return 0.6;
    }
    if (weapon === "Auto Cannon") {
      if (armor === "Heavy")   return 0.10;
      if (armor === "Medium")  return 0.55;
      if (armor === "Light")   return 1.0;
      return 0.7;
    }
    if (weapon === "Anti-Armor") {
      if (armor === "Heavy")   return 1.2;
      if (armor === "Medium")  return 1.1;
      if (armor === "Light")   return 1.0;
      return 0.4;
    }
    if (weapon === "Explosive") {
      if (armor === "Heavy")   return 0.8;
      if (armor === "Medium")  return 1.0;
      if (armor === "Light")   return 1.1;
      return 1.3;
    }
    if (weapon === "Heavy MG") {
      if (armor === "Heavy")   return 0.15;
      if (armor === "Medium")  return 0.30;
      if (armor === "Light")   return 0.85;
      return 0.4;
    }
    if (weapon === "Small Arms") {
      if (armor === "Heavy")   return 0;
      if (armor === "Medium")  return 0.05;
      if (armor === "Light")   return 0.3;
      return 0.65;
    }
    return 0.4;
  }

  // ============================================================
  // SIMULATION END
  // ============================================================
  endSimulation(outcome) {
    this.stop();
    if (typeof this.callbacks.onSimulationEnd === "function") {
      this.callbacks.onSimulationEnd({
        outcome,
        Player: this.stats.Player,
        Enemy:  this.stats.Enemy
      });
    }
  }
}