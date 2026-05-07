import { UNIT_CATEGORIES, ARMOR_CLASSES, WEAPON_TYPES } from "../models/unitDictionary.js";

export default class DomManager {
  constructor(state, callbacks) {
    this.state = state;
    this.callbacks = callbacks;

    this.tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
    this.tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

    this.unitTypeSelect = document.getElementById("unitTypeSelect");
    this.factionSelect = document.getElementById("factionSelect");
    this.unitCount = document.getElementById("unitCount");
    this.formationSelect = document.getElementById("formationSelect");
    this.unitPreview = document.getElementById("unitPreview");

    this.customForm = document.getElementById("customUnitForm");
    this.customCategory = document.getElementById("customCategory");
    this.customArmor = document.getElementById("customArmor");
    this.customWeapon = document.getElementById("customWeapon");

    this.mapToolSelect = document.getElementById("mapToolSelect");
    this.hillElevation = document.getElementById("hillElevation");
    this.hillRadius = document.getElementById("hillRadius");
    this.roadTypeSelect = document.getElementById("roadTypeSelect");
    this.buildingWidth = document.getElementById("buildingWidth");
    this.buildingHeight = document.getElementById("buildingHeight");
    this.overlayInput = document.getElementById("overlayInput");
    this.gridToggle = document.getElementById("gridToggle");
    this.clearMapBtn = document.getElementById("clearMapBtn");

    this.selectedUnitPanel = document.getElementById("selectedUnitPanel");
    this.deleteUnitBtn = document.getElementById("deleteUnitBtn");

    this.exportBtn = document.getElementById("exportBtn");
    this.importInput = document.getElementById("importInput");

    this.predictBtn = document.getElementById("predictBtn");
    this.suggestBtn = document.getElementById("suggestBtn");
    this.mapGenerateBtn = document.getElementById("mapGenerateBtn");
    this.demoGenerateBtn = document.getElementById("demoGenerateBtn");
    this.demoStartBtn = document.getElementById("demoStartBtn");

    this.simMode = document.getElementById("simMode");
    this.timeLimit = document.getElementById("timeLimit");
    this.startBtn = document.getElementById("startBtn");
    this.stopBtn = document.getElementById("stopBtn");
    this.resetBtn = document.getElementById("resetBtn");
    this.aarPanel = document.getElementById("aarPanel");

    this.toolReadout = document.getElementById("toolReadout");
    this.measureHud = document.getElementById("measureHud");
    this.measurePanelValue = document.getElementById("measurePanelValue");
    this.templates = [];
    this.iconCache = {};
    this.labelMaps = this.buildLabelMaps();

    this.bindTabs();
    this.populateReferenceSelects();
    this.bindControls();
    this.updateToolReadout();
    if (this.gridToggle) {
      this.gridToggle.checked = this.state.view.showGrid;
    }
  }

  buildLabelMaps() {
    return {
      category: {
        Infantry: "Pyýada",
        Vehicle: "Ulag",
        Artillery: "Artilleriýa",
        Aircraft: "Howa"
      },
      armor: {
        Unarmored: "Goragsyz",
        Light: "Ýeňil",
        Medium: "Orta",
        Heavy: "Agyr"
      },
      weapon: {
        None: "Ýok",
        "Small Arms": "Kiçi ýarag",
        "Heavy MG": "Agyr pulemýot",
        "Auto Cannon": "Awtomat top",
        "Anti-Armor": "Goraga garşy",
        Explosive: "Partlaýjy",
        "Anti-Air": "Howa garşy",
        "Combined Arms": "Kombinirlenen"
      },
      faction: {
        Player: "Öz goşunymyz",
        Enemy: "Duşman"
      },
      mapTool: {
        None: "ÝERLEŞDIRME",
        "Add Hill": "DEPE",
        "Add Road": "ÝOL",
        "Add Building": "BINA",
        Measure: "ÖLÇEG"
      }
    };
  }

  bindTabs() {
    this.tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-tab");
        this.tabButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.tabPanels.forEach((panel) => {
          if (panel.getAttribute("data-panel") === tab) {
            panel.classList.add("active");
          } else {
            panel.classList.remove("active");
          }
        });

        if (tab !== "map") {
          this.state.mapTool.type = "None";
          this.mapToolSelect.value = "None";
          this.state.mapTool.measure = null;
          this.renderMeasure(null);
          this.updateToolReadout();
        } else {
          this.state.mapTool.type = this.mapToolSelect.value;
          this.updateToolReadout();
        }
      });
    });
  }

  populateReferenceSelects() {
    this.customCategory.innerHTML = "";
    this.customArmor.innerHTML = "";
    this.customWeapon.innerHTML = "";

    Object.keys(UNIT_CATEGORIES).forEach((key) => {
      const value = UNIT_CATEGORIES[key];
      this.customCategory.appendChild(this.buildOption(value, this.translateLabel("category", value)));
    });
    Object.keys(ARMOR_CLASSES).forEach((key) => {
      const value = ARMOR_CLASSES[key];
      this.customArmor.appendChild(this.buildOption(value, this.translateLabel("armor", value)));
    });
    Object.keys(WEAPON_TYPES).forEach((key) => {
      const value = WEAPON_TYPES[key];
      this.customWeapon.appendChild(this.buildOption(value, this.translateLabel("weapon", value)));
    });
  }

  refreshTemplateOptions(templates) {
    this.unitTypeSelect.innerHTML = "";
    this.templates = templates.slice();
    templates.forEach((template) => {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.name;
      this.unitTypeSelect.appendChild(option);
    });
    if (templates.length > 0) {
      this.renderTemplatePreview(templates[0]);
    }
  }

  bindControls() {
    this.factionSelect.addEventListener("change", () => {
      this.state.placement.faction = this.factionSelect.value;
    });

    this.unitTypeSelect.addEventListener("change", () => {
      this.state.placement.templateId = this.unitTypeSelect.value;
      this.renderTemplatePreview(this.findTemplate(this.unitTypeSelect.value));
    });

    this.unitCount.addEventListener("change", () => {
      this.state.placement.count = parseInt(this.unitCount.value, 10) || 1;
    });

    this.formationSelect.addEventListener("change", () => {
      this.state.placement.formation = this.formationSelect.value;
    });

    this.customForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const payload = {
        name: document.getElementById("customName").value.trim(),
        category: this.customCategory.value,
        armor: this.customArmor.value,
        weapon: this.customWeapon.value,
        range: parseFloat(document.getElementById("customRange").value),
        detection: parseFloat(document.getElementById("customDetection").value),
        mobility: parseFloat(document.getElementById("customMobility").value),
        ammoLimit: parseInt(document.getElementById("customAmmo").value, 10)
      };
      this.callbacks.addCustomTemplate(payload);
      this.customForm.reset();
    });

    this.mapToolSelect.addEventListener("change", () => {
      this.state.mapTool.type = this.mapToolSelect.value;
      if (this.state.mapTool.type !== "Measure") {
        this.state.mapTool.measure = null;
        this.renderMeasure(null);
      }
      this.updateToolReadout();
    });

    this.hillElevation.addEventListener("change", () => {
      this.state.mapTool.hillElevation = parseFloat(this.hillElevation.value) || 1.5;
    });

    this.hillRadius.addEventListener("change", () => {
      this.state.mapTool.hillRadius = parseFloat(this.hillRadius.value) || 400;
    });

    this.roadTypeSelect.addEventListener("change", () => {
      this.state.mapTool.roadType = this.roadTypeSelect.value;
    });

    if (this.buildingWidth) {
      this.buildingWidth.addEventListener("change", () => {
        this.state.mapTool.buildingWidth = parseFloat(this.buildingWidth.value) || 200;
      });
    }

    if (this.buildingHeight) {
      this.buildingHeight.addEventListener("change", () => {
        this.state.mapTool.buildingHeight = parseFloat(this.buildingHeight.value) || 160;
      });
    }

    if (this.gridToggle) {
      this.gridToggle.addEventListener("change", () => {
        this.state.view.showGrid = this.gridToggle.checked;
      });
    }

    this.overlayInput.addEventListener("change", () => {
      const file = this.overlayInput.files[0];
      if (file) {
        this.callbacks.loadOverlay(file);
      }
    });

    this.clearMapBtn.addEventListener("click", () => this.callbacks.clearMapFeatures());

    this.deleteUnitBtn.addEventListener("click", () => this.callbacks.deleteSelectedUnit());

    this.exportBtn.addEventListener("click", () => this.callbacks.exportScenario());
    this.importInput.addEventListener("change", () => {
      const file = this.importInput.files[0];
      if (file) {
        this.callbacks.importScenario(file);
      }
    });

    this.predictBtn.addEventListener("click", () => this.callbacks.predictPositions());
    this.suggestBtn.addEventListener("click", () => this.callbacks.suggestAdjustments());
    if (this.mapGenerateBtn) {
      this.mapGenerateBtn.addEventListener("click", () => this.callbacks.generateMapOnly());
    }
    this.demoGenerateBtn.addEventListener("click", () => this.callbacks.generateDemo(false));
    this.demoStartBtn.addEventListener("click", () => this.callbacks.generateDemo(true));

    this.simMode.addEventListener("change", () => {
      this.state.simulation.mode = this.simMode.value;
    });

    this.timeLimit.addEventListener("change", () => {
      this.state.simulation.timeLimit = parseInt(this.timeLimit.value, 10) || 240;
    });

    this.startBtn.addEventListener("click", () => this.callbacks.startSimulation());
    this.stopBtn.addEventListener("click", () => this.callbacks.stopSimulation());
    this.resetBtn.addEventListener("click", () => this.callbacks.resetSimulation());
  }

  buildOption(value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label || value;
    return option;
  }

  translateLabel(group, value) {
    const table = this.labelMaps[group] || {};
    return table[value] || value;
  }

  findTemplate(id) {
    for (let i = 0; i < this.templates.length; i += 1) {
      if (this.templates[i].id === id) {
        return this.templates[i];
      }
    }
    return null;
  }

  getIcon(kind, key) {
    const cacheKey = kind + "_" + key;
    if (this.iconCache[cacheKey]) {
      return this.iconCache[cacheKey];
    }
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const base = ctx.createLinearGradient(0, 0, 64, 64);
    base.addColorStop(0, "#0f151c");
    base.addColorStop(1, "#1f2b33");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 64, 64);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 64; i += 8) {
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 64);
      ctx.moveTo(0, i);
      ctx.lineTo(64, i);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.fillStyle = "rgba(243, 156, 18, 0.95)";
    ctx.lineWidth = 2.5;

    if (kind === "category") {
      if (key === "Infantry") {
        ctx.beginPath();
        ctx.arc(32, 18, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(32, 26);
        ctx.lineTo(32, 46);
        ctx.moveTo(32, 32);
        ctx.lineTo(18, 44);
        ctx.moveTo(32, 32);
        ctx.lineTo(46, 44);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(28, 26);
        ctx.lineTo(36, 26);
        ctx.stroke();
      } else if (key === "Vehicle") {
        ctx.fillRect(12, 32, 40, 14);
        ctx.strokeRect(12, 32, 40, 14);
        ctx.fillRect(26, 24, 12, 8);
        ctx.strokeRect(26, 24, 12, 8);
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.beginPath();
        ctx.moveTo(16, 47);
        ctx.lineTo(48, 47);
        ctx.stroke();
      } else if (key === "Artillery") {
        ctx.fillRect(12, 34, 30, 12);
        ctx.strokeRect(12, 34, 30, 12);
        ctx.beginPath();
        ctx.moveTo(36, 36);
        ctx.lineTo(54, 26);
        ctx.stroke();
      } else if (key === "Aircraft") {
        ctx.beginPath();
        ctx.moveTo(32, 10);
        ctx.lineTo(52, 46);
        ctx.lineTo(32, 40);
        ctx.lineTo(12, 46);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(32, 18);
        ctx.lineTo(32, 50);
        ctx.stroke();
      }
    }

    if (kind === "weapon") {
      ctx.strokeStyle = "rgba(22, 160, 133, 0.9)";
      if (key === "Small Arms") {
        ctx.beginPath();
        ctx.moveTo(14, 38);
        ctx.lineTo(50, 28);
        ctx.stroke();
        ctx.fillRect(20, 36, 8, 10);
        ctx.strokeRect(20, 36, 8, 10);
      } else if (key === "Heavy MG") {
        ctx.strokeRect(14, 28, 34, 12);
        ctx.beginPath();
        ctx.moveTo(48, 34);
        ctx.lineTo(58, 30);
        ctx.stroke();
      } else if (key === "Anti-Armor") {
        ctx.beginPath();
        ctx.moveTo(10, 42);
        ctx.lineTo(54, 24);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(18, 46, 6, 0, Math.PI * 2);
        ctx.stroke();
      } else if (key === "Explosive") {
        ctx.beginPath();
        ctx.arc(32, 34, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(32, 10);
        ctx.lineTo(32, 22);
        ctx.stroke();
      } else if (key === "Anti-Air") {
        ctx.beginPath();
        ctx.moveTo(32, 12);
        ctx.lineTo(32, 52);
        ctx.moveTo(18, 26);
        ctx.lineTo(46, 26);
        ctx.stroke();
      }
    }

    const dataUrl = canvas.toDataURL("image/png");
    this.iconCache[cacheKey] = dataUrl;
    return dataUrl;
  }

  renderTemplatePreview(template) {
    this.unitPreview.innerHTML = "";
    if (!template) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "Görkezmek üçin bölüm şablonyny saýlaň.";
      this.unitPreview.appendChild(empty);
      return;
    }

    const header = document.createElement("div");
    header.className = "preview-header";
    const iconWrap = document.createElement("div");
    iconWrap.className = "preview-icon";
    const iconImg = document.createElement("img");
    iconImg.src = this.getIcon("category", template.category);
    iconWrap.appendChild(iconImg);
    header.appendChild(iconWrap);

    const titleWrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "preview-title";
    title.textContent = template.name;
    const subtitle = document.createElement("div");
    subtitle.className = "preview-subtitle";
    subtitle.textContent =
      this.translateLabel("category", template.category) +
      " | " +
      this.translateLabel("armor", template.armor);
    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);
    header.appendChild(titleWrap);

    this.unitPreview.appendChild(header);

    const badges = document.createElement("div");
    badges.className = "badge-row";
    const weaponBadge = document.createElement("div");
    weaponBadge.className = "badge weapon";
    const weaponIcon = document.createElement("img");
    weaponIcon.src = this.getIcon("weapon", template.weapon);
    const weaponText = document.createElement("span");
    weaponText.textContent = this.translateLabel("weapon", template.weapon);
    weaponBadge.appendChild(weaponIcon);
    weaponBadge.appendChild(weaponText);
    badges.appendChild(weaponBadge);

    const rangeBadge = document.createElement("div");
    rangeBadge.className = "badge";
    rangeBadge.textContent = "Aralyk " + Math.round(template.range);
    badges.appendChild(rangeBadge);

    const detectBadge = document.createElement("div");
    detectBadge.className = "badge";
    detectBadge.textContent = "Görüş " + Math.round(template.detection);
    badges.appendChild(detectBadge);

    const ammoBadge = document.createElement("div");
    ammoBadge.className = "badge";
    ammoBadge.textContent = "Ok-däri " + template.ammoLimit;
    badges.appendChild(ammoBadge);

    this.unitPreview.appendChild(badges);
  }

  renderSelectedUnit(unit) {
    this.selectedUnitPanel.innerHTML = "";
    if (!unit) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "Saýlanan bölüm ýok.";
      this.selectedUnitPanel.appendChild(empty);
      return;
    }

    const header = document.createElement("div");
    header.className = "preview-header";
    const iconWrap = document.createElement("div");
    iconWrap.className = "preview-icon";
    const iconImg = document.createElement("img");
    iconImg.src = this.getIcon("category", unit.category);
    iconWrap.appendChild(iconImg);
    header.appendChild(iconWrap);

    const titleWrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "preview-title";
    title.textContent = unit.name + " (" + this.translateLabel("faction", unit.faction) + ")";
    const subtitle = document.createElement("div");
    subtitle.className = "preview-subtitle";
    subtitle.textContent =
      this.translateLabel("category", unit.category) +
      " | " +
      this.translateLabel("armor", unit.armor);
    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);
    header.appendChild(titleWrap);

    this.selectedUnitPanel.appendChild(header);

    const badges = document.createElement("div");
    badges.className = "badge-row";
    const weaponBadge = document.createElement("div");
    weaponBadge.className = "badge weapon";
    const weaponIcon = document.createElement("img");
    weaponIcon.src = this.getIcon("weapon", unit.weapon);
    const weaponText = document.createElement("span");
    weaponText.textContent = this.translateLabel("weapon", unit.weapon);
    weaponBadge.appendChild(weaponIcon);
    weaponBadge.appendChild(weaponText);
    badges.appendChild(weaponBadge);
    this.selectedUnitPanel.appendChild(badges);

    const stats = [
      "Kategoriýa: " + this.translateLabel("category", unit.category),
      "Gorag: " + this.translateLabel("armor", unit.armor),
      "Ýarag: " + this.translateLabel("weapon", unit.weapon),
      "Aralyk: " + Math.round(unit.range),
      "Görüş: " + Math.round(unit.detection),
      "Hereketlilik: " + unit.mobility.toFixed(1),
      "Ok-däri: " + unit.ammo + "/" + unit.ammoLimit,
      "Basyş: " + Math.round(unit.suppression * 100) + "%"
    ];

    stats.forEach((line) => {
      const row = document.createElement("div");
      row.textContent = line;
      this.selectedUnitPanel.appendChild(row);
    });
  }

  renderAAR(report) {
    this.aarPanel.innerHTML = "";
    if (!report) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "Hereketden soňky hasabat şu ýerde görüner.";
      this.aarPanel.appendChild(empty);
      return;
    }

    const header = document.createElement("div");
    header.textContent = report.outcome;
    header.style.fontWeight = "700";
    this.aarPanel.appendChild(header);

    ["Player", "Enemy"].forEach((side) => {
      const block = document.createElement("div");
      block.style.marginTop = "8px";
      block.textContent =
        this.translateLabel("faction", side) + ": " +
        "Ýitgiler " + report[side].casualties +
        " | Ok-däri sarpy " + report[side].ammoSpent;
      this.aarPanel.appendChild(block);
    });
  }

  renderMeasure(measure) {
    const value =
      measure && measure.start && measure.end
        ? Math.round(measure.distance) + " m"
        : "—";
    if (this.measureHud) {
      this.measureHud.textContent = "ÖLÇEG: " + value;
    }
    if (this.measurePanelValue) {
      this.measurePanelValue.textContent = value;
    }
  }

  updateToolReadout() {
    const label = this.translateLabel("mapTool", this.state.mapTool.type);
    this.toolReadout.textContent = "REJIM: " + label;
  }
}
