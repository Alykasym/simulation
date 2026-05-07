// ============================================================
// REAL-WORLD MILITARY HARDWARE DATABASE
// Based on publicly available specifications of actual equipment
// ============================================================

export const UNIT_CATEGORIES = {
  INFANTRY: "Infantry",
  VEHICLE: "Vehicle", 
  ARTILLERY: "Artillery",
  AIRCRAFT: "Aircraft"
};

export const ARMOR_CLASSES = {
  UNARMORED: "Unarmored",   // Personnel, soft-skinned vehicles
  LIGHT: "Light",           // IFV, APC, recon vehicles
  MEDIUM: "Medium",         // Some MBTs, SPGs
  HEAVY: "Heavy"           // Main Battle Tanks
};

export const WEAPON_TYPES = {
  NONE: "None",
  SMALL_ARMS: "Small Arms",       // 5.56mm, 7.62mm rifles
  HEAVY_MG: "Heavy MG",          // .50 cal, 14.5mm HMGs
  AUTO_CANNON: "Auto Cannon",     // 20-40mm autocannons
  ANTI_ARMOR: "Anti-Armor",      // ATGMs, tank guns, RPGs
  EXPLOSIVE: "Explosive",        // Artillery shells, mortar bombs
  ANTI_AIR: "Anti-Air",          // SAMs, AAA
  COMBINED: "Combined Arms"      // Multiple weapon systems (MBT)
};

export const FIRE_MODES = {
  DIRECT: "Direct Fire",
  INDIRECT: "Indirect Fire",
  STRAIGHT_FIRE: "Straight Fire" // For ATGMs, tank guns
};

// Real-world infantry weapon calibers and types
export const INFANTRY_WEAPONS = {
  AK74: { name: "AK-74 5.45mm", caliber: 5.45, type: "Assault Rifle", apPenetration: 0.15 },
  PKM: { name: "PKM 7.62mm", caliber: 7.62, type: "GPMG", apPenetration: 0.25 },
  NSV: { name: "NSV 12.7mm", caliber: 12.7, type: "HMG", apPenetration: 0.55 },
  RPG7: { name: "RPG-7V", caliber: 40, type: "Rocket Launcher", apPenetration: 1.1 },
  SPG9: { name: "SPG-9 73mm", caliber: 73, type: "Recoilless Rifle", apPenetration: 1.3 },
  KORD: { name: "KORD 12.7mm", caliber: 12.7, type: "HMG", apPenetration: 0.6 },
  AGS17: { name: "AGS-17 30mm", caliber: 30, type: "Auto GL", apPenetration: 0.3 },
  METIS: { name: "9M14 Metis-M", caliber: 130, type: "ATGM", apPenetration: 1.8 },
  KORNET: { name: "9M133 Kornet", caliber: 152, type: "ATGM", apPenetration: 2.4 }
};

// ============================================================
// REAL-WORLD UNIT TEMPLATES
// ============================================================
const baseTemplates = [
  // === INFANTRY UNITS ===
  {
    id: "sniper_team",
    name: "SVD Dragunov Snayper topary",
    designation: "SVD-63 Snayper",
    role: "Snayper awy / Counter-sniper",
    nation: "Russiýa",
    category: UNIT_CATEGORIES.INFANTRY,
    armor: ARMOR_CLASSES.UNARMORED,
    weapon: WEAPON_TYPES.SMALL_ARMS,
    primaryWeapon: INFANTRY_WEAPONS.AK74,
    secondaryWeapon: "SVD Dragunov 7.62x54mm",
    weaponCaliber: "7.62x54mmR",
    range: 600,          // Typical effective engagement 300-600m, max 800m
    detection: 1000,      // with optics/spotter
    mobility: 1.3,
    ammoLimit: 40,
    accuracy: 0.72,       // Trained marksman
    suppressionPower: 0.12,
    size: 12,             // Man-size for drawing
    height: 1.0,
    speed: 3.0,           // km/h tactical speed
    fireInterval: 3.5,    // Bolt action / semi-auto
    usesRoads: false,
    armorPenetration: 0.1, // Cannot penetrate vehicle armor
    camouflage: 0.7,      // Higher = harder to detect
    specialEquipment: "Optical sight PSO-1, radio",
    weakness: "Slow ROF, no armor, no area damage",
    strength: "Excellent accuracy, long range, hard to detect"
  },
  {
    id: "rifle_squad",
    name: "Motosökülen tüpeň topary",
    designation: "MSR (Motosökülen Rotasy)",
    role: "Umumy maksatly pyýada bölümi",
    nation: "Türkmenistan",
    category: UNIT_CATEGORIES.INFANTRY,
    armor: ARMOR_CLASSES.UNARMORED,
    weapon: WEAPON_TYPES.SMALL_ARMS,
    primaryWeapon: INFANTRY_WEAPONS.AK74,
    secondaryWeapon: INFANTRY_WEAPONS.PKM,
    weaponCaliber: "5.45x39mm + 7.62x54mmR",
    range: 500,           // Effective squad range 500m
    detection: 800,
    mobility: 1.4,
    ammoLimit: 80,
    accuracy: 0.38,
    suppressionPower: 0.35,
    size: 14,
    height: 1.0,
    speed: 4.0,
    fireInterval: 1.0,    // Automatic fire
    usesRoads: false,
    armorPenetration: 0.08,
    camouflage: 0.5,
    specialEquipment: "R-142 radio, night vision (limited)",
    weakness: "No armor, vulnerable to suppression",
    strength: "High volume of fire, versatile, can dig in"
  },
  {
    id: "recon_patrol",
    name: "Harby gözegçilik patruly",
    designation: "GRU Spetsnaz Gözegçilik",
    role: "Çuňňur gözleg / desant öňüni görmek",
    nation: "Russiýa",
    category: UNIT_CATEGORIES.INFANTRY,
    armor: ARMOR_CLASSES.UNARMORED,
    weapon: WEAPON_TYPES.SMALL_ARMS,
    primaryWeapon: "AS Val 9x39mm",
    secondaryWeapon: INFANTRY_WEAPONS.PKM,
    weaponCaliber: "9x39mm subsonic",
    range: 650,
    detection: 1800,      // Specialized scouts
    mobility: 1.6,
    ammoLimit: 50,
    accuracy: 0.55,
    suppressionPower: 0.25,
    size: 12,
    height: 1.0,
    speed: 4.5,
    fireInterval: 1.2,
    usesRoads: false,
    armorPenetration: 0.12,
    camouflage: 0.85,     // Very hard to detect
    specialEquipment: "Binoculars 15x, laser rangefinder, satellite radio",
    weakness: "Lightly armed, no AT capability",
    strength: "Extended detection range, stealthy"
  },
  {
    id: "heavy_weapons_team",
    name: "Agyr ýarag topary",
    designation: "PKM + NSV agyr ýarag",
    role: "Pusuda / ýokary atyş güýji",
    nation: "Russiýa",
    category: UNIT_CATEGORIES.INFANTRY,
    armor: ARMOR_CLASSES.UNARMORED,
    weapon: WEAPON_TYPES.HEAVY_MG,
    primaryWeapon: INFANTRY_WEAPONS.NSV,
    secondaryWeapon: INFANTRY_WEAPONS.PKM,
    weaponCaliber: "12.7x108mm + 7.62x54mmR",
    range: 800,           // NSV effective range vs ground targets
    detection: 1000,
    mobility: 0.8,
    ammoLimit: 40,
    accuracy: 0.35,
    suppressionPower: 0.55,
    size: 14,
    height: 1.0,
    speed: 2.0,           // Heavy equipment
    fireInterval: 0.8,    // Machine gun rate of fire
    usesRoads: false,
    armorPenetration: 0.45, // 12.7mm can penetrate light armor
    camouflage: 0.4,
    specialEquipment: "NSV-12.7 tripod, PKM, 1000+ rounds",
    weakness: "Slow to reposition, exposed crew",
    strength: "Devastating suppression, can damage light vehicles"
  },
  {
    id: "combat_engineers",
    name: "Saparçy topary",
    designation: "ISR (Inžener-saparçy rotasy)",
    role: "Ýer partlamalary / barýerler / gurnama",
    nation: "Russiýa",
    category: UNIT_CATEGORIES.INFANTRY,
    armor: ARMOR_CLASSES.UNARMORED,
    weapon: WEAPON_TYPES.EXPLOSIVE,
    primaryWeapon: INFANTRY_WEAPONS.AK74,
    secondaryWeapon: "TM-62 mines, TNT charges",
    weaponCaliber: "5.45mm + explosive charges",
    range: 300,           // Throwing distance for demo charges
    detection: 650,
    mobility: 1.0,
    ammoLimit: 20,
    accuracy: 0.30,
    suppressionPower: 0.7,
    size: 13,
    height: 1.0,
    speed: 3.0,
    fireInterval: 3.0,
    usesRoads: false,
    armorPenetration: 1.5, // Can damage any armor with demo charges
    camouflage: 0.4,
    specialEquipment: "Mine detectors, demo charges, welding gear, chain saw",
    weakness: "Short range, slow fire, limited ammo",
    strength: "Can breach obstacles, demolish buildings, high damage"
  },
  {
    id: "at_team",
    name: "Tanka garşy topary",
    designation: "PTUR (9M133 Kornet)",
    role: "Tank awy / agyr sowutly ýok etmek",
    nation: "Russiýa",
    category: UNIT_CATEGORIES.INFANTRY,
    armor: ARMOR_CLASSES.UNARMORED,
    weapon: WEAPON_TYPES.ANTI_ARMOR,
    primaryWeapon: INFANTRY_WEAPONS.KORNET,
    secondaryWeapon: INFANTRY_WEAPONS.AK74,
    weaponCaliber: "152mm ATGM",
    range: 1000,          // Kornet typical combat engagement range
    detection: 900,
    mobility: 0.8,
    ammoLimit: 8,         // Only a few expensive ATGMs
    accuracy: 0.68,       // SACLOS guided
    suppressionPower: 0.4,
    size: 12,
    height: 1.0,
    speed: 2.5,
    fireInterval: 5.0,    // Reload time
    usesRoads: false,
    armorPenetration: 2.4, // Can destroy any known MBT
    camouflage: 0.6,
    specialEquipment: "Kornet-E launcher, thermal sight, tripod",
    weakness: "Very limited ammo, expensive missiles, exposed during reload",
    strength: "Deadly to ALL armor types, long range, SACLOS guidance"
  },

  // === VEHICLE UNITS ===
  {
    id: "mbt",
    name: "T-90S Esasy söweş tanky",
    designation: "T-90S / T-90MS",
    role: "Agir sowutly tank",
    nation: "Russiýa / Türkmenistan",
    category: UNIT_CATEGORIES.VEHICLE,
    armor: ARMOR_CLASSES.HEAVY,
    weapon: WEAPON_TYPES.COMBINED,
    primaryWeapon: "2A46M 125mm gładkostwolly ýarag",
    secondaryWeapon: "7.62mm PKTM koaksial + 12.7mm KORD zenit",
    weaponCaliber: "125mm HEAT/APFSDS",
    range: 1500,          // Tank gun typical combat engagement range
    detection: 1200,
    mobility: 1.2,
    ammoLimit: 22,        // Ready rounds in carousel
    accuracy: 0.52,       // Stabilized fire control
    suppressionPower: 0.5,
    size: 40,             // Vehicle size
    height: 2.4,          // meters
    speed: 52.0,          // km/h max road speed
    fireInterval: 5.0,    // Autoloader cycle
    usesRoads: true,
    armorPenetration: 2.5, // APFSDS rounds can slice any armor
    camouflage: 0.15,
    specialEquipment: "Shtora-1 jammer, thermal imager, laser rangefinder, gun stabilizer",
    weakness: "Slow turret traverse, vulnerable to top-attack ATGMs, expensive",
    strength: "Excellent armor, deadly gun, NBC protected, auto-loader"
  },
  {
    id: "ifv",
    name: "BMP-2 piýada söweş maşyny",
    designation: "BMP-2 (Boyevaya Mashina Pyekhoty-2)",
    role: "Pyýada daşamak / ýakyn goldaw",
    nation: "Russiýa",
    category: UNIT_CATEGORIES.VEHICLE,
    armor: ARMOR_CLASSES.LIGHT,
    weapon: WEAPON_TYPES.AUTO_CANNON,
    primaryWeapon: "2A42 30mm awtomatiki toppuk",
    secondaryWeapon: "9M113 Konkurs ATGM + 7.62mm PKTM",
    weaponCaliber: "30x165mm + 135mm ATGM",
    range: 800,           // 30mm effective range vs ground targets
    detection: 1000,
    mobility: 1.5,
    ammoLimit: 50,
    accuracy: 0.42,
    suppressionPower: 0.35,
    size: 36,
    height: 2.1,          // meters
    speed: 52.0,
    fireInterval: 1.5,
    usesRoads: true,
    armorPenetration: 0.8, // 30mm can damage light armor
    camouflage: 0.25,
    specialEquipment: "BPK-1 thermal sight, 9M113 Konkurs launcher, NBC",
    weakness: "Light armor, vulnerable to HMG + ATGMs",
    strength: "Mobile, amphibious, carries 7 troops, ATGM capability"
  },
  {
    id: "apc",
    name: "BTR-80 bronli personal daşayjy",
    designation: "BTR-80 (Bronyetransportyor-80)",
    role: "Personal daşamak / patrul",
    nation: "Russiýa",
    category: UNIT_CATEGORIES.VEHICLE,
    armor: ARMOR_CLASSES.LIGHT,
    weapon: WEAPON_TYPES.HEAVY_MG,
    primaryWeapon: "KPVT 14.5mm agyr makinýaly",
    secondaryWeapon: "PKT 7.62mm koaksial",
    weaponCaliber: "14.5x114mm + 7.62x54mmR",
    range: 600,           // HMG effective range vs infantry/light vehicles
    detection: 900,
    mobility: 1.6,
    ammoLimit: 60,
    accuracy: 0.38,
    suppressionPower: 0.35,
    size: 34,
    height: 2.0,
    speed: 60.0,
    fireInterval: 1.5,
    usesRoads: true,
    armorPenetration: 0.55, // 14.5mm can damage light vehicles
    camouflage: 0.2,
    specialEquipment: "10 troops capacity, amphibious, night vision",
    weakness: "Thin armor, no ATGM, vulnerable to RPGs",
    strength: "Fast, amphibious, carries large squad, reliable"
  },
  {
    id: "armored_recon",
    name: "BRDM-2 sowutly gözegçilik",
    designation: "BRDM-2 (Boyevaya Razvedyvatelnaya Dozornaya Mashina-2)",
    role: "Goşun gözleg / desant öňüni görme",
    nation: "Russiýa",
    category: UNIT_CATEGORIES.VEHICLE,
    armor: ARMOR_CLASSES.LIGHT,
    weapon: WEAPON_TYPES.HEAVY_MG,
    primaryWeapon: "KPVT 14.5mm",
    secondaryWeapon: "7.62mm PKT",
    weaponCaliber: "14.5x114mm",
    range: 600,           // HMG effective combat range
    detection: 1600,      // Extended optics for recon
    mobility: 1.7,
    ammoLimit: 45,
    accuracy: 0.40,
    suppressionPower: 0.3,
    size: 32,
    height: 1.9,
    speed: 65.0,
    fireInterval: 1.4,
    usesRoads: true,
    armorPenetration: 0.55,
    camouflage: 0.6,      // Lower profile
    specialEquipment: "Ground surveillance radar, night vision, NBC, 4x4 drive",
    weakness: "Very light armor, no anti-tank weapon",
    strength: "Fast, excellent sensors, low profile, amphibious"
  },
  {
    id: "aa_truck",
    name: "ZSU-23-4 Şilka",
    designation: "ZSU-23-4 Şilka",
    role: "Howa hüjüminden goranmak / alyp baryjy",
    nation: "Russiýa",
    category: UNIT_CATEGORIES.VEHICLE,
    armor: ARMOR_CLASSES.LIGHT,
    weapon: WEAPON_TYPES.ANTI_AIR,
    primaryWeapon: "4x AZP-23 23mm owtomatiki toppuk",
    secondaryWeapon: "None (limited ground capability)",
    weaponCaliber: "23x152mm (4 barrels)",
    range: 1000,          // AAA effective range vs ground targets
    detection: 1500,
    mobility: 1.3,
    ammoLimit: 24,
    accuracy: 0.50,
    suppressionPower: 0.5,
    size: 36,
    height: 2.1,
    speed: 42.0,
    fireInterval: 2.0,
    usesRoads: true,
    armorPenetration: 0.4, // Can engage light ground targets
    camouflage: 0.2,
    specialEquipment: "RPK-2 radar fire control, 4x23mm, 2000 rounds total",
    weakness: "Limited ground effectiveness, radar can be jammed",
    strength: "Devastating anti-air, can suppress infantry, radar guided"
  },
  {
    id: "sam_battery",
    name: "9K37 Buk-M1-2",
    designation: "9K37 Buk-M1-2 SAM",
    role: "Orta aralyk howa hüjüminden goranmak",
    nation: "Russiýa",
    category: UNIT_CATEGORIES.VEHICLE,
    armor: ARMOR_CLASSES.LIGHT,
    weapon: WEAPON_TYPES.ANTI_AIR,
    primaryWeapon: "9M317 SAM raketasy",
    secondaryWeapon: "None",
    weaponCaliber: "9M317 710mm missile",
    range: 42000,         // Max range 42km
    detection: 1600,      // Sensor range on map
    mobility: 0.7,
    ammoLimit: 4,         // Per TELAR
    accuracy: 0.65,
    suppressionPower: 0.3,
    size: 40,
    height: 2.5,
    speed: 35.0,
    fireInterval: 6.0,    // Reload + missile fly time
    usesRoads: true,
    armorPenetration: 0.2,
    camouflage: 0.3,
    specialEquipment: "9S35 radar, IFF, NBC, 4 ready missiles, reload vehicle",
    weakness: "Very limited ammo, vulnerable to SEAD, expensive",
    strength: "Longest range AA, radar guided, can engage multiple targets"
  },

  // === ARTILLERY UNITS ===
  {
    id: "spg",
    name: "2S19 Msta-S özi ýöreýän howitser",
    designation: "2S19 Msta-S 152mm",
    role: "Özi ýöreýän artilleriýa",
    nation: "Russiýa",
    category: UNIT_CATEGORIES.ARTILLERY,
    armor: ARMOR_CLASSES.MEDIUM, // Lightly armored chassis
    weapon: WEAPON_TYPES.EXPLOSIVE,
    primaryWeapon: "2A64 152mm howitser",
    secondaryWeapon: "12.7mm NSV zenit",
    weaponCaliber: "152x620mm",
    range: 2500,          // SPG indirect fire range (reduced for gameplay balance)
    detection: 900,
    mobility: 0.8,
    ammoLimit: 12,
    accuracy: 0.18,       // Area fire only
    suppressionPower: 0.8,
    size: 42,
    height: 2.4,
    speed: 28.0,
    fireInterval: 6.5,    // 8 rounds/min
    usesRoads: true,
    armorPenetration: 0.7, // HEAT rounds can penetrate light armor
    camouflage: 0.15,
    specialEquipment: "1P22 panoramic sight, NBC, auto-loader, 2N59 IR sight",
    weakness: "Inaccurate vs single targets, slow ROF, vulnerable to counter-battery",
    strength: "Massive area damage, long range, high suppression"
  },
  {
    id: "mortar_team",
    name: "2B9 Vasilek 82mm minomýot",
    designation: "2B9 Vasilek 82mm awtomat minomýot",
    role: "Ýakyn goldaw / pusuda atyş",
    nation: "Russiýa",
    category: UNIT_CATEGORIES.ARTILLERY,
    armor: ARMOR_CLASSES.UNARMORED,
    weapon: WEAPON_TYPES.EXPLOSIVE,
    primaryWeapon: "2B9 82mm awtomat minomýot",
    secondaryWeapon: INFANTRY_WEAPONS.AK74,
    weaponCaliber: "82mm mortar",
    range: 800,           // Mortar indirect fire range
    detection: 800,
    mobility: 0.6,
    ammoLimit: 18,
    accuracy: 0.20,
    suppressionPower: 0.7,
    size: 15,
    height: 1.2,
    speed: 2.0,
    fireInterval: 4.0,    // 10 rounds/min automatic
    usesRoads: false,
    armorPenetration: 0.3, // Can damage open-top vehicles
    camouflage: 0.5,
    specialEquipment: "2B9 Vasilek, B82 plates, 120 rounds carried",
    weakness: "Crew exposed, limited range vs tube artillery",
    strength: "High ROF automatic fire, can fire direct/indirect, mobile"
  },
  {
    id: "rocket_artillery",
    name: "BM-21 Grad 122mm MLRS",
    designation: "BM-21 Grad 122mm",
    role: "Köp barrel artilleriýa / meýdany bombalamak",
    nation: "Russiýa",
    category: UNIT_CATEGORIES.ARTILLERY,
    armor: ARMOR_CLASSES.LIGHT,
    weapon: WEAPON_TYPES.EXPLOSIVE,
    primaryWeapon: "40x 122mm raketalar",
    secondaryWeapon: "None",
    weaponCaliber: "122x290mm",
    range: 3000,          // MLRS indirect fire range (reduced for gameplay)
    detection: 1000,
    mobility: 0.7,
    ammoLimit: 8,         // Salvo count (one volley = all rockets)
    accuracy: 0.10,
    suppressionPower: 0.95,
    size: 44,
    height: 2.6,
    speed: 25.0,
    fireInterval: 10.0,   // Reload time
    usesRoads: true,
    armorPenetration: 0.5, // Submunitions can damage vehicles
    camouflage: 0.15,
    specialEquipment: "40 tubes, 122mm rockets, 20km range, single salvo in 20s",
    weakness: "Very inaccurate, must reload completely after salvo, vulnerable during reload",
    strength: "Massive saturation fire, terrifying suppression, area denial"
  },

  // === AIRCRAFT UNITS ===
  {
    id: "attack_drone",
    name: "Bayraktar TB2 hüjüm drony",
    designation: "Bayraktar TB2 (MALE UCAV)",
    role: "Takdy gözegçilik / hüjüm",
    nation: "Türkiýe",
    category: UNIT_CATEGORIES.AIRCRAFT,
    armor: ARMOR_CLASSES.LIGHT,
    weapon: WEAPON_TYPES.EXPLOSIVE,
    primaryWeapon: "2x MAM-L / MAM-C smart bombs",
    secondaryWeapon: "None",
    weaponCaliber: "MAM-L 22kg laser guided",
    range: 800,           // Drone attack altitude/range
    detection: 1800,
    mobility: 2.4,
    ammoLimit: 4,         // 2x dual racks
    accuracy: 0.55,
    suppressionPower: 0.5,
    size: 20,
    height: 5.0,
    speed: 130.0,         // km/h cruise
    fireInterval: 4.0,
    usesRoads: false,
    armorPenetration: 1.2, // MAM-L can penetrate light armor
    camouflage: 0.7,
    specialEquipment: "EO/IR/laser designator, SATCOM, 27hr endurance",
    weakness: "Slow, vulnerable to AA, limited payload, GPS jammable",
    strength: "Long loiter time, persistent surveillance, precision strikes"
  },
  {
    id: "gunship",
    name: "Mi-24P Hind söweş dikuçary",
    designation: "Mi-24P Hind-F",
    role: "Hüjüm dikuçary / howa goldawy",
    nation: "Russiýa",
    category: UNIT_CATEGORIES.AIRCRAFT,
    armor: ARMOR_CLASSES.LIGHT,
    weapon: WEAPON_TYPES.COMBINED,
    primaryWeapon: "30mm 2A42 awtomat toppuk",
    secondaryWeapon: "4x AT-6 Spiral ATGM, S-8 rockets",
    weaponCaliber: "30mm + 130mm ATGM + 80mm S-8",
    range: 1000,          // Gunship attack range
    detection: 1600,
    mobility: 2.2,
    ammoLimit: 18,
    accuracy: 0.48,
    suppressionPower: 0.55,
    size: 24,
    height: 5.5,
    speed: 220.0,         // km/h max
    fireInterval: 2.5,
    usesRoads: false,
    armorPenetration: 1.8, // ATGMs can destroy MBTs
    camouflage: 0.3,
    specialEquipment: "K-041 sight, thermal, 12x 9M114 ATGM, 30mm, rockets",
    weakness: "Vulnerable to MANPADS, large silhouette, maintenance heavy",
    strength: "Heavily armed, troop-carrying capability (8 troops), armored cockpit"
  },
  {
    id: "fighter_jet",
    name: "Su-25SM Frogfoot hüjüm uçary",
    designation: "Su-25SM (Frogfoot-N)",
    role: "Ýakyn howa goldawy (CAS)",
    nation: "Russiýa",
    category: UNIT_CATEGORIES.AIRCRAFT,
    armor: ARMOR_CLASSES.LIGHT,
    weapon: WEAPON_TYPES.COMBINED,
    primaryWeapon: "30mm GSh-30-2 toppuk",
    secondaryWeapon: "S-25 rockets, KAB-500 bombs, Kh-25/29 missiles",
    weaponCaliber: "30mm + 250/500kg bombs + rockets",
    range: 1200,          // Attack jet attack run range
    detection: 2000,
    mobility: 2.6,
    ammoLimit: 10,
    accuracy: 0.45,
    suppressionPower: 0.65,
    size: 22,
    height: 5.8,
    speed: 750.0,
    fireInterval: 3.5,
    usesRoads: false,
    armorPenetration: 1.5, // Can destroy MBTs with missiles/bombs
    camouflage: 0.3,
    specialEquipment: "Klen-PS laser ranger, 10 hardpoints, 44mm titanium cockpit armor",
    weakness: "Limited loiter time, vulnerable to SAMs, high fuel consumption",
    strength: "Heavily armored aircraft, massive payload, hardened for CAS"
  }
];

export const customTemplates = [];
export const placedUnits = [];

let nextUnitId = 1;

export function getBaseTemplates() {
  return baseTemplates.slice();
}

export function getAllTemplates() {
  return baseTemplates.concat(customTemplates);
}

export function findTemplateById(id) {
  let i = 0;
  for (i = 0; i < baseTemplates.length; i += 1) {
    if (baseTemplates[i].id === id) {
      return baseTemplates[i];
    }
  }
  for (i = 0; i < customTemplates.length; i += 1) {
    if (customTemplates[i].id === id) {
      return customTemplates[i];
    }
  }
  return null;
}

export function addCustomTemplate(template) {
  customTemplates.push(template);
}

export function createUnitFromTemplate(template, faction, x, y) {
  const derivedSpeed = template.speed !== undefined ? template.speed : deriveSpeed(template);
  const derivedFireInterval = template.fireInterval !== undefined
    ? template.fireInterval
    : deriveFireInterval(template);
  const derivedUsesRoads = typeof template.usesRoads === "boolean"
    ? template.usesRoads
    : deriveUsesRoads(template);

  const unit = {
    id: "unit_" + nextUnitId,
    templateId: template.id,
    name: template.name,
    designation: template.designation || "",
    role: template.role || "",
    faction: faction,
    category: template.category,
    armor: template.armor,
    weapon: template.weapon,
    primaryWeapon: template.primaryWeapon || "",
    weaponCaliber: template.weaponCaliber || "",
    range: template.range,
    detection: template.detection,
    mobility: template.mobility,
    ammoLimit: template.ammoLimit,
    accuracy: template.accuracy,
    suppressionPower: template.suppressionPower,
    size: template.size,
    height: template.height,
    speed: derivedSpeed,
    fireInterval: derivedFireInterval,
    usesRoads: derivedUsesRoads,
    armorPenetration: template.armorPenetration || 0.1,
    camouflage: template.camouflage || 0.3,
    specialEquipment: template.specialEquipment || "",
    weakness: template.weakness || "",
    strength: template.strength || "",
    x: x,
    y: y,
    heading: 0,
    suppression: 0,
    ammo: template.ammoLimit,
    path: [],
    pathIndex: 0,
    pathTargetId: "",
    pathAge: 0,
    cooldown: Math.random() * derivedFireInterval,
    state: "idle",
    neutralized: false,
    kills: 0,
    ammoSpent: 0
  };
  nextUnitId += 1;
  return unit;
}

function deriveSpeed(template) {
  if (template.category === UNIT_CATEGORIES.INFANTRY) {
    return 1.4 * template.mobility;
  }
  if (template.category === UNIT_CATEGORIES.VEHICLE) {
    return (template.armor === ARMOR_CLASSES.HEAVY ? 11 : 15) * template.mobility;
  }
  if (template.category === UNIT_CATEGORIES.ARTILLERY) {
    return (template.armor === ARMOR_CLASSES.UNARMORED ? 1.2 : 8.5) * template.mobility;
  }
  if (template.category === UNIT_CATEGORIES.AIRCRAFT) {
    return 80 * template.mobility;
  }
  return 4 * template.mobility;
}

function deriveFireInterval(template) {
  if (template.weapon === WEAPON_TYPES.SMALL_ARMS) {
    return 1.1;
  }
  if (template.weapon === WEAPON_TYPES.HEAVY_MG) {
    return 0.7;
  }
  if (template.weapon === WEAPON_TYPES.AUTO_CANNON) {
    return 1.0;
  }
  if (template.weapon === WEAPON_TYPES.ANTI_ARMOR) {
    return 3.5;
  }
  if (template.weapon === WEAPON_TYPES.EXPLOSIVE) {
    if (template.category === UNIT_CATEGORIES.ARTILLERY) {
      return 5.8;
    }
    return 2.4;
  }
  if (template.weapon === WEAPON_TYPES.ANTI_AIR) {
    return template.category === UNIT_CATEGORIES.AIRCRAFT ? 2.2 : 3.6;
  }
  if (template.weapon === WEAPON_TYPES.COMBINED) {
    return 3.2;
  }
  return 4;
}

function deriveUsesRoads(template) {
  if (template.category === UNIT_CATEGORIES.VEHICLE) {
    return true;
  }
  if (template.category === UNIT_CATEGORIES.ARTILLERY && template.armor !== ARMOR_CLASSES.UNARMORED) {
    return true;
  }
  return false;
}

export function syncNextUnitId(units) {
  let maxId = 0;
  for (let i = 0; i < units.length; i += 1) {
    const parts = String(units[i].id).split("_");
    const num = parseInt(parts[1], 10);
    if (!isNaN(num) && num > maxId) {
      maxId = num;
    }
  }
  nextUnitId = maxId + 1;
}