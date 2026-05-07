import { MAP_CONFIG, mapData } from "../models/mapData.js";

const GRID_SIZE = 200;

export default class MapRenderer {
  constructor(canvas, state, onCameraUpdate) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.state = state;
    this.onCameraUpdate = onCameraUpdate;
    this.camera = {
      x: MAP_CONFIG.width / 2,
      y: MAP_CONFIG.height / 2,
      zoom: 0.65
    };
    this.effects = [];
    // Track unit positions for trail effect
    this.unitTrails = {};
    // Track unit movement for animation
    this.unitAnim = {};
    this.overlayImage = null;
    this.overlaySrc = null;
    this.topoData = null;
    this.topoKey = "";
    this.lastTime = 0;
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.start();
  }

  resize() {
    const ratio = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.clampCamera();
  }

  start() {
    const loop = (time) => {
      this.draw(time);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  setCamera(x, y) {
    this.camera.x = x;
    this.camera.y = y;
  }

  panBy(dx, dy) {
    this.camera.x -= dx / this.camera.zoom;
    this.camera.y -= dy / this.camera.zoom;
    this.clampCamera();
  }

  zoomAt(delta, screenX, screenY) {
    const before = this.screenToWorld(screenX, screenY);
    const zoom = this.camera.zoom * (delta > 0 ? 0.92 : 1.08);
    this.camera.zoom = Math.max(0.1, Math.min(5.0, zoom));
    const after = this.screenToWorld(screenX, screenY);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
    this.clampCamera();
  }

  clampCamera() {
    const rect = this.canvas.getBoundingClientRect();
    const halfW = rect.width / (2 * this.camera.zoom);
    const halfH = rect.height / (2 * this.camera.zoom);

    let minX = halfW;
    let maxX = MAP_CONFIG.width - halfW;
    if (minX > maxX) {
      minX = MAP_CONFIG.width / 2;
      maxX = MAP_CONFIG.width / 2;
    }

    let minY = halfH;
    let maxY = MAP_CONFIG.height - halfH;
    if (minY > maxY) {
      minY = MAP_CONFIG.height / 2;
      maxY = MAP_CONFIG.height / 2;
    }

    this.camera.x = Math.max(minX, Math.min(maxX, this.camera.x));
    this.camera.y = Math.max(minY, Math.min(maxY, this.camera.y));
  }

  addEffect(effect) {
    this.effects.push(effect);
  }

  screenToWorld(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = screenX - rect.left - rect.width / 2;
    const y = screenY - rect.top - rect.height / 2;
    return {
      x: x / this.camera.zoom + this.camera.x,
      y: y / this.camera.zoom + this.camera.y
    };
  }

  worldToScreen(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (x - this.camera.x) * this.camera.zoom + rect.width / 2,
      y: (y - this.camera.y) * this.camera.zoom + rect.height / 2
    };
  }

  loadOverlayIfNeeded() {
    if (mapData.backgroundImage && mapData.backgroundImage !== this.overlaySrc) {
      this.overlaySrc = mapData.backgroundImage;
      this.overlayImage = new Image();
      this.overlayImage.src = mapData.backgroundImage;
    }
    if (!mapData.backgroundImage) {
      this.overlaySrc = null;
      this.overlayImage = null;
    }
  }

  draw(time) {
    const delta = Math.min(0.05, (time - this.lastTime) / 1000 || 0);
    this.lastTime = time;
    this.currentTime = time || 0;
    this.loadOverlayIfNeeded();

    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    ctx.save();
    ctx.translate(rect.width / 2, rect.height / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    this.drawBackground(ctx);
    this.drawGrid(ctx, rect);
    this.drawRoads(ctx);
    this.drawHills(ctx);
    this.drawBuildings(ctx);

    // Draw unit trails before units
    this.drawUnitTrails(ctx);

    this.drawUnits(ctx);
    this.drawEffects(ctx, delta);
    this.drawMeasurement(ctx);

    ctx.restore();

    if (typeof this.onCameraUpdate === "function") {
      this.onCameraUpdate(this.camera);
    }
  }

  drawBackground(ctx) {
    // Military map tan/beige background
    ctx.fillStyle = MAP_CONFIG.backgroundColor;
    ctx.fillRect(0, 0, MAP_CONFIG.width, MAP_CONFIG.height);

    if (this.overlayImage && this.overlayImage.complete) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.overlayImage, 0, 0, MAP_CONFIG.width, MAP_CONFIG.height);
      ctx.globalAlpha = 1;
      return;
    }

    const topo = this.getTopoData();
    if (topo) {
      this.drawTopoContours(ctx, topo);
    }
    
    // Draw hill shading for terrain depth
    this.drawHillShading(ctx);
  }

  getTopoData() {
    const seed = typeof mapData.topoSeed === "number" ? mapData.topoSeed : 42;
    const version = typeof mapData.topoVersion === "number" ? mapData.topoVersion : 0;
    const key = `${seed}_${version}_${mapData.hills.length}_${mapData.roads.length}`;
    if (this.topoKey !== key) {
      this.topoKey = key;
      this.topoData = this.buildTopoData(seed);
    }
    return this.topoData;
  }

  buildTopoData(seed) {
    // Higher resolution for smoother military-style contours
    const cols = 400;
    const rows = 300;
    const cellW = MAP_CONFIG.width / (cols - 1);
    const cellH = MAP_CONFIG.height / (rows - 1);
    const heights = [];

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const wx = x * cellW;
        const wy = y * cellH;
        // Base terrain noise with lower frequency for larger features
        let h = this.fbm(wx * 0.0005, wy * 0.0005, seed);
        h = h * 0.7 + 0.15;

        // Add hill influence to contour generation
        for (let i = 0; i < mapData.hills.length; i += 1) {
          const hill = mapData.hills[i];
          const dist = Math.hypot(wx - hill.x, wy - hill.y);
          if (dist < hill.radius * 1.3) {
            const boost = (1 - dist / (hill.radius * 1.3)) * ((hill.elevation - 100) / 300) * 0.5;
            h += boost;
          }
        }
        heights.push(Math.max(0, Math.min(1, h)));
      }
    }

    // Military map contour intervals: closer spacing for more detail
    const levels = [];
    for (let level = 0.2; level <= 0.85; level += 0.03) {
      levels.push(Number(level.toFixed(3)));
    }

    const contours = this.buildContourSegments(heights, cols, rows, cellW, cellH, levels);

    return {
      levels: levels,
      contours: contours
    };
  }

  drawTopoContours(ctx, topo) {
    for (let i = 0; i < topo.levels.length; i += 1) {
      const isMajor = i % 5 === 0;  // Every 5th contour is major (index contour)
      ctx.lineWidth = (isMajor ? 1.8 : 0.7) / this.camera.zoom;
      ctx.strokeStyle = isMajor ? MAP_CONFIG.contourColorMajor : MAP_CONFIG.contourColorMinor;
      ctx.globalAlpha = isMajor ? 0.9 : 0.6;
      ctx.beginPath();
      const segments = topo.contours[i];
      for (let s = 0; s < segments.length; s += 1) {
        const seg = segments[s];
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  buildContourSegments(heights, cols, rows, cellW, cellH, levels) {
    const contourSets = levels.map(() => []);

    for (let y = 0; y < rows - 1; y += 1) {
      for (let x = 0; x < cols - 1; x += 1) {
        const h0 = heights[y * cols + x];
        const h1 = heights[y * cols + x + 1];
        const h2 = heights[(y + 1) * cols + x + 1];
        const h3 = heights[(y + 1) * cols + x];

        for (let i = 0; i < levels.length; i += 1) {
          const level = levels[i];
          const idx =
            (h0 > level ? 1 : 0) |
            (h1 > level ? 2 : 0) |
            (h2 > level ? 4 : 0) |
            (h3 > level ? 8 : 0);

          if (idx === 0 || idx === 15) {
            continue;
          }

          const x0 = x * cellW;
          const y0 = y * cellH;
          const pTop = this.contourPoint(x0, y0, cellW, 0, h0, h1, level);
          const pRight = this.contourPoint(x0 + cellW, y0, 0, cellH, h1, h2, level);
          const pBottom = this.contourPoint(x0, y0 + cellH, cellW, 0, h3, h2, level);
          const pLeft = this.contourPoint(x0, y0, 0, cellH, h0, h3, level);

          this.pushContourSegments(contourSets[i], idx, pLeft, pTop, pRight, pBottom);
        }
      }
    }

    return contourSets;
  }

  pushContourSegments(segments, idx, pLeft, pTop, pRight, pBottom) {
    switch (idx) {
      case 1:
        segments.push({ x1: pLeft.x, y1: pLeft.y, x2: pTop.x, y2: pTop.y });
        break;
      case 2:
        segments.push({ x1: pTop.x, y1: pTop.y, x2: pRight.x, y2: pRight.y });
        break;
      case 3:
        segments.push({ x1: pLeft.x, y1: pLeft.y, x2: pRight.x, y2: pRight.y });
        break;
      case 4:
        segments.push({ x1: pRight.x, y1: pRight.y, x2: pBottom.x, y2: pBottom.y });
        break;
      case 5:
        segments.push({ x1: pLeft.x, y1: pLeft.y, x2: pTop.x, y2: pTop.y });
        segments.push({ x1: pRight.x, y1: pRight.y, x2: pBottom.x, y2: pBottom.y });
        break;
      case 6:
        segments.push({ x1: pTop.x, y1: pTop.y, x2: pBottom.x, y2: pBottom.y });
        break;
      case 7:
        segments.push({ x1: pLeft.x, y1: pLeft.y, x2: pBottom.x, y2: pBottom.y });
        break;
      case 8:
        segments.push({ x1: pLeft.x, y1: pLeft.y, x2: pBottom.x, y2: pBottom.y });
        break;
      case 9:
        segments.push({ x1: pTop.x, y1: pTop.y, x2: pBottom.x, y2: pBottom.y });
        break;
      case 10:
        segments.push({ x1: pTop.x, y1: pTop.y, x2: pRight.x, y2: pRight.y });
        segments.push({ x1: pLeft.x, y1: pLeft.y, x2: pBottom.x, y2: pBottom.y });
        break;
      case 11:
        segments.push({ x1: pRight.x, y1: pRight.y, x2: pBottom.x, y2: pBottom.y });
        break;
      case 12:
        segments.push({ x1: pLeft.x, y1: pLeft.y, x2: pRight.x, y2: pRight.y });
        break;
      case 13:
        segments.push({ x1: pTop.x, y1: pTop.y, x2: pRight.x, y2: pRight.y });
        break;
      case 14:
        segments.push({ x1: pLeft.x, y1: pLeft.y, x2: pTop.x, y2: pTop.y });
        break;
      default:
        break;
    }
  }

  contourPoint(x, y, dx, dy, hA, hB, level) {
    const denom = hB - hA;
    const t = denom === 0 ? 0.5 : (level - hA) / denom;
    return {
      x: x + dx * t,
      y: y + dy * t
    };
  }

  fbm(x, y, seed) {
    let value = 0;
    let amp = 1;
    let freq = 1;
    let max = 0;
    for (let i = 0; i < 4; i += 1) {
      value += this.smoothNoise(x * freq, y * freq, seed + i * 17) * amp;
      max += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return value / max;
  }

  smoothNoise(x, y, seed) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const sx = x - x0;
    const sy = y - y0;

    const v00 = this.hash(x0, y0, seed);
    const v10 = this.hash(x1, y0, seed);
    const v01 = this.hash(x0, y1, seed);
    const v11 = this.hash(x1, y1, seed);
    const ix0 = this.lerp(v00, v10, sx);
    const ix1 = this.lerp(v01, v11, sx);
    return this.lerp(ix0, ix1, sy);
  }

  hash(x, y, seed) {
    let n = x * 374761393 + y * 668265263 + seed * 69069;
    n = (n ^ (n >> 13)) * 1274126177;
    n = n ^ (n >> 16);
    return (n >>> 0) / 4294967295;
  }

  lerp(a, b, t) {
    return a + (b - a) * t;
  }

  drawGrid(ctx, rect) {
    if (!this.state.view || !this.state.view.showGrid) {
      return;
    }

    ctx.strokeStyle = "rgba(0, 0, 0, 0.12)";
    ctx.lineWidth = 1 / this.camera.zoom;

    const halfW = rect.width / (2 * this.camera.zoom);
    const halfH = rect.height / (2 * this.camera.zoom);
    const startX = Math.floor((this.camera.x - halfW) / GRID_SIZE) * GRID_SIZE;
    const endX = Math.ceil((this.camera.x + halfW) / GRID_SIZE) * GRID_SIZE;
    const startY = Math.floor((this.camera.y - halfH) / GRID_SIZE) * GRID_SIZE;
    const endY = Math.ceil((this.camera.y + halfH) / GRID_SIZE) * GRID_SIZE;

    ctx.beginPath();
    for (let x = startX; x <= endX; x += GRID_SIZE) {
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y += GRID_SIZE) {
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
    }
    ctx.stroke();
  }

  drawRoads(ctx) {
    for (let i = 0; i < mapData.roads.length; i += 1) {
      const road = mapData.roads[i];
      const points = road.points;
      if (!points || points.length < 2) {
        continue;
      }
      
      // Military map road styling
      if (road.type === "Highway") {
        // Highway: wider, darker brown road with light center stripe
        ctx.strokeStyle = "#5c4a3d";
        ctx.lineWidth = 14;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let p = 1; p < points.length; p += 1) {
          ctx.lineTo(points[p].x, points[p].y);
        }
        ctx.stroke();
        
        // Light center stripe for highway
        ctx.strokeStyle = "#8b7355";
        ctx.lineWidth = 3;
        ctx.setLineDash([15, 12]);
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let p = 1; p < points.length; p += 1) {
          ctx.lineTo(points[p].x, points[p].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // Dirt road: thinner, lighter brown
        ctx.strokeStyle = "#7a6350";
        ctx.lineWidth = 7;
        ctx.lineCap = "round";
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let p = 1; p < points.length; p += 1) {
          ctx.lineTo(points[p].x, points[p].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  drawBuildings(ctx) {
    if (!mapData.buildings) {
      return;
    }
    // Military-style buildings: simple gray blocks with outlines
    ctx.fillStyle = "#c4b8a8";
    ctx.strokeStyle = "#5a4d3f";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < mapData.buildings.length; i += 1) {
      const b = mapData.buildings[i];
      // Building fill
      ctx.fillRect(b.x, b.y, b.width, b.height);
      // Building outline
      ctx.strokeRect(b.x, b.y, b.width, b.height);
      // Roof detail line (horizontal)
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + b.height * 0.4);
      ctx.lineTo(b.x + b.width, b.y + b.height * 0.4);
      ctx.stroke();
      // Roof detail line (vertical)
      ctx.beginPath();
      ctx.moveTo(b.x + b.width * 0.5, b.y);
      ctx.lineTo(b.x + b.width * 0.5, b.y + b.height * 0.4);
      ctx.stroke();
    }
  }

  drawHills(ctx) {
    for (let i = 0; i < mapData.hills.length; i += 1) {
      const hill = mapData.hills[i];
      
      // Hill shading with military-style brown tones
      const grad = ctx.createRadialGradient(
        hill.x,
        hill.y,
        hill.radius * 0.15,
        hill.x,
        hill.y,
        hill.radius
      );
      grad.addColorStop(0, "rgba(139, 119, 101, 0.25)");
      grad.addColorStop(0.5, "rgba(139, 119, 101, 0.12)");
      grad.addColorStop(1, "rgba(139, 119, 101, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(hill.x, hill.y, hill.radius, 0, Math.PI * 2);
      ctx.fill();

      // Hill peak marker (small circle at summit)
      ctx.strokeStyle = MAP_CONFIG.contourColorMajor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hill.x, hill.y, hill.radius * 0.12, 0, Math.PI * 2);
      ctx.stroke();
      
      // Elevation label in military style
      ctx.fillStyle = MAP_CONFIG.contourColorMajor;
      ctx.font = `bold ${Math.max(11, 18 / this.camera.zoom)}px Arial`;
      ctx.fillText(hill.elevation.toFixed(0) + "m", hill.x - 10, hill.y + 4);
    }
  }
  
  drawHillShading(ctx) {
    // Subtle terrain shading based on hills
    for (let i = 0; i < mapData.hills.length; i += 1) {
      const hill = mapData.hills[i];
      const shadeGrad = ctx.createRadialGradient(
        hill.x - hill.radius * 0.15,
        hill.y - hill.radius * 0.15,
        hill.radius * 0.1,
        hill.x,
        hill.y,
        hill.radius * 1.2
      );
      shadeGrad.addColorStop(0, "rgba(101, 67, 33, 0.08)");
      shadeGrad.addColorStop(0.6, "rgba(101, 67, 33, 0.03)");
      shadeGrad.addColorStop(1, "rgba(101, 67, 33, 0)");
      ctx.fillStyle = shadeGrad;
      ctx.beginPath();
      ctx.arc(hill.x, hill.y, hill.radius * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Track unit positions for trail effect
  updateUnitTrails(units) {
    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i];
      if (unit.neutralized) continue;

      if (!this.unitTrails[unit.id]) {
        this.unitTrails[unit.id] = [];
      }

      const trail = this.unitTrails[unit.id];
      // Check if unit moved significantly
      if (trail.length === 0) {
        trail.push({ x: unit.x, y: unit.y });
      } else {
        const last = trail[trail.length - 1];
        const dx = unit.x - last.x;
        const dy = unit.y - last.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 10) {
          trail.push({ x: unit.x, y: unit.y });
          if (trail.length > 6) {
            trail.shift();
          }
        }
      }
    }
  }

  drawUnitTrails(ctx) {
    const units = this.state.units;
    if (!units) return;

    const zoomScale = Math.min(2.0, Math.max(0.5, this.camera.zoom));

    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i];
      if (unit.neutralized) continue;

      const trail = this.unitTrails[unit.id];
      if (!trail || trail.length < 2) continue;

      const color = unit.faction === "Player" ? "rgba(46, 204, 113, 0.3)" : "rgba(231, 76, 60, 0.3)";

      ctx.strokeStyle = color;
      ctx.lineWidth = unit.size * 0.3 * zoomScale;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(trail[0].x, trail[0].y);
      for (let t = 1; t < trail.length; t += 1) {
        ctx.lineTo(trail[t].x, trail[t].y);
      }
      ctx.stroke();
    }
  }

  // Initialize unit animation state
  initUnitAnim(units) {
    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i];
      if (!this.unitAnim[unit.id]) {
        this.unitAnim[unit.id] = {
          walkPhase: Math.random() * Math.PI * 2,
          bobPhase: Math.random() * Math.PI * 2,
          flashTimer: 0,
          lastX: unit.x,
          lastY: unit.y,
          moving: false
        };
      }
    }
  }

  drawUnits(ctx) {
    const units = this.state.units;
    if (!units) {
      return;
    }

    const zoomScale = Math.min(2.0, Math.max(0.5, this.camera.zoom));
    this.initUnitAnim(units);
    this.updateUnitTrails(units);

    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i];
      if (unit.neutralized) {
        continue;
      }

      const anim = this.unitAnim[unit.id];
      if (!anim) continue;

      // Detect movement for animation
      const moved = Math.hypot(unit.x - anim.lastX, unit.y - anim.lastY) > 1;
      anim.moving = moved;
      anim.lastX = unit.x;
      anim.lastY = unit.y;

      if (moved) {
        anim.walkPhase += 0.15;
        anim.bobPhase += 0.12;
      }

      const color = unit.faction === "Player" ? "#2ecc71" : "#e74c3c";
      const pulse = 0.5 + 0.5 * Math.sin(this.currentTime / 260 + i);
      const bobOffset = moved ? Math.sin(anim.bobPhase) * 2 * zoomScale : 0;
      const aircraftBob = unit.category === "Aircraft" ? Math.sin(this.currentTime / 240 + i) * 4 * zoomScale : 0;

      ctx.save();
      ctx.translate(unit.x, unit.y + bobOffset + aircraftBob);
      ctx.rotate(unit.heading || 0);

      const drawSize = unit.size * zoomScale;

      // Weapon muzzle flash animation
      if (anim.flashTimer > 0) {
        anim.flashTimer -= 0.04;
      }

      if (unit.category === "Aircraft") {
        this.drawAircraftUnit(ctx, unit, drawSize, color, anim);
      } else if (unit.category === "Vehicle") {
        this.drawVehicleUnit(ctx, unit, drawSize, color, anim);
      } else if (unit.category === "Artillery") {
        this.drawArtilleryUnit(ctx, unit, drawSize, color, anim);
      } else {
        this.drawInfantryUnit(ctx, unit, drawSize, color, anim);
      }

      ctx.restore();

      // Selection ring
      if (this.state.selectedUnitId === unit.id) {
        ctx.strokeStyle = "rgba(241, 196, 15, 0.9)";
        ctx.lineWidth = 2 * zoomScale;
        ctx.setLineDash([6 * zoomScale, 4 * zoomScale]);
        ctx.beginPath();
        ctx.arc(unit.x, unit.y, drawSize + 8 * zoomScale + pulse * 3 * zoomScale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Suppression ring
      if (unit.suppression > 0.6) {
        ctx.strokeStyle = "rgba(231, 76, 60, 0.6)";
        ctx.lineWidth = 1.5 * zoomScale;
        ctx.setLineDash([4 * zoomScale, 6 * zoomScale]);
        ctx.beginPath();
        ctx.arc(unit.x, unit.y, drawSize + 14 * zoomScale + pulse * 5 * zoomScale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      this.drawStatusBars(ctx, unit, zoomScale);
    }
  }

  // ==================== IMPROVED UNIT GRAPHICS ====================

  drawInfantryUnit(ctx, unit, size, color, anim) {
    const s = size;
    const walkCycle = anim && anim.moving ? Math.sin(anim.walkPhase) : 0;
    const walkCycle2 = anim && anim.moving ? Math.sin(anim.walkPhase + Math.PI) : 0;

    ctx.save();

    // Shadow
    ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
    ctx.beginPath();
    ctx.ellipse(0, s * 0.55, s * 0.4, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs with walking animation
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, s * 0.15);
    ctx.lineCap = "round";

    // Left leg
    ctx.beginPath();
    ctx.moveTo(-s * 0.12, s * 0.15);
    ctx.lineTo(-s * 0.12 + walkCycle * s * 0.1, s * 0.55);
    ctx.stroke();

    // Right leg
    ctx.beginPath();
    ctx.moveTo(s * 0.12, s * 0.15);
    ctx.lineTo(s * 0.12 + walkCycle2 * s * 0.1, s * 0.55);
    ctx.stroke();

    // Body (torso) - filled polygon
    ctx.fillStyle = color;
    ctx.strokeStyle = this.darkenColor(color, 0.3);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-s * 0.25, -s * 0.05);
    ctx.lineTo(s * 0.25, -s * 0.05);
    ctx.lineTo(s * 0.2, s * 0.2);
    ctx.lineTo(-s * 0.2, s * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Body detail - webbing/gear
    ctx.strokeStyle = this.darkenColor(color, 0.5);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-s * 0.15, s * 0.05);
    ctx.lineTo(s * 0.15, s * 0.05);
    ctx.stroke();

    // Head
    ctx.fillStyle = this.lightenColor(color, 0.3);
    ctx.strokeStyle = this.darkenColor(color, 0.3);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, -s * 0.35, s * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Helmet
    ctx.fillStyle = this.darkenColor(color, 0.2);
    ctx.beginPath();
    ctx.arc(0, -s * 0.38, s * 0.2, Math.PI, 0);
    ctx.fill();

    // Arms with weapon
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, s * 0.12);

    // Weapon - varies by type
    const weaponColor = "#16a085";
    ctx.strokeStyle = weaponColor;
    ctx.lineWidth = Math.max(2, s * 0.12);

    if (unit.weapon === "Small Arms") {
      // Rifle
      const armWag = anim && anim.moving ? walkCycle * s * 0.05 : 0;
      ctx.beginPath();
      ctx.moveTo(s * 0.15 + armWag, -s * 0.05);
      ctx.lineTo(s * 0.6 + armWag, s * 0.15);
      ctx.stroke();

      // Gun detail
      ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s * 0.55 + armWag, s * 0.12);
      ctx.lineTo(s * 0.65 + armWag, s * 0.18);
      ctx.stroke();
    } else if (unit.weapon === "Heavy MG") {
      // Machine gun - larger
      ctx.fillStyle = weaponColor;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
      ctx.lineWidth = 1.5;

      // Body of MG
      ctx.fillRect(s * 0.15, -s * 0.1, s * 0.45, s * 0.2);
      ctx.strokeRect(s * 0.15, -s * 0.1, s * 0.45, s * 0.2);

      // Barrel
      ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(s * 0.6, 0);
      ctx.lineTo(s * 0.8, s * 0.05);
      ctx.stroke();

      // Bipod
      ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s * 0.3, s * 0.1);
      ctx.lineTo(s * 0.25, s * 0.25);
      ctx.moveTo(s * 0.4, s * 0.1);
      ctx.lineTo(s * 0.45, s * 0.25);
      ctx.stroke();
    } else if (unit.weapon === "Anti-Armor") {
      // RPG / AT weapon
      ctx.fillStyle = weaponColor;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
      ctx.lineWidth = 1.5;

      // Tube
      ctx.save();
      ctx.translate(s * 0.2, -s * 0.05);
      ctx.rotate(-0.1);
      ctx.fillRect(0, -s * 0.06, s * 0.55, s * 0.12);
      ctx.strokeRect(0, -s * 0.06, s * 0.55, s * 0.12);

      // Warhead
      ctx.fillStyle = this.darkenColor(weaponColor, 0.2);
      ctx.beginPath();
      ctx.arc(s * 0.55, 0, s * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (unit.weapon === "Explosive") {
      // Grenade / explosive charge
      ctx.strokeStyle = weaponColor;
      ctx.lineWidth = Math.max(2, s * 0.1);
      ctx.beginPath();
      ctx.arc(s * 0.35, s * 0.1, s * 0.15, 0, Math.PI * 2);
      ctx.stroke();

      // Fill
      ctx.fillStyle = "rgba(241, 196, 15, 0.3)";
      ctx.beginPath();
      ctx.arc(s * 0.35, s * 0.1, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawVehicleUnit(ctx, unit, size, color, anim) {
    const s = size;
    ctx.save();

    // Shadow
    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.beginPath();
    ctx.ellipse(0, s * 0.4, s * 0.85, s * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();

    // Main hull
    ctx.fillStyle = color;
    ctx.strokeStyle = this.darkenColor(color, 0.4);
    ctx.lineWidth = 1.5;

    // Hull body
    ctx.beginPath();
    ctx.moveTo(-s * 0.85, -s * 0.3);
    ctx.lineTo(s * 0.85, -s * 0.3);
    ctx.lineTo(s * 0.75, s * 0.3);
    ctx.lineTo(-s * 0.75, s * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Hull detail line
    ctx.strokeStyle = this.darkenColor(color, 0.2);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-s * 0.8, -s * 0.1);
    ctx.lineTo(s * 0.8, -s * 0.1);
    ctx.stroke();

    // Armor classification indicator
    if (unit.armor === "Heavy") {
      // Extra armor plates
      ctx.strokeStyle = this.darkenColor(color, 0.5);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-s * 0.82, -s * 0.28, s * 0.1, s * 0.55);
      ctx.strokeRect(s * 0.72, -s * 0.28, s * 0.1, s * 0.55);

      // Tank turret
      ctx.fillStyle = this.darkenColor(color, 0.15);
      ctx.strokeStyle = this.darkenColor(color, 0.4);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, -s * 0.05, s * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Turret detail
      ctx.fillStyle = this.darkenColor(color, 0.25);
      ctx.beginPath();
      ctx.arc(0, -s * 0.05, s * 0.2, 0, Math.PI * 2);
      ctx.fill();

      // Cannon barrel
      ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
      ctx.lineWidth = Math.max(2.5, s * 0.12);
      ctx.lineCap = "round";

      // Flash effect when firing
      if (anim && anim.flashTimer > 0) {
        ctx.strokeStyle = `rgba(241, 196, 15, ${anim.flashTimer * 0.8})`;
        ctx.lineWidth = Math.max(3, s * 0.15);
        ctx.beginPath();
        ctx.moveTo(s * 0.35, -s * 0.05);
        ctx.lineTo(s * 1.4, -s * 0.05);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255, 255, 200, ${anim.flashTimer * 0.9})`;
        ctx.lineWidth = Math.max(6, s * 0.25);
        ctx.beginPath();
        ctx.moveTo(s * 0.35, -s * 0.05);
        ctx.lineTo(s * 1.3, -s * 0.05);
        ctx.stroke();
      }

      ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
      ctx.lineWidth = Math.max(2.5, s * 0.1);
      ctx.beginPath();
      ctx.moveTo(s * 0.35, -s * 0.05);
      ctx.lineTo(s * 1.1, -s * 0.05);
      ctx.stroke();

      // Muzzle brake
      ctx.lineWidth = Math.max(3, s * 0.14);
      ctx.beginPath();
      ctx.moveTo(s * 1.05, -s * 0.05);
      ctx.lineTo(s * 1.15, -s * 0.05);
      ctx.stroke();

      // Tracks
      ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(-s * 0.8, s * 0.28);
      ctx.lineTo(s * 0.8, s * 0.28);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.8, s * 0.34);
      ctx.lineTo(s * 0.8, s * 0.34);
      ctx.stroke();

      // Track wheels (circles)
      const wheelCount = 5;
      ctx.fillStyle = this.darkenColor(color, 0.5);
      for (let w = 0; w < wheelCount; w += 1) {
        const wx = -s * 0.65 + (s * 1.3 / (wheelCount - 1)) * w;
        ctx.beginPath();
        ctx.arc(wx, s * 0.31, s * 0.06, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else {
      // APC/IFV - raised section
      ctx.fillStyle = this.darkenColor(color, 0.1);
      ctx.strokeStyle = this.darkenColor(color, 0.4);
      ctx.lineWidth = 1.5;
      ctx.fillRect(-s * 0.4, -s * 0.55, s * 0.8, s * 0.35);
      ctx.strokeRect(-s * 0.4, -s * 0.55, s * 0.8, s * 0.35);

      // Vision ports
      ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
      ctx.fillRect(-s * 0.3, -s * 0.48, s * 0.15, s * 0.1);
      ctx.fillRect(s * 0.15, -s * 0.48, s * 0.15, s * 0.1);

      // Weapon (MG turret)
      ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(s * 0.3, -s * 0.4);
      ctx.lineTo(s * 0.65, -s * 0.25);
      ctx.stroke();

      // MG flash
      if (anim && anim.flashTimer > 0) {
        ctx.strokeStyle = `rgba(241, 196, 15, ${anim.flashTimer * 0.7})`;
        ctx.lineWidth = Math.max(3, s * 0.12);
        ctx.beginPath();
        ctx.moveTo(s * 0.65, -s * 0.25);
        ctx.lineTo(s * 0.85, -s * 0.15);
        ctx.stroke();
      }

      // Tracks
      ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
      ctx.lineWidth = Math.max(2, s * 0.07);
      ctx.beginPath();
      ctx.moveTo(-s * 0.7, s * 0.3);
      ctx.lineTo(s * 0.7, s * 0.3);
      ctx.stroke();

      // Wheels
      ctx.fillStyle = this.darkenColor(color, 0.5);
      const wheelCount2 = 4;
      for (let w = 0; w < wheelCount2; w += 1) {
        const wx = -s * 0.55 + (s * 1.1 / (wheelCount2 - 1)) * w;
        ctx.beginPath();
        ctx.arc(wx, s * 0.3, s * 0.05, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  drawArtilleryUnit(ctx, unit, size, color, anim) {
    const s = size;
    ctx.save();

    // Shadow
    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.beginPath();
    ctx.ellipse(0, s * 0.32, s * 0.75, s * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

    // Base/chassis
    ctx.fillStyle = color;
    ctx.strokeStyle = this.darkenColor(color, 0.4);
    ctx.lineWidth = 1.5;
    ctx.fillRect(-s * 0.7, -s * 0.2, s * 1.4, s * 0.4);
    ctx.strokeRect(-s * 0.7, -s * 0.2, s * 1.4, s * 0.4);

    // Chassis detail
    ctx.strokeStyle = this.darkenColor(color, 0.2);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-s * 0.6, 0);
    ctx.lineTo(s * 0.6, 0);
    ctx.stroke();

    // Gun shield
    ctx.fillStyle = this.darkenColor(color, 0.15);
    ctx.strokeStyle = this.darkenColor(color, 0.4);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-s * 0.3, -s * 0.2);
    ctx.lineTo(s * 0.3, -s * 0.2);
    ctx.lineTo(s * 0.2, -s * 0.6);
    ctx.lineTo(-s * 0.2, -s * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Barrel
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.lineCap = "butt";
    ctx.lineWidth = Math.max(3, s * 0.12);
    ctx.beginPath();
    ctx.moveTo(s * 0.1, -s * 0.4);
    ctx.lineTo(s * 1.3, -s * 0.4);
    ctx.stroke();

    // Barrel muzzle
    ctx.lineWidth = Math.max(4, s * 0.16);
    ctx.beginPath();
    ctx.moveTo(s * 1.2, -s * 0.4);
    ctx.lineTo(s * 1.35, -s * 0.4);
    ctx.stroke();

    // Muzzle flash
    if (anim && anim.flashTimer > 0) {
      ctx.fillStyle = `rgba(241, 196, 15, ${anim.flashTimer * 0.6})`;
      ctx.strokeStyle = `rgba(255, 255, 200, ${anim.flashTimer * 0.8})`;
      ctx.lineWidth = Math.max(6, s * 0.3);
      ctx.beginPath();
      ctx.moveTo(s * 1.3, -s * 0.4);
      ctx.lineTo(s * 1.8, -s * 0.4);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(s * 1.3, -s * 0.4, s * 0.2 * anim.flashTimer, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wheels/tracks
    ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
    ctx.lineWidth = Math.max(2, s * 0.07);
    ctx.beginPath();
    ctx.moveTo(-s * 0.6, s * 0.2);
    ctx.lineTo(s * 0.6, s * 0.2);
    ctx.stroke();

    // Wheels
    ctx.fillStyle = this.darkenColor(color, 0.5);
    const wheelCount = 3;
    for (let w = 0; w < wheelCount; w += 1) {
      const wx = -s * 0.45 + (s * 0.9 / (wheelCount - 1)) * w;
      ctx.beginPath();
      ctx.arc(wx, s * 0.2, s * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  drawAircraftUnit(ctx, unit, size, color, anim) {
    const s = size;
    ctx.save();

    // Shadow (larger for aircraft - they're higher)
    ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
    ctx.beginPath();
    ctx.ellipse(0, s * 0.9, s * 0.8, s * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();

    const isHelicopter = unit.speed < 30;

    if (isHelicopter) {
      // === HELICOPTER ===

      // Main fuselage
      ctx.fillStyle = color;
      ctx.strokeStyle = this.darkenColor(color, 0.4);
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.25, s * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Cockpit
      ctx.fillStyle = "rgba(200, 230, 255, 0.6)";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.35, s * 0.15, s * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Tail boom
      ctx.strokeStyle = this.darkenColor(color, 0.3);
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(0, s * 0.45);
      ctx.lineTo(0, s * 0.8);
      ctx.stroke();

      // Tail rotor
      ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-s * 0.2, s * 0.8);
      ctx.lineTo(s * 0.2, s * 0.8);
      ctx.stroke();

      // Main rotor (spinning)
      const rotorAngle = this.currentTime * 0.02;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
      ctx.lineWidth = Math.max(2, s * 0.06);
      ctx.beginPath();
      ctx.moveTo(-s * 1.1 + Math.cos(rotorAngle) * 0, -s * 0.65 - Math.sin(rotorAngle) * 0);
      ctx.lineTo(s * 1.1 + Math.cos(rotorAngle) * 0, -s * 0.65 + Math.sin(rotorAngle) * 0);
      ctx.stroke();

      // Second rotor blade
      ctx.beginPath();
      ctx.moveTo(-Math.cos(rotorAngle) * s * 1.1, -s * 0.65 + Math.sin(rotorAngle) * s * 1.1);
      ctx.lineTo(Math.cos(rotorAngle) * s * 1.1, -s * 0.65 - Math.sin(rotorAngle) * s * 1.1);
      ctx.stroke();

      // Rotor hub
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.beginPath();
      ctx.arc(0, -s * 0.65, s * 0.04, 0, Math.PI * 2);
      ctx.fill();

      // Skids
      ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-s * 0.35, s * 0.5);
      ctx.lineTo(-s * 0.25, s * 0.55);
      ctx.moveTo(s * 0.35, s * 0.5);
      ctx.lineTo(s * 0.25, s * 0.55);
      ctx.stroke();

      // Weapon pods
      ctx.fillStyle = this.darkenColor(color, 0.3);
      ctx.fillRect(-s * 0.5, -s * 0.15, s * 0.12, s * 0.3);
      ctx.fillRect(s * 0.38, -s * 0.15, s * 0.12, s * 0.3);

    } else {
      // === FIXED-WING AIRCRAFT ===

      // Main fuselage
      ctx.fillStyle = color;
      ctx.strokeStyle = this.darkenColor(color, 0.4);
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.22, s * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Wings
      ctx.fillStyle = this.darkenColor(color, 0.1);
      ctx.strokeStyle = this.darkenColor(color, 0.4);
      ctx.lineWidth = 1.5;

      // Main wing
      ctx.beginPath();
      ctx.moveTo(-s * 0.85, -s * 0.05);
      ctx.lineTo(s * 0.85, -s * 0.05);
      ctx.lineTo(s * 0.65, s * 0.12);
      ctx.lineTo(-s * 0.65, s * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Wing details
      ctx.strokeStyle = this.darkenColor(color, 0.3);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-s * 0.7, 0);
      ctx.lineTo(s * 0.7, 0);
      ctx.stroke();

      // Tail
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, s * 0.55);
      ctx.lineTo(s * 0.3, s * 0.55);
      ctx.lineTo(s * 0.15, s * 0.8);
      ctx.lineTo(-s * 0.15, s * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Vertical stabilizer
      ctx.beginPath();
      ctx.moveTo(0, s * 0.55);
      ctx.lineTo(0, s * 0.85);
      ctx.lineTo(s * 0.1, s * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Cockpit
      ctx.fillStyle = "rgba(200, 230, 255, 0.6)";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.5, s * 0.1, s * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Engines
      ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
      ctx.fillRect(-s * 0.55, -s * 0.12, s * 0.18, s * 0.25);
      ctx.fillRect(s * 0.37, -s * 0.12, s * 0.18, s * 0.25);

      // Engine intake
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillRect(-s * 0.52, -s * 0.13, s * 0.12, s * 0.06);
      ctx.fillRect(s * 0.4, -s * 0.13, s * 0.12, s * 0.06);

      // Weapons (missiles under wings)
      ctx.fillStyle = this.darkenColor(color, 0.4);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
      ctx.lineWidth = 1;
      const missileY = s * 0.1;
      ctx.fillRect(-s * 0.6, missileY, s * 0.08, s * 0.2);
      ctx.strokeRect(-s * 0.6, missileY, s * 0.08, s * 0.2);
      ctx.fillRect(s * 0.52, missileY, s * 0.08, s * 0.2);
      ctx.strokeRect(s * 0.52, missileY, s * 0.08, s * 0.2);
    }

    ctx.restore();
  }

  // ==================== HELPER METHODS ====================

  darkenColor(hex, amount) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${Math.round(r * (1 - amount))}, ${Math.round(g * (1 - amount))}, ${Math.round(b * (1 - amount))}, 0.8)`;
  }

  lightenColor(hex, amount) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${Math.min(255, Math.round(r + (255 - r) * amount))}, ${Math.min(255, Math.round(g + (255 - g) * amount))}, ${Math.min(255, Math.round(b + (255 - b) * amount))}, 0.9)`;
  }

  drawStatusBars(ctx, unit, zoomScale) {
    const scale = zoomScale || 1;
    const barWidth = unit.size * 2.2 * scale;
    const x = unit.x - barWidth / 2;
    const y = unit.y + unit.size * scale + 10 * scale;

    // Ammo bar background
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x, y, barWidth, 5 * scale);

    // Ammo bar
    const ammoRatio = unit.ammoLimit > 0 ? unit.ammo / unit.ammoLimit : 0;
    const ammoColor = ammoRatio > 0.3 ? "rgba(46, 204, 113, 0.9)" : ammoRatio > 0.1 ? "rgba(241, 196, 15, 0.9)" : "rgba(231, 76, 60, 0.9)";
    ctx.fillStyle = ammoColor;
    ctx.fillRect(x + 1, y + 1, (barWidth - 2) * ammoRatio, 3 * scale);

    // Suppression bar background
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x, y + 7 * scale, barWidth, 5 * scale);

    // Suppression bar
    const supColor = unit.suppression > 0.6 ? "rgba(231, 76, 60, 0.9)" : unit.suppression > 0.3 ? "rgba(241, 196, 15, 0.9)" : "rgba(52, 152, 219, 0.9)";
    ctx.fillStyle = supColor;
    ctx.fillRect(x + 1, y + 8 * scale, (barWidth - 2) * unit.suppression, 3 * scale);
  }

  drawEffects(ctx, delta) {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      effect.ttl -= delta;
      if (effect.ttl <= 0) {
        this.effects.splice(i, 1);
        continue;
      }

      if (effect.type === "laser") {
        const alpha = effect.ttl / 0.18;
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(effect.from.x, effect.from.y);
        ctx.lineTo(effect.to.x, effect.to.y);
        ctx.stroke();

        // Glow effect
        ctx.strokeStyle = effect.color.replace("0.9", "0.3");
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(effect.from.x, effect.from.y);
        ctx.lineTo(effect.to.x, effect.to.y);
        ctx.stroke();
      }

      if (effect.type === "projectile") {
        // Moving projectile
        const progress = 1 - effect.ttl / effect.baseTtl;
        const cx = effect.from.x + (effect.to.x - effect.from.x) * progress;
        const cy = effect.from.y + (effect.to.y - effect.from.y) * progress;

        // Projectile trail
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        const trailLen = 0.1;
        const trailStart = Math.max(0, progress - trailLen);
        const tx = effect.from.x + (effect.to.x - effect.from.x) * trailStart;
        const ty = effect.from.y + (effect.to.y - effect.from.y) * trailStart;
        ctx.moveTo(tx, ty);
        ctx.lineTo(cx, cy);
        ctx.stroke();

        // Projectile glow
        ctx.fillStyle = effect.color.replace("0.9", "0.4");
        ctx.beginPath();
        ctx.arc(cx, cy, effect.radius || 4, 0, Math.PI * 2);
        ctx.fill();

        // Projectile core
        ctx.fillStyle = effect.color;
        ctx.beginPath();
        ctx.arc(cx, cy, (effect.radius || 4) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (effect.type === "explosion") {
        const alpha = Math.max(0, effect.ttl / effect.baseTtl);
        const expandFactor = 1 - alpha * 0.4;

        // Outer ring (smoke/orange)
        ctx.fillStyle = `rgba(241, 196, 15, ${0.4 * alpha})`;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.radius * expandFactor, 0, Math.PI * 2);
        ctx.fill();

        // Inner flash (white/yellow)
        ctx.fillStyle = `rgba(255, 255, 200, ${0.6 * alpha * alpha})`;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.radius * 0.4 * expandFactor, 0, Math.PI * 2);
        ctx.fill();

        // Debris particles
        const particles = 8;
        for (let p = 0; p < particles; p += 1) {
          const angle = (Math.PI * 2 / particles) * p + delta * 2;
          const dist = effect.radius * (1 - alpha) * 1.2;
          ctx.fillStyle = `rgba(180, 120, 40, ${0.5 * alpha})`;
          ctx.beginPath();
          ctx.arc(
            effect.x + Math.cos(angle) * dist,
            effect.y + Math.sin(angle) * dist,
            2 * alpha,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
      }

      if (effect.type === "muzzle_flash") {
        const alpha = Math.max(0, effect.ttl / effect.baseTtl);
        ctx.fillStyle = `rgba(255, 255, 200, ${alpha})`;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.radius * (1 + alpha * 0.5), 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(241, 196, 15, ${alpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.radius * 1.5 * (1 + alpha * 0.3), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawMeasurement(ctx) {
    const measure = this.state.mapTool ? this.state.mapTool.measure : null;
    if (!measure || !measure.start || !measure.end) {
      return;
    }
    const start = measure.start;
    const end = measure.end;
    const dist = measure.distance || Math.hypot(end.x - start.x, end.y - start.y);

    ctx.save();
    ctx.strokeStyle = "rgba(255, 180, 84, 0.9)";
    ctx.lineWidth = 2 / this.camera.zoom;
    ctx.setLineDash([14 / this.camera.zoom, 10 / this.camera.zoom]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(12, 18, 24, 0.8)";
    ctx.strokeStyle = "rgba(255, 180, 84, 0.9)";
    ctx.lineWidth = 1.5 / this.camera.zoom;
    ctx.beginPath();
    ctx.arc(start.x, start.y, 6 / this.camera.zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(end.x, end.y, 6 / this.camera.zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    const label = Math.round(dist) + " m";
    ctx.font = `${Math.max(12, 18 / this.camera.zoom)}px "Trebuchet MS"`;
    const textWidth = ctx.measureText(label).width;
    const pad = 6 / this.camera.zoom;
    ctx.fillStyle = "rgba(12, 18, 24, 0.85)";
    ctx.fillRect(midX - textWidth / 2 - pad, midY - 12 / this.camera.zoom, textWidth + pad * 2, 20 / this.camera.zoom);
    ctx.strokeStyle = "rgba(255, 180, 84, 0.7)";
    ctx.strokeRect(midX - textWidth / 2 - pad, midY - 12 / this.camera.zoom, textWidth + pad * 2, 20 / this.camera.zoom);
    ctx.fillStyle = "#ffd58a";
    ctx.fillText(label, midX - textWidth / 2, midY + 4 / this.camera.zoom);
    ctx.restore();
  }
}