export const MAP_CONFIG = {
  width: 8000,
  height: 6000,
  // Military map styling
  backgroundColor: "#f0e8d0",  // Tan/beige military map background
  contourColorMajor: "#3d2817",  // Dark brown for major contours
  contourColorMinor: "#6b5340",  // Lighter brown for minor contours
  hillShadeColor: "rgba(139, 119, 101, 0.15)",  // Subtle hill shading
  waterColor: "#a8c5d8"  // Light blue for water features
};

export const mapData = {
  hills: [],
  roads: [],
  buildings: [],
  backgroundImage: null,
  topoSeed: 42,  // Fixed seed for consistent default map
  topoVersion: 0,
  navVersion: 0
};