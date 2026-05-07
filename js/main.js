import MapRenderer from "./ui/mapRenderer.js";
import InputHandler from "./ui/inputHandler.js";
import DomManager from "./ui/domManager.js";
import SimulationEngine from "./core/simulation.js";
import { predictBestPositions, suggestAdjustments } from "./core/ai.js";
import { exportScenario, downloadScenario, applyScenario } from "./core/dataManager.js";
import {
  getAllTemplates,
  findTemplateById,
  createUnitFromTemplate,
  addCustomTemplate,
  customTemplates,
  placedUnits,
  UNIT_CATEGORIES,
  WEAPON_TYPES,
  ARMOR_CLASSES
} from "./models/unitDictionary.js";
import { mapData } from "./models/mapData.js";

const state = {
  units: placedUnits,
  placement: {
    faction: "Player",
    templateId: "",
    count: 3,
    formation: "Cluster"
  },
  mapTool: {
    type: "None",
    hillElevation: 1.6,
    hillRadius: 420,
    roadType: "Highway",
    buildingWidth: 220,
    buildingHeight: 160,
    measure: null
  },
  selectedUnitId: null,
  view: {
    showGrid: false
  },
  simulation: {
    mode: "neutralize",
    timeLimit: 240
  }
};

const canvas = document.getElementById("mapCanvas");
const cameraReadout = document.getElementById("cameraReadout");

const renderer = new MapRenderer(canvas, state, (camera) => {
  cameraReadout.textContent = "KAMERA " + camera.zoom.toFixed(2);
});

const domManager = new DomManager(state, {
  addCustomTemplate: handleAddCustomTemplate,
  loadOverlay: handleOverlayLoad,
  clearMapFeatures: clearMapFeatures,
  deleteSelectedUnit: deleteSelectedUnit,
  exportScenario: handleExportScenario,
  importScenario: handleImportScenario,
  predictPositions: handlePredictPositions,
  suggestAdjustments: handleSuggestAdjustments,
  generateMapOnly: handleGenerateMapOnly,
  generateDemo: handleGenerateDemo,
  startSimulation: () => simulation.start(),
  stopSimulation: () => simulation.stop(),
  resetSimulation: handleResetSimulation
});

const inputHandler = new InputHandler(canvas, renderer, state, {
  placeUnits: placeUnitsAt,
  findUnitAt: findUnitAt,
  selectUnit: selectUnit,
  getUnitById: getUnitById,
  clearSelection: clearSelection,
  deleteSelectedUnit: deleteSelectedUnit,
  addHill: addHill,
  addRoad: addRoad,
  addBuilding: addBuilding,
  updateMeasure: handleMeasureUpdate
});

const simulation = new SimulationEngine(state, renderer, {
  onSimulationEnd: (report) => domManager.renderAAR(report),
  onUnitsReset: () => domManager.renderSelectedUnit(null),
  onSelectionCleared: () => domManager.renderSelectedUnit(null)
});

initializeTemplateSelect();

function initializeTemplateSelect() {
  const templates = getAllTemplates();
  domManager.refreshTemplateOptions(templates);
  if (templates.length > 0) {
    state.placement.templateId = templates[0].id;
  }
}

function placeUnitsAt(world) {
  const template = findTemplateById(state.placement.templateId);
  if (!template) {
    return;
  }
  const positions = buildFormationPositions(world, state.placement.count, state.placement.formation);
  positions.forEach((pos) => {
    const safePos = findNearestFreePosition(pos);
    if (!safePos) {
      return;
    }
    const unit = createUnitFromTemplate(template, state.placement.faction, safePos.x, safePos.y);
    placedUnits.push(unit);
  });
}

function buildFormationPositions(origin, count, formation) {
  const positions = [];
  const spacing = 32;
  if (formation === "Line") {
    const startX = origin.x - ((count - 1) * spacing) / 2;
    for (let i = 0; i < count; i += 1) {
      positions.push({ x: startX + i * spacing, y: origin.y });
    }
    return positions;
  }
  if (formation === "Column") {
    const startY = origin.y - ((count - 1) * spacing) / 2;
    for (let i = 0; i < count; i += 1) {
      positions.push({ x: origin.x, y: startY + i * spacing });
    }
    return positions;
  }
  if (formation === "Wedge") {
    const rows = Math.ceil(Math.sqrt(count));
    let placed = 0;
    for (let r = 0; r < rows; r += 1) {
      const rowCount = Math.min(count - placed, r + 1);
      const rowStartX = origin.x - ((rowCount - 1) * spacing) / 2;
      for (let i = 0; i < rowCount; i += 1) {
        positions.push({ x: rowStartX + i * spacing, y: origin.y + r * spacing });
        placed += 1;
        if (placed >= count) {
          return positions;
        }
      }
    }
    return positions;
  }

  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / Math.max(1, count);
    const radius = 18 + count * 2;
    positions.push({
      x: origin.x + Math.cos(angle) * radius,
      y: origin.y + Math.sin(angle) * radius
    });
  }
  return positions;
}

function findUnitAt(world) {
  for (let i = placedUnits.length - 1; i >= 0; i -= 1) {
    const unit = placedUnits[i];
    if (unit.neutralized) {
      continue;
    }
    const dist = Math.hypot(world.x - unit.x, world.y - unit.y);
    if (dist <= unit.size + 6) {
      return unit;
    }
  }
  return null;
}

function selectUnit(unit) {
  state.selectedUnitId = unit.id;
  domManager.renderSelectedUnit(unit);
}

function clearSelection() {
  state.selectedUnitId = null;
  domManager.renderSelectedUnit(null);
}

function getUnitById(id) {
  for (let i = 0; i < placedUnits.length; i += 1) {
    if (placedUnits[i].id === id) {
      return placedUnits[i];
    }
  }
  return null;
}

function deleteSelectedUnit() {
  if (!state.selectedUnitId) {
    return;
  }
  for (let i = placedUnits.length - 1; i >= 0; i -= 1) {
    if (placedUnits[i].id === state.selectedUnitId) {
      placedUnits.splice(i, 1);
      break;
    }
  }
  clearSelection();
}

function addHill(world, elevation, radius) {
  mapData.hills.push({
    x: world.x,
    y: world.y,
    elevation: elevation,
    radius: radius
  });
  bumpTopoVersion();
}

function addRoad(start, end, type) {
  mapData.roads.push({
    type: type,
    points: buildOrganicRoadPoints(start, end)
  });
  bumpTopoVersion();
}

function buildOrganicRoadPoints(start, end) {
  let points = [{ x: start.x, y: start.y }, { x: end.x, y: end.y }];
  const iterations = 4;

  for (let iter = 0; iter < iterations; iter += 1) {
    const next = [points[0]];
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const mid = { x: a.x + dx * 0.5, y: a.y + dy * 0.5 };
      const nx = -dy / dist;
      const ny = dx / dist;

      const swayBase = (Math.random() - 0.5) * dist * 0.2 / (iter + 1);
      let repulseX = 0;
      let repulseY = 0;
      if (mapData.hills) {
        for (let h = 0; h < mapData.hills.length; h += 1) {
          const hill = mapData.hills[h];
          const hx = mid.x - hill.x;
          const hy = mid.y - hill.y;
          const hd = Math.hypot(hx, hy) || 1;
          const influence = hill.radius * 1.1;
          if (hd < influence) {
            const strength = (1 - hd / influence) * (hill.elevation - 1) * 260;
            repulseX += (hx / hd) * strength;
            repulseY += (hy / hd) * strength;
          }
        }
      }

      const midX = mid.x + nx * swayBase + repulseX;
      const midY = mid.y + ny * swayBase + repulseY;
      next.push({ x: clampMapX(midX), y: clampMapY(midY) });
      next.push(b);
    }
    points = next;
  }

  return smoothPath(points);
}

function addBuilding(world, width, height) {
  const w = Math.max(20, Math.min(120, width || 60)); // Realistic building sizes: 20-120 meters
  const h = Math.max(15, Math.min(80, height || 40));
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const jitter = attempt === 0 ? 0 : 30 + attempt * 8;
    const candidate = {
      x: world.x - w / 2 + (Math.random() - 0.5) * jitter,
      y: world.y - h / 2 + (Math.random() - 0.5) * jitter,
      width: w,
      height: h
    };
    if (isBuildingValid(candidate)) {
      mapData.buildings.push(candidate);
      bumpTopoVersion();
      return;
    }
  }
}

function findNearestFreePosition(point) {
  if (!isPointInsideBuilding(point)) {
    return point;
  }
  const radii = [40, 70, 110, 160, 220, 300];
  for (let r = 0; r < radii.length; r += 1) {
    const radius = radii[r];
    for (let a = 0; a < 8; a += 1) {
      const angle = (Math.PI * 2 * a) / 8;
      const candidate = {
        x: clampMapX(point.x + Math.cos(angle) * radius),
        y: clampMapY(point.y + Math.sin(angle) * radius)
      };
      if (!isPointInsideBuilding(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function isPointInsideBuilding(point) {
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

function handleAddCustomTemplate(payload) {
  if (!payload.name) {
    return;
  }
  const id = "custom_" + payload.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const derived = deriveTemplateStats(payload);
  addCustomTemplate({
    id: id + "_" + Date.now(),
    name: payload.name,
    category: payload.category,
    armor: payload.armor,
    weapon: payload.weapon,
    range: payload.range,
    detection: payload.detection,
    mobility: payload.mobility,
    ammoLimit: payload.ammoLimit,
    accuracy: derived.accuracy,
    suppressionPower: derived.suppressionPower,
    size: derived.size,
    height: derived.height,
    speed: derived.speed,
    fireInterval: derived.fireInterval,
    usesRoads: derived.usesRoads
  });
  initializeTemplateSelect();
}

function deriveTemplateStats(payload) {
  let accuracy = 0.45;
  let suppressionPower = 0.3;
  let fireInterval = 1.1;
  if (payload.weapon === WEAPON_TYPES.EXPLOSIVE) {
    accuracy = 0.32;
    suppressionPower = 0.65;
    fireInterval = payload.category === UNIT_CATEGORIES.ARTILLERY ? 5.8 : 2.4;
  } else if (payload.weapon === WEAPON_TYPES.ANTI_ARMOR) {
    accuracy = 0.5;
    suppressionPower = 0.45;
    fireInterval = 3.5;
  } else if (payload.weapon === WEAPON_TYPES.ANTI_AIR) {
    accuracy = 0.58;
    suppressionPower = 0.4;
    fireInterval = payload.category === UNIT_CATEGORIES.AIRCRAFT ? 2.2 : 3.6;
  } else if (payload.weapon === WEAPON_TYPES.HEAVY_MG) {
    accuracy = 0.42;
    suppressionPower = 0.4;
    fireInterval = 0.7;
  } else if (payload.weapon === WEAPON_TYPES.AUTO_CANNON) {
    accuracy = 0.44;
    suppressionPower = 0.38;
    fireInterval = 1.0;
  } else if (payload.weapon === WEAPON_TYPES.COMBINED) {
    accuracy = 0.48;
    suppressionPower = 0.45;
    fireInterval = 3.0;
  }

  let size = 12;
  let height = 1.0;
  let speed = 1.4 * payload.mobility;
  let usesRoads = false;
  if (payload.category === UNIT_CATEGORIES.VEHICLE) {
    size = 16;
    height = 1.6;
    speed = (payload.armor === "Heavy" ? 11 : 15) * payload.mobility;
    usesRoads = true;
  } else if (payload.category === UNIT_CATEGORIES.ARTILLERY) {
    size = 18;
    height = 1.5;
    speed = (payload.armor === "Unarmored" ? 1.2 : 8.5) * payload.mobility;
    usesRoads = payload.armor !== "Unarmored";
  } else if (payload.category === UNIT_CATEGORIES.AIRCRAFT) {
    size = 14;
    height = 4.5;
    speed = 80 * payload.mobility;
    usesRoads = false;
  }

  return {
    accuracy: accuracy,
    suppressionPower: suppressionPower,
    size: size,
    height: height,
    speed: speed,
    fireInterval: fireInterval,
    usesRoads: usesRoads
  };
}

function handleOverlayLoad(file) {
  const reader = new FileReader();
  reader.onload = () => {
    mapData.backgroundImage = reader.result;
    bumpTopoVersion();
  };
  reader.readAsDataURL(file);
}

function clearMapFeatures() {
  mapData.hills = [];
  mapData.roads = [];
  mapData.buildings = [];
  mapData.backgroundImage = null;
  bumpTopoVersion();
}

function handleExportScenario() {
  const json = exportScenario(customTemplates, placedUnits, mapData);
  downloadScenario(json);
}

function handleImportScenario(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (applyScenario(data, customTemplates, placedUnits, mapData)) {
        initializeTemplateSelect();
        clearSelection();
      }
    } catch (err) {
      console.warn("Invalid JSON", err);
    }
  };
  reader.readAsText(file);
}

function handlePredictPositions() {
  predictBestPositions(state, placedUnits, getAllTemplates(), mapData);
}

function handleSuggestAdjustments() {
  suggestAdjustments(placedUnits, mapData);
}

function handleMeasureUpdate(measure) {
  domManager.renderMeasure(measure);
}

function resetScenarioState() {
  simulation.stop();
  domManager.renderAAR(null);
  clearSelection();
  placedUnits.length = 0;
  mapData.hills = [];
  mapData.roads = [];
  mapData.buildings = [];
  mapData.backgroundImage = null;
  // Use fixed seed for consistent default map, random for generated maps
  mapData.topoSeed = 42;
  bumpTopoVersion();
}

function handleGenerateMapOnly() {
  // Use random seed for new map generation
  mapData.topoSeed = Math.floor(Math.random() * 100000);
  resetScenarioState();
  generateTerrain();
  generateRoads();
  generateBuildings();
  bumpTopoVersion();
}

function handleGenerateDemo(autoStart) {
  // Use random seed for new map generation
  mapData.topoSeed = Math.floor(Math.random() * 100000);
  resetScenarioState();
  generateTerrain();
  generateRoads();
  generateBuildings();
  deployDemoForces();
  bumpTopoVersion();

  if (autoStart) {
    simulation.start();
  }
}

function bumpTopoVersion() {
  mapData.topoVersion = (mapData.topoVersion || 0) + 1;
  mapData.navVersion = (mapData.navVersion || 0) + 1;
}

// ============================================================
// REALISTIC TERRAIN GENERATION
// ============================================================

// Simplex-like noise function for natural terrain
function hash2D(x, y, seed) {
  let n = x * 374761393 + y * 668265263 + seed * 69069;
  n = (n ^ (n >> 13)) * 1274126177;
  n = n ^ (n >> 16);
  return (n >>> 0) / 4294967295;
}

function smoothNoise2D(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v00 = hash2D(ix, iy, seed);
  const v10 = hash2D(ix + 1, iy, seed);
  const v01 = hash2D(ix, iy + 1, seed);
  const v11 = hash2D(ix + 1, iy + 1, seed);
  const ix0 = v00 + (v10 - v00) * sx;
  const ix1 = v01 + (v11 - v01) * sx;
  return ix0 + (ix1 - ix0) * sy;
}

function fbm(x, y, seed, octaves) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i += 1) {
    value += smoothNoise2D(x * frequency, y * frequency, seed + i * 17) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value / maxValue;
}

function generateTerrain() {
  const seed = mapData.topoSeed || 42;
  mapData.hills = [];

  // Military-style terrain: distinct hills with clear ridges and valleys
  // Using lower frequency noise for larger, more defined features
  const TERRAIN_COLS = 64;
  const TERRAIN_ROWS = 48;
  const cellW = MAP_CONFIG.width / TERRAIN_COLS;
  const cellH = MAP_CONFIG.height / TERRAIN_ROWS;
  const heightMap = [];

  for (let ty = 0; ty < TERRAIN_ROWS; ty += 1) {
    for (let tx = 0; tx < TERRAIN_COLS; tx += 1) {
      const wx = tx * cellW;
      const wy = ty * cellH;
      // Multi-octave noise with emphasis on large-scale features
      let h = fbm(wx * 0.0006, wy * 0.0006, seed, 5);
      // Add ridge-like features using absolute value of noise gradient
      const ridge = Math.abs(fbm(wx * 0.0012 + 100, wy * 0.0012 + 100, seed + 50, 3) - 0.5) * 2;
      h = h * 0.7 + ridge * 0.3;
      // Exponential curve for distinct highlands vs lowlands
      h = Math.pow(h, 0.85);
      heightMap.push(h);
    }
  }

  // Extract well-defined hill centers from heightfield
  const visited = new Array(TERRAIN_COLS * TERRAIN_ROWS).fill(false);
  const hillCenters = [];

  for (let ty = 2; ty < TERRAIN_ROWS - 2; ty += 1) {
    for (let tx = 2; tx < TERRAIN_COLS - 2; tx += 1) {
      const idx = ty * TERRAIN_COLS + tx;
      const h = heightMap[idx];
      // Higher threshold for more distinct hills
      const threshold = 0.55 + hash2D(tx, ty, seed + 100) * 0.12;

      // Check if this is a local maximum in a 5x5 neighborhood
      let isMax = true;
      for (let dy = -2; dy <= 2 && isMax; dy += 1) {
        for (let dx = -2; dx <= 2 && isMax; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const ni = (ty + dy) * TERRAIN_COLS + (tx + dx);
          if (ni >= 0 && ni < heightMap.length && heightMap[ni] >= h) {
            isMax = false;
          }
        }
      }

      if (isMax && h > threshold && !visited[idx]) {
        // Mark a larger area as visited to prevent overlapping hills
        const radiusCells = 2 + Math.floor(hash2D(tx, ty, seed + 50) * 3);
        for (let dy = -radiusCells; dy <= radiusCells; dy += 1) {
          for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
            const ni = (ty + dy) * TERRAIN_COLS + (tx + dx);
            if (ni >= 0 && ni < visited.length) {
              visited[ni] = true;
            }
          }
        }

        // Military map elevations: realistic heights in meters
        const baseElevation = 100 + h * 250;  // 100-350m base
        const elevation = Math.round(baseElevation + hash2D(tx, ty, seed + 200) * 50);
        // Radius proportional to elevation: larger hills are taller
        const baseRadius = 350 + h * 450;  // 350-800m
        const radius = Math.round(baseRadius + hash2D(tx, ty, seed + 300) * 100);

        hillCenters.push({
          x: tx * cellW + cellW / 2 + (hash2D(tx, ty, seed + 400) - 0.5) * cellW * 0.3,
          y: ty * cellH + cellH / 2 + (hash2D(tx, ty, seed + 500) - 0.5) * cellH * 0.3,
          elevation: elevation,
          radius: radius
        });
      }
    }
  }

  // Select hills strategically - aim for 15-25 well-distributed hills
  const targetHills = 15 + Math.floor(hash2D(0, 0, seed) * 10);
  const selected = hillCenters.slice(0, Math.min(hillCenters.length, targetHills));

  for (let i = 0; i < selected.length; i += 1) {
    const hill = selected[i];
    // Clamp to map bounds with margin
    const clampedX = Math.max(300, Math.min(MAP_CONFIG.width - 300, hill.x));
    const clampedY = Math.max(300, Math.min(MAP_CONFIG.height - 300, hill.y));
    mapData.hills.push({
      x: clampedX,
      y: clampedY,
      elevation: hill.elevation,
      radius: hill.radius
    });
  }
}

function generateRoads() {
  const seed = mapData.topoSeed || 42;
  
  // Military-style road network: main highway crossing the map, with secondary roads
  // Roads use deterministic positions based on seed for consistent default map
  
  // Main highway - crosses diagonally but avoids major hill centers
  const highwayStart = { 
    x: 150, 
    y: 800 + hash2D(0, 1, seed) * 600 
  };
  const highwayEnd = { 
    x: 7850, 
    y: 4500 + hash2D(1, 0, seed) * 500 
  };
  
  mapData.roads.push({
    type: "Highway",
    points: buildOrganicRoadPoints(highwayStart, highwayEnd)
  });
  
  // Secondary highway running perpendicular
  const highway2Start = { 
    x: 1500 + hash2D(2, 1, seed) * 400, 
    y: 100 
  };
  const highway2End = { 
    x: 6500 + hash2D(3, 2, seed) * 500, 
    y: 5900 
  };
  
  mapData.roads.push({
    type: "Highway",
    points: buildOrganicRoadPoints(highway2Start, highway2End)
  });
  
  // Dirt roads connecting areas - use seeded randomness
  const dirtRoadCount = 2 + Math.floor(hash2D(1, 2, seed) * 2);
  for (let r = 0; r < dirtRoadCount; r += 1) {
    const startX = 400 + hash2D(r + 10, r + 20, seed) * 3000;
    const startY = 400 + hash2D(r + 30, r + 40, seed) * 2500;
    const endX = 4000 + hash2D(r + 50, r + 60, seed) * 3500;
    const endY = 3000 + hash2D(r + 70, r + 80, seed) * 2500;
    
    mapData.roads.push({
      type: "Dirt",
      points: buildOrganicRoadPoints(
        { x: startX, y: startY },
        { x: endX, y: endY }
      )
    });
  }
}

function generateBuildings() {
  // Realistic buildings: 20-120m long, 15-80m wide
  // Place along roads, in clusters, avoiding hills
  const MAX_BUILDINGS = 200;
  let placed = 0;

  // Buildings along roads
  for (let r = 0; r < mapData.roads.length; r += 1) {
    const road = mapData.roads[r];
    if (!road.points || road.points.length < 2) continue;

    for (let s = 0; s < road.points.length - 1; s += 1) {
      const a = road.points[s];
      const b = road.points[s + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const count = Math.min(8, Math.floor(segLen / 200));
      const nx = (a.y - b.y) / segLen;
      const ny = (b.x - a.x) / segLen;

      for (let i = 0; i < count; i += 1) {
        if (placed >= MAX_BUILDINGS) return;
        const t = (i + 1) / (count + 1);
        const baseX = a.x + (b.x - a.x) * t;
        const baseY = a.y + (b.y - a.y) * t;
        const side = Math.random() > 0.5 ? 1 : -1;
        const offset = 60 + Math.random() * 120;

        // Realistic building dimensions
        const w = 15 + Math.random() * 80;
        const h = 12 + Math.random() * 50;

        const bx = baseX + nx * offset * side - w / 2;
        const by = baseY + ny * offset * side - h / 2;
        const building = { x: bx, y: by, width: w, height: h };

        if (isBuildingValid(building)) {
          mapData.buildings.push(building);
          placed += 1;
        }
      }
    }
  }

  // Add clusters of buildings (villages/settlements)
  const clusterCount = 3 + Math.floor(Math.random() * 5);
  for (let c = 0; c < clusterCount; c += 1) {
    const cx = 500 + Math.random() * 7000;
    const cy = 400 + Math.random() * 5200;
    const clusterSize = 3 + Math.floor(Math.random() * 8);

    for (let b = 0; b < clusterSize; b += 1) {
      if (placed >= MAX_BUILDINGS) return;
      const angle = Math.random() * Math.PI * 2;
      const dist = 20 + Math.random() * 150;
      const w = 10 + Math.random() * 60;
      const h = 8 + Math.random() * 40;
      const bld = {
        x: cx + Math.cos(angle) * dist - w / 2,
        y: cy + Math.sin(angle) * dist - h / 2,
        width: w,
        height: h
      };
      if (isBuildingValid(bld)) {
        mapData.buildings.push(bld);
        placed += 1;
      }
    }
  }
}

function isBuildingValid(building) {
  // Check map boundaries
  if (building.x < 30 || building.y < 30) return false;
  if (building.x + building.width > MAP_CONFIG.width - 30 || building.y + building.height > MAP_CONFIG.height - 30) return false;

  // Prevent building on hills
  if (isBuildingOnHill(building)) return false;

  // Prevent building intersecting roads
  if (doesBuildingIntersectRoad(building)) return false;

  // Prevent overlapping with other buildings
  for (let i = 0; i < mapData.buildings.length; i += 1) {
    const other = mapData.buildings[i];
    if (rectOverlap(building, other, 8)) return false;
  }

  return true;
}

function isBuildingOnHill(building) {
  if (!mapData.hills) return false;
  const cx = building.x + building.width / 2;
  const cy = building.y + building.height / 2;
  const diag = Math.hypot(building.width, building.height) / 2;

  for (let i = 0; i < mapData.hills.length; i += 1) {
    const hill = mapData.hills[i];
    const dist = Math.hypot(cx - hill.x, cy - hill.y);
    if (dist < hill.radius * 0.75 + diag) return true;
  }
  return false;
}

function doesBuildingIntersectRoad(building) {
  if (!mapData.roads) return false;
  const pad = 4;
  const rect = {
    x: building.x - pad,
    y: building.y - pad,
    width: building.width + pad * 2,
    height: building.height + pad * 2
  };
  for (let i = 0; i < mapData.roads.length; i += 1) {
    const road = mapData.roads[i];
    if (!road.points || road.points.length < 2) continue;
    for (let s = 0; s < road.points.length - 1; s += 1) {
      if (rectIntersectsSegment(rect, road.points[s], road.points[s + 1])) return true;
    }
  }
  return false;
}

function rectIntersectsSegment(rect, a, b) {
  const left = lineIntersectsLine(a.x, a.y, b.x, b.y, rect.x, rect.y, rect.x, rect.y + rect.height);
  const right = lineIntersectsLine(a.x, a.y, b.x, b.y, rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height);
  const top = lineIntersectsLine(a.x, a.y, b.x, b.y, rect.x, rect.y, rect.x + rect.width, rect.y);
  const bottom = lineIntersectsLine(a.x, a.y, b.x, b.y, rect.x, rect.y + rect.height, rect.x + rect.width, rect.y + rect.height);
  return left || right || top || bottom || pointInRect(a, rect) || pointInRect(b, rect);
}

function lineIntersectsLine(x1, y1, x2, y2, x3, y3, x4, y4) {
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (denom === 0) return false;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function pointInRect(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function rectOverlap(a, b, padding) {
  const pad = padding || 0;
  return !(
    a.x + a.width + pad < b.x ||
    a.x > b.x + b.width + pad ||
    a.y + a.height + pad < b.y ||
    a.y > b.y + b.height + pad
  );
}

function smoothPath(points) {
  if (points.length < 3) return points;
  const result = [points[0]];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    result.push({ x: p0.x * 0.75 + p1.x * 0.25, y: p0.y * 0.75 + p1.y * 0.25 });
    result.push({ x: p0.x * 0.25 + p1.x * 0.75, y: p0.y * 0.25 + p1.y * 0.75 });
  }
  result.push(points[points.length - 1]);
  return result;
}

function clampMapX(x) {
  return Math.max(30, Math.min(MAP_CONFIG.width - 30, x));
}

function clampMapY(y) {
  return Math.max(30, Math.min(MAP_CONFIG.height - 30, y));
}

function deployDemoForces() {
  // Realistic OOB (Order of Battle) deployment
  const playerBase = { x: 1200, y: 1600 };
  const enemyBase = { x: 6600, y: 4200 };

  // Player forces (Motorized Rifle Regiment)
  placeGroup("rifle_squad", "Player", { x: 1100, y: 1500 }, 6, "Line");
  placeGroup("heavy_weapons_team", "Player", { x: 1300, y: 1800 }, 3, "Cluster");
  placeGroup("sniper_team", "Player", { x: 1600, y: 1100 }, 2, "Cluster");
  placeGroup("at_team", "Player", { x: 1400, y: 2000 }, 2, "Cluster");
  placeGroup("ifv", "Player", { x: 1700, y: 2200 }, 3, "Column");
  placeGroup("mbt", "Player", { x: 1900, y: 2500 }, 3, "Column");
  placeGroup("apc", "Player", { x: 1500, y: 2400 }, 2, "Column");
  placeGroup("spg", "Player", { x: 900, y: 2100 }, 2, "Cluster");
  placeGroup("sam_battery", "Player", { x: 800, y: 2500 }, 1, "Cluster");
  placeGroup("aa_truck", "Player", { x: 1100, y: 2300 }, 2, "Cluster");
  placeGroup("attack_drone", "Player", { x: 1200, y: 1200 }, 1, "Cluster");

  // Enemy forces (Mechanized Infantry Regiment)
  placeGroup("rifle_squad", "Enemy", { x: 6400, y: 4000 }, 7, "Line");
  placeGroup("at_team", "Enemy", { x: 6800, y: 3800 }, 3, "Cluster");
  placeGroup("heavy_weapons_team", "Enemy", { x: 6200, y: 4300 }, 2, "Cluster");
  placeGroup("sniper_team", "Enemy", { x: 7100, y: 3700 }, 2, "Cluster");
  placeGroup("rocket_artillery", "Enemy", { x: 7200, y: 4700 }, 2, "Cluster");
  placeGroup("mbt", "Enemy", { x: 6900, y: 4300 }, 3, "Column");
  placeGroup("apc", "Enemy", { x: 6300, y: 4500 }, 3, "Column");
  placeGroup("armored_recon", "Enemy", { x: 6100, y: 3500 }, 2, "Cluster");
  placeGroup("spg", "Enemy", { x: 7400, y: 4600 }, 2, "Cluster");
  placeGroup("gunship", "Enemy", { x: 6200, y: 3200 }, 2, "Cluster");
  placeGroup("aa_truck", "Enemy", { x: 6600, y: 4600 }, 2, "Cluster");
}

function placeGroup(templateId, faction, center, count, formation) {
  const template = findTemplateById(templateId);
  if (!template) return;

  const positions = buildFormationPositions(center, count, formation);
  positions.forEach((pos) => {
    const jitter = 18;
    const candidate = {
      x: pos.x + (Math.random() * jitter - jitter / 2),
      y: pos.y + (Math.random() * jitter - jitter / 2)
    };
    const safePos = findNearestFreePosition(candidate);
    if (!safePos) return;
    const unit = createUnitFromTemplate(template, faction, safePos.x, safePos.y);
    placedUnits.push(unit);
  });
}

function handleResetSimulation() {
  simulation.reset();
  domManager.renderAAR(null);
}