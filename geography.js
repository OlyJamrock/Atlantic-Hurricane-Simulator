// geography.js — turns the static LAND_POLYGONS coastline dataset into
// things the sim/renderer actually need: a fast point-in-land test and a
// rasterized land-fraction grid.

import { LAND_POLYGONS } from './land-data.js';
import { GRID } from './constants.js';

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isLandPoint(lon, lat) {
  for (const rings of LAND_POLYGONS) {
    if (!pointInRing(lon, lat, rings[0])) continue;
    let inHole = false;
    for (let i = 1; i < rings.length; i++) {
      if (pointInRing(lon, lat, rings[i])) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

// Rasterize to a land-fraction grid at the sim's resolution, supersampling
// each cell a little so coastal cells get a soft 0..1 fraction instead of
// a hard binary flip (keeps the shoreline weakening-rate transition smooth).
export function rasterizeLandMask() {
  const mask = new Float32Array(GRID.nLat * GRID.nLon);
  const SUB = 2; // 2x2 supersample per cell
  for (let iLat = 0; iLat < GRID.nLat; iLat++) {
    const lat0 = GRID.lat0 + iLat * GRID.res;
    for (let iLon = 0; iLon < GRID.nLon; iLon++) {
      const lon0 = GRID.lon0 + iLon * GRID.res;
      let hits = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const lat = lat0 + ((sy + 0.5) / SUB) * GRID.res;
          const lon = lon0 + ((sx + 0.5) / SUB) * GRID.res;
          if (isLandPoint(lon, lat)) hits++;
        }
      }
      mask[iLat * GRID.nLon + iLon] = hits / (SUB * SUB);
    }
  }
  return mask;
}

export { LAND_POLYGONS };
