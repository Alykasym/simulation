import { MAP_CONFIG } from "../models/mapData.js";

export default class InputHandler {
  constructor(canvas, renderer, state, callbacks) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.state = state;
    this.callbacks = callbacks;
    this.isPanning = false;
    this.isDragging = false;
    this.dragUnitId = null;
    this.spaceDown = false;
    this.lastMouse = { x: 0, y: 0 };
    this.roadAnchor = null;

    this.bindEvents();
  }

  bindEvents() {
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.canvas.addEventListener("mousedown", (event) => this.onMouseDown(event));
    window.addEventListener("mousemove", (event) => this.onMouseMove(event));
    window.addEventListener("mouseup", () => this.onMouseUp());
    this.canvas.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    window.addEventListener("keydown", (event) => this.onKeyDown(event));
    window.addEventListener("keyup", (event) => this.onKeyUp(event));
  }

  onMouseDown(event) {
    if (typeof this.canvas.focus === "function") {
      this.canvas.focus();
    }
    this.lastMouse = { x: event.clientX, y: event.clientY };

    if (this.state.mapTool.type !== "Add Road") {
      this.roadAnchor = null;
    }

    if (event.button === 0 && this.spaceDown) {
      this.isPanning = true;
      return;
    }

    if (event.button === 1 || event.button === 2) {
      this.isPanning = true;
      return;
    }

    const world = this.renderer.screenToWorld(event.clientX, event.clientY);
    const hitUnit = this.callbacks.findUnitAt(world);

    if (hitUnit) {
      this.callbacks.selectUnit(hitUnit);
      this.isDragging = true;
      this.dragUnitId = hitUnit.id;
      return;
    }

    if (this.state.mapTool.type === "Measure") {
      this.handleMeasureClick(world);
      return;
    }

    if (this.state.mapTool.type === "Add Hill") {
      this.callbacks.addHill(world, this.state.mapTool.hillElevation, this.state.mapTool.hillRadius);
      return;
    }

    if (this.state.mapTool.type === "Add Road") {
      this.handleRoadPlacement(world);
      return;
    }

    if (this.state.mapTool.type === "Add Building") {
      this.callbacks.addBuilding(world, this.state.mapTool.buildingWidth, this.state.mapTool.buildingHeight);
      return;
    }

    this.callbacks.placeUnits(world);
  }

  handleMeasureClick(world) {
    const current = this.state.mapTool.measure || {
      start: null,
      end: null,
      locked: false,
      distance: 0
    };

    if (!current.start || current.locked) {
      current.start = { x: world.x, y: world.y };
      current.end = { x: world.x, y: world.y };
      current.locked = false;
    } else {
      current.end = { x: world.x, y: world.y };
      current.locked = true;
    }

    current.distance = Math.hypot(current.end.x - current.start.x, current.end.y - current.start.y);
    this.state.mapTool.measure = current;
    if (this.callbacks.updateMeasure) {
      this.callbacks.updateMeasure(current);
    }
  }

  handleRoadPlacement(world) {
    if (!this.roadAnchor) {
      this.roadAnchor = { x: world.x, y: world.y };
      return;
    }

    this.callbacks.addRoad(this.roadAnchor, world, this.state.mapTool.roadType);
    this.roadAnchor = null;
  }

  onMouseMove(event) {
    const dx = event.clientX - this.lastMouse.x;
    const dy = event.clientY - this.lastMouse.y;
    this.lastMouse = { x: event.clientX, y: event.clientY };

    if (this.isPanning) {
      this.renderer.panBy(dx, dy);
      return;
    }

    if (this.isDragging && this.dragUnitId) {
      const world = this.renderer.screenToWorld(event.clientX, event.clientY);
      const unit = this.callbacks.getUnitById(this.dragUnitId);
      if (unit) {
        unit.x = Math.max(0, Math.min(MAP_CONFIG.width, world.x));
        unit.y = Math.max(0, Math.min(MAP_CONFIG.height, world.y));
      }
      return;
    }

    if (this.state.mapTool.type === "Measure") {
      const measure = this.state.mapTool.measure;
      if (measure && measure.start && !measure.locked) {
        const world = this.renderer.screenToWorld(event.clientX, event.clientY);
        measure.end = { x: world.x, y: world.y };
        measure.distance = Math.hypot(measure.end.x - measure.start.x, measure.end.y - measure.start.y);
        this.state.mapTool.measure = measure;
        if (this.callbacks.updateMeasure) {
          this.callbacks.updateMeasure(measure);
        }
      }
    }
  }

  onMouseUp() {
    this.isPanning = false;
    this.isDragging = false;
    this.dragUnitId = null;
  }

  onWheel(event) {
    event.preventDefault();
    this.renderer.zoomAt(event.deltaY, event.clientX, event.clientY);
  }

  onKeyDown(event) {
    if (event.code === "Space") {
      this.spaceDown = true;
      event.preventDefault();
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      if (this.state.selectedUnitId) {
        this.callbacks.deleteSelectedUnit();
      }
    }

    if (event.key === "Escape") {
      this.roadAnchor = null;
      this.clearMeasure();
      this.callbacks.clearSelection();
    }
  }

  onKeyUp(event) {
    if (event.code === "Space") {
      this.spaceDown = false;
    }
  }

  clearMeasure() {
    if (this.state.mapTool.measure) {
      this.state.mapTool.measure = null;
      if (this.callbacks.updateMeasure) {
        this.callbacks.updateMeasure(null);
      }
    }
  }
}
