import { syncNextUnitId } from "../models/unitDictionary.js";

export function exportScenario(customTemplates, placedUnits, mapData) {
  const payload = {
    customTemplates: customTemplates,
    placedUnits: placedUnits,
    mapData: mapData
  };
  return JSON.stringify(payload, null, 2);
}

export function downloadScenario(json) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "scenario.json";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function applyScenario(data, customTemplates, placedUnits, mapData) {
  if (!data) {
    return false;
  }
  if (Array.isArray(data.customTemplates)) {
    customTemplates.length = 0;
    data.customTemplates.forEach((t) => customTemplates.push(t));
  }
  if (Array.isArray(data.placedUnits)) {
    placedUnits.length = 0;
    data.placedUnits.forEach((u) => placedUnits.push(u));
    syncNextUnitId(placedUnits);
  }
  if (data.mapData) {
    mapData.hills = Array.isArray(data.mapData.hills) ? data.mapData.hills : [];
    mapData.roads = Array.isArray(data.mapData.roads) ? data.mapData.roads : [];
    mapData.buildings = Array.isArray(data.mapData.buildings) ? data.mapData.buildings : [];
    mapData.backgroundImage = data.mapData.backgroundImage || null;
    if (typeof data.mapData.topoSeed === "number") {
      mapData.topoSeed = data.mapData.topoSeed;
    }
    if (typeof data.mapData.topoVersion === "number") {
      mapData.topoVersion = data.mapData.topoVersion;
    }
    if (typeof data.mapData.navVersion === "number") {
      mapData.navVersion = data.mapData.navVersion;
    }
  }
  return true;
}
