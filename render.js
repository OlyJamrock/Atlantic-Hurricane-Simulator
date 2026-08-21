// render.js — canvas drawing only, no simulation logic.
//
// Color tables for the sst/sstAnomaly/500mb overlays were sampled
// directly from real reference products (REMSS SST, NOAA CRW SST
// anomaly, GFS z500 anomaly via tropicaltidbits/cyclonicwx) rather than
// eyeballed, so they should read as recognizable to anyone used to those
// products.

import { GRID } from './constants.js';
import { classify } from './scale.js';
import { LAND_POLYGONS } from './land-data.js';
import { genesisPotential, formationOdds, TropicalWave } from './waves.js';
import { GENESIS, CAG, STORM as ST, MDR_FEEDBACK as MDRF } from './constants.js';
import { calendarYearOf } from './names.js';

const PALETTE = {
  land: [17, 22, 17],
  landStroke: 'rgba(120, 140, 110, 0.55)',
  grid: 'rgba(216, 230, 238, 0.06)',
  satBase: [6, 14, 22],
};

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function stopColor(stops, v) {
  const a = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], v));
  for (let i = 0; i < stops.length - 1; i++) {
    const [v0, c0] = stops[i], [v1, c1] = stops[i + 1];
    if (a >= v0 && a <= v1) return lerpColor(c0, c1, (a - v0) / (v1 - v0 || 1));
  }
  return stops[stops.length - 1][1];
}

// Banded SST palette — pixel-sampled directly from a ClimateReanalyzer-
// style daily SST product (magenta/purple near-freezing through blue,
// cyan, green, yellow, orange, red, to dark maroon at 30C+).
const SST_STOPS = [
  [0, [94, 2, 92]], [2, [174, 19, 169]], [4, [220, 41, 231]],
  [6, [147, 40, 204]], [8, [92, 40, 178]], [10, [12, 42, 152]],
  [12, [58, 102, 183]], [14, [111, 154, 214]], [16, [153, 206, 243]],
  [18, [138, 205, 217]], [20, [94, 175, 137]], [22, [44, 149, 64]],
  [24, [36, 142, 20]], [26, [116, 179, 58]], [27, [181, 219, 83]],
  [28, [253, 255, 118]], [29, [254, 180, 64]], [30, [249, 106, 18]],
  [31, [217, 37, 9]], [32, [150, 2, 2]], [33, [102, 25, 12]],
];
// Diverging SST-anomaly palette — sampled from the NOAA Coral Reef Watch
// SSTA product colorbar (salmon/brown/red = warm, white = 0, blue/purple
// = cold), values in deg C.
const SST_ANOM_STOPS = [
  [-6.4, [255, 133, 220]], [-5.6, [190, 50, 186]], [-4.5, [81, 0, 101]],
  [-3.5, [32, 70, 138]], [-1.9, [66, 127, 190]], [-0.7, [145, 200, 234]],
  [0, [255, 255, 255]], [0.3, [252, 228, 142]], [1.2, [250, 151, 57]],
  [3.0, [199, 34, 37]], [4.4, [139, 53, 20]], [6.4, [250, 128, 114]],
];
// Same diverging shape reused for 500mb height anomaly, in dam.
const Z500_ANOM_STOPS = SST_ANOM_STOPS;
// 200mb wind-speed palette, sampled from the tropicaltidbits GFS 200mb
// product, truncated to the range our modeled steering flow actually
// reaches (this sim doesn't resolve a full polar jet at 150kt+).
const WIND200_STOPS = [
  [15, [47, 172, 186]], [30, [0, 157, 43]], [45, [255, 221, 82]],
  [60, [255, 109, 41]], [75, [216, 0, 0]], [90, [170, 0, 255]],
];
// Continuous max-wind color scale for forecast spaghetti members —
// matches the convention used by real ensemble track plots (e.g.
// weathernerds.org / ECMWF ensemble), not the Saffir-Simpson category
// colors used elsewhere: gray (weak) -> cyan -> blue -> green -> yellow
// -> orange -> red -> magenta (extreme).
export const FORECAST_WIND_STOPS = [
  [0, [140, 140, 140]], [20, [80, 210, 220]], [30, [50, 110, 230]],
  [40, [60, 180, 70]], [50, [220, 210, 40]], [60, [235, 150, 30]],
  [70, [225, 60, 50]], [80, [215, 40, 150]], [100, [240, 160, 225]],
];
const sstColor = (v) => stopColor(SST_STOPS, v);
const sstAnomColor = (v) => stopColor(SST_ANOM_STOPS, v);
const z500AnomColor = (v) => stopColor(Z500_ANOM_STOPS, v);
const wind200Color = (v) => stopColor(WIND200_STOPS, v);
const forecastWindColor = (v) => stopColor(FORECAST_WIND_STOPS, v);
// MSLP palette, matching real isobar-map convention — deep purple/blue
// for intense lows, through green/yellow for typical tropical MSLP, to
// white/tan for a healthy ridge.
const MSLP_STOPS = [
  [890, [120, 10, 160]], [920, [90, 40, 190]], [950, [40, 90, 210]],
  [980, [50, 150, 190]], [1000, [70, 170, 120]], [1010, [160, 200, 90]],
  [1013, [230, 220, 130]], [1018, [235, 200, 160]], [1025, [245, 235, 220]],
];
const mslpColor = (v) => stopColor(MSLP_STOPS, v);

// Maximum Potential Intensity palette, matching the standard TD/TS/H1-H5
// "potential maximum wind" product convention.
const MPI_STOPS = [
  [20, [90, 130, 150]], [34, [150, 200, 130]], [64, [255, 200, 60]],
  [84, [255, 130, 30]], [97, [230, 30, 40]], [114, [230, 30, 150]],
  [135, [180, 60, 230]], [150, [70, 60, 220]], [165, [15, 15, 110]],
];
const mpiColor = (v) => stopColor(MPI_STOPS, v);
// Same simplified thermodynamic MPI relationship storm.js uses, applied
// per grid cell for the overlay — deliberately the exact same formula so
// the map is honestly showing what storms are actually calibrated against.
const mpiKtFromSst = (sst) => ST.mpiCoeffKt * Math.sqrt(Math.max(0, sst - ST.mpiSstRef)) * 0.55;

// Velocity potential / 200mb divergence proxy — teal (rising/divergent
// aloft) through cream (near-zero) to orange/brown (sinking/convergent
// aloft), matching the standard "velocity potential anomaly" product
// convention.
const VELPOT_STOPS = [
  [-6, [10, 40, 60]], [-3, [20, 90, 100]], [-1, [110, 170, 160]],
  [0, [245, 238, 224]], [1, [225, 175, 120]], [3, [190, 110, 40]], [6, [110, 55, 15]],
];
const velpotColor = (v) => stopColor(VELPOT_STOPS, v);
const idxRC = (iLat, iLon) => iLat * GRID.nLon + iLon;

// Velocity potential is properly the inverse-Laplacian of wind
// divergence (an elliptic PDE solve) — not something worth doing in a
// real-time browser sim. This computes the raw divergence of the 200mb
// wind field via central differences instead, which is a defensible,
// much cheaper proxy for the same physical story (positive = air
// spreading out aloft = rising motion below; negative = air converging
// aloft = sinking motion below) without claiming to be the literal
// integrated field a real meteorological product would show.
function computeDivergenceField(env) {
  const div = new Float32Array(env.upperWindU.length);
  for (let iLat = 1; iLat < GRID.nLat - 1; iLat++) {
    for (let iLon = 1; iLon < GRID.nLon - 1; iLon++) {
      const dUdLon = env.upperWindU[idxRC(iLat, iLon + 1)] - env.upperWindU[idxRC(iLat, iLon - 1)];
      const dVdLat = env.upperWindV[idxRC(iLat + 1, iLon)] - env.upperWindV[idxRC(iLat - 1, iLon)];
      div[idxRC(iLat, iLon)] = (dUdLon + dVdLat) * 0.09; // scaled to a roughly -6..+6 display range
    }
  }
  return div;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.overlay = 'sst';
    this.showPastTracks = true;
    this.showOutlook = false;
    this.showForecast = false;
    this.showForecastCone = false;
    this.showForecastSpaghetti = false;
    this.showSwath = false;
    this.showCagZone = true;
    this.showFronts = true;
    this.showItcz = true;
    this.showMonsoonTrough = true;
    this.showMapWind = true;
    this.showMapPressure = true;
    this.shearBrush = null;

    // Pan/zoom view window, in degrees — starts at the full basin extent.
    this.view = { lon0: GRID.lon0, lon1: GRID.lon1, lat0: GRID.lat0, lat1: GRID.defaultViewLat1 };
  }

  // Fills the available space directly (no blank margins) — but that
  // doesn't require cramming the entire grid into one view. Instead of
  // choosing between "fill the box" and "no stretch," this lets what
  // portion of the map is shown adapt to whatever the container's real
  // aspect ratio is: the longitude range and southern edge stay fixed at
  // their configured defaults, and the northern edge is solved (using
  // the same Mercator math as the projection itself) so that filling
  // the container exactly produces zero distortion — not a fixed crop
  // forced into a mismatched box, and not a fixed-aspect box with empty
  // margins around it either.
  resize() {
    const viewport = this.canvas.parentElement;
    const container = (viewport && viewport.parentElement
      ? viewport.parentElement
      : this.canvas.parentElement
    ).getBoundingClientRect();
    const width = container.width, height = container.height;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    if (viewport && viewport.id === 'mapViewport') {
      viewport.style.width = `${width}px`;
      viewport.style.height = `${height}px`;
    }
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = width;
    this.cssH = height;
    this._fitViewToContainer();
  }

  // --- view / zoom / pan ---
  // Web Mercator-style latitude projection: at high latitude, a naive
  // linear (equirectangular) lat-to-pixel mapping visibly over-stretches
  // landmasses/features horizontally relative to how they actually look
  // on a real map — this is what was making the expanded (0-70N) map
  // look "stretched" compared to a normal satellite/web map view.
  // Longitude stays linear (Mercator doesn't distort that).
  _mercY(latDeg) {
    const latRad = Math.max(-85, Math.min(85, latDeg)) * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  }
  _mercYInv(my) {
    return (2 * (Math.atan(Math.exp(my)) - Math.PI / 4)) * 180 / Math.PI;
  }

  // Fits this.view to the container's actual aspect ratio by cropping
  // *which portion* of the map is shown (not squishing what's shown) —
  // crops latitude (shows a shorter north-south slice, keeping the same
  // center) when the container is proportionally wider than the current
  // view, or crops longitude when it's narrower/taller, clamped to the
  // grid bounds. Called explicitly at resize/reset time and mutates
  // this.view directly — deliberately NOT re-derived on every coordinate
  // lookup (an earlier version did that, and it caused exactly the
  // "mutates while panning" bug this fixes: zoomAt/panByCss calibrate
  // their sensitivity off this.view's own span, so if the rendered
  // extent were silently different from this.view on every frame, drag
  // distance and visual movement would disagree and panning would feel
  // jerky/inconsistent, worst wherever the crop had to work hardest).
  // With this.view itself always being the correct, stable extent, pan
  // and zoom — which both already preserve aspect ratio (zoom scales
  // both axes by the same factor; pan only shifts, never resizes) — just
  // work correctly with no further adjustment needed after this runs.
  _fitViewToContainer() {
    if (!this.cssW || !this.cssH || !this.view) return;
    const v = this.view;
    const containerAspect = this.cssW / this.cssH;
    const latSpanMerc = this._mercY(v.lat1) - this._mercY(v.lat0);
    const lonSpanRad = (v.lon1 - v.lon0) * Math.PI / 180;
    const viewAspect = lonSpanRad / latSpanMerc;
    if (Math.abs(viewAspect - containerAspect) < 0.002) return;

    if (containerAspect > viewAspect) {
      const neededLatSpanMerc = lonSpanRad / containerAspect;
      const mercCenter = (this._mercY(v.lat0) + this._mercY(v.lat1)) / 2;
      let lat0 = this._mercYInv(mercCenter - neededLatSpanMerc / 2);
      let lat1 = this._mercYInv(mercCenter + neededLatSpanMerc / 2);
      if (lat0 < GRID.lat0) { lat1 += GRID.lat0 - lat0; lat0 = GRID.lat0; }
      if (lat1 > GRID.lat1) { lat0 -= lat1 - GRID.lat1; lat1 = GRID.lat1; }
      this.view.lat0 = Math.max(GRID.lat0, lat0);
      this.view.lat1 = Math.min(GRID.lat1, lat1);
    } else {
      const neededLonSpanDeg = latSpanMerc * containerAspect * 180 / Math.PI;
      const lonCenter = (v.lon0 + v.lon1) / 2;
      let lon0 = lonCenter - neededLonSpanDeg / 2;
      let lon1 = lonCenter + neededLonSpanDeg / 2;
      if (lon0 < GRID.lon0) { lon1 += GRID.lon0 - lon0; lon0 = GRID.lon0; }
      if (lon1 > GRID.lon1) { lon0 -= lon1 - GRID.lon1; lon1 = GRID.lon1; }
      this.view.lon0 = Math.max(GRID.lon0, lon0);
      this.view.lon1 = Math.min(GRID.lon1, lon1);
    }
  }

  latToY(lat) {
    const y0 = this._mercY(this.view.lat0), y1 = this._mercY(this.view.lat1);
    return this.cssH - (this._mercY(lat) - y0) / (y1 - y0) * this.cssH;
  }
  yToLat(y) {
    const y0 = this._mercY(this.view.lat0), y1 = this._mercY(this.view.lat1);
    const my = y0 + (1 - y / this.cssH) * (y1 - y0);
    return this._mercYInv(my);
  }
  lonToX(lon) {
    return (lon - this.view.lon0) / (this.view.lon1 - this.view.lon0) * this.cssW;
  }
  xToLon(x) {
    return this.view.lon0 + (x / this.cssW) * (this.view.lon1 - this.view.lon0);
  }

  resetView() {
    this.view = { lon0: GRID.lon0, lon1: GRID.lon1, lat0: GRID.lat0, lat1: GRID.defaultViewLat1 };
    this.resize();
  }

  zoomAt(cssX, cssY, factor) {
    const focusLon = this.xToLon(cssX), focusLat = this.yToLat(cssY);
    const fullSpanLon = GRID.lon1 - GRID.lon0, fullSpanLat = GRID.lat1 - GRID.lat0;
    let spanLon = (this.view.lon1 - this.view.lon0) * factor;
    let spanLat = (this.view.lat1 - this.view.lat0) * factor;
    spanLon = Math.max(fullSpanLon * 0.04, Math.min(fullSpanLon, spanLon));
    spanLat = Math.max(fullSpanLat * 0.04, Math.min(fullSpanLat, spanLat));
    const fx = (focusLon - this.view.lon0) / (this.view.lon1 - this.view.lon0);
    const fy = (focusLat - this.view.lat0) / (this.view.lat1 - this.view.lat0);
    let lon0 = focusLon - fx * spanLon, lon1 = lon0 + spanLon;
    let lat0 = focusLat - fy * spanLat, lat1 = lat0 + spanLat;
    this._clampView({ lon0, lon1, lat0, lat1 });
  }

  panByCss(dxCss, dyCss) {
    const spanLon = this.view.lon1 - this.view.lon0, spanLat = this.view.lat1 - this.view.lat0;
    const dLon = -(dxCss / this.cssW) * spanLon;
    const dLat = (dyCss / this.cssH) * spanLat;
    this._clampView({
      lon0: this.view.lon0 + dLon, lon1: this.view.lon1 + dLon,
      lat0: this.view.lat0 + dLat, lat1: this.view.lat1 + dLat,
    });
  }

  _clampView(v) {
    const fullSpanLon = GRID.lon1 - GRID.lon0, fullSpanLat = GRID.lat1 - GRID.lat0;
    let { lon0, lon1, lat0, lat1 } = v;
    const spanLon = lon1 - lon0, spanLat = lat1 - lat0;
    if (lon0 < GRID.lon0) { lon0 = GRID.lon0; lon1 = lon0 + spanLon; }
    if (lon1 > GRID.lon1) { lon1 = GRID.lon1; lon0 = lon1 - spanLon; }
    if (lat0 < GRID.lat0) { lat0 = GRID.lat0; lat1 = lat0 + spanLat; }
    if (lat1 > GRID.lat1) { lat1 = GRID.lat1; lat0 = lat1 - spanLat; }
    this.view = { lon0, lon1, lat0, lat1 };
  }

  lonOfIdx(iLon) { return GRID.lon0 + iLon * GRID.res; }
  latOfIdx(iLat) { return GRID.lat0 + iLat * GRID.res; }

  // Ocean field as a low-res raster (cheap), cropped to the current view
  // and scaled up to fill the canvas — this is what makes zoom work
  // without re-rendering the field at higher resolution.
  // Builds a "what would actually show up on an isobar map" MSLP field
  // for display purposes — starts from the simulated background/ambient
  // pressure (env.bgPressureMb, already used for the real wind-pressure
  // gradient physics) and layers on top of it: each active storm's own
  // circulation (a radial profile from its actual central pressure out
  // to the local background, tighter and deeper for stronger/smaller
  // storms — this is what makes an intense hurricane show up as a
  // small, tightly-packed knot of isobars rather than a vague dip), and
  // a much shallower, smaller perturbation at each tropical wave's
  // position (a "kink" in the isobars, not a closed low — waves aren't
  // organized circulations yet). This is purely a rendering-time
  // construction; it doesn't feed back into the actual physics, which
  // already uses env.bgPressureMb and each storm's real pressureMb
  // directly.
  _computeMslpDisplayField(world) {
    const field = Float32Array.from(world.env.bgPressureMb);
    const w = GRID.nLon, h = GRID.nLat;

    for (const storm of world.storms) {
      // Radius of influence scales with the storm's own size (already
      // tracked via r34Km) — a broad storm's circulation dents the
      // isobars over a wide area; a compact one only locally, but more
      // sharply.
      const radiusDeg = Math.max(2.5, (storm.r34Km / 111) * 1.4);
      const latSpan = Math.ceil(radiusDeg / GRID.res);
      const iLatC = Math.round((storm.lat - GRID.lat0) / GRID.res);
      const iLonC = Math.round((storm.lon - GRID.lon0) / GRID.res);
      for (let dLatI = -latSpan; dLatI <= latSpan; dLatI++) {
        const iLat = iLatC + dLatI;
        if (iLat < 0 || iLat >= h) continue;
        const lonSpan = Math.ceil(latSpan / Math.max(0.2, Math.cos(storm.lat * Math.PI / 180)));
        for (let dLonI = -lonSpan; dLonI <= lonSpan; dLonI++) {
          const iLon = iLonC + dLonI;
          if (iLon < 0 || iLon >= w) continue;
          const lat = GRID.lat0 + iLat * GRID.res, lon = GRID.lon0 + iLon * GRID.res;
          const dist = Math.hypot(lat - storm.lat, (lon - storm.lon) * Math.cos(storm.lat * Math.PI / 180));
          if (dist > radiusDeg) continue;
          const idx = iLat * w + iLon;
          const t = Math.exp(-Math.pow(dist / (radiusDeg * 0.42), 1.6));
          const blended = field[idx] * (1 - t) + storm.pressureMb * t;
          field[idx] = Math.min(field[idx], blended);
        }
      }
    }

    for (const wave of world.waveSource.waves) {
      if (wave.spawned) continue;
      const radiusDeg = 3.5;
      const kinkDepthMb = 4; // shallow — a bend in the isobars, not a closed low
      const latSpan = Math.ceil(radiusDeg / GRID.res);
      const iLatC = Math.round((wave.lat - GRID.lat0) / GRID.res);
      const iLonC = Math.round((wave.lon - GRID.lon0) / GRID.res);
      for (let dLatI = -latSpan; dLatI <= latSpan; dLatI++) {
        const iLat = iLatC + dLatI;
        if (iLat < 0 || iLat >= h) continue;
        for (let dLonI = -latSpan; dLonI <= latSpan; dLonI++) {
          const iLon = iLonC + dLonI;
          if (iLon < 0 || iLon >= w) continue;
          const lat = GRID.lat0 + iLat * GRID.res, lon = GRID.lon0 + iLon * GRID.res;
          const dist = Math.hypot(lat - wave.lat, (lon - wave.lon) * Math.cos(wave.lat * Math.PI / 180));
          if (dist > radiusDeg) continue;
          const idx = iLat * w + iLon;
          const dip = kinkDepthMb * Math.exp(-Math.pow(dist / (radiusDeg * 0.55), 2));
          field[idx] -= dip;
        }
      }
    }

    return field;
  }

  drawOceanField(env) {
    const { ctx } = this;
    const w = GRID.nLon, h = GRID.nLat;
    const img = ctx.createImageData(w, h);
    for (let iLat = 0; iLat < h; iLat++) {
      for (let iLon = 0; iLon < w; iLon++) {
        const i = iLat * w + iLon;
        let rgb;
        if (this.overlay === 'sst') rgb = sstColor(env.sst[i]);
        else if (this.overlay === 'mdrsst') rgb = sstColor(env.sst[i]);
        else if (this.overlay === 'sstAnomaly') rgb = sstAnomColor(env.sst[i] - env.sstNormal[i]);
        else if (this.overlay === 'humidity') rgb = lerpColor([120, 90, 50], [30, 130, 150], 1 - env.dryAir[i]);
        else if (this.overlay === '200mb') rgb = wind200Color(Math.hypot(env.upperWindU[i], env.upperWindV[i]));
        else if (this.overlay === '500mb') rgb = z500AnomColor(env.upperHeight[i] * 5.5); // pseudo-dam scale
        else if (this.overlay === 'mpi') rgb = env.landMask[i] > 0.5 ? PALETTE.satBase : mpiColor(mpiKtFromSst(env.sst[i]));
        else if (this.overlay === 'steering') rgb = PALETTE.satBase;
        else if (this.overlay === 'velpot') rgb = this._divergenceField ? velpotColor(this._divergenceField[i]) : velpotColor(0);
        else if (this.overlay === 'mslp') rgb = this._mslpDisplayField ? mslpColor(this._mslpDisplayField[i]) : mslpColor(1013);
        else rgb = PALETTE.satBase; // shear + outlook use a dark satellite-style base
        const row = h - 1 - iLat;
        const p = (row * w + iLon) * 4;
        img.data[p] = rgb[0]; img.data[p + 1] = rgb[1]; img.data[p + 2] = rgb[2]; img.data[p + 3] = 255;
      }
    }
    if (!this._off) this._off = document.createElement('canvas');
    this._off.width = w; this._off.height = h;
    this._off.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;

    // Longitude crop is a simple linear scale (Mercator doesn't distort
    // that axis). Latitude is NOT linear — draw the field in per-degree
    // horizontal strips, each positioned via the same Mercator formula
    // latToY uses, so the colored field lines up exactly with land
    // polygons/markers/graticule instead of a single uniform stretch
    // silently mismatching them.
    const sx = ((this.view.lon0 - GRID.lon0) / (GRID.lon1 - GRID.lon0)) * w;
    const sw = ((this.view.lon1 - this.view.lon0) / (GRID.lon1 - GRID.lon0)) * w;
    const latTop = Math.min(GRID.lat1, Math.ceil(this.view.lat1));
    const latBottom = Math.max(GRID.lat0, Math.floor(this.view.lat0));
    for (let lat = latTop; lat > latBottom; lat--) {
      const iLatRow = GRID.nLat - 1 - Math.round(lat - GRID.lat0); // row index in the flipped source image
      const yTop = this.latToY(lat);
      const yBottom = this.latToY(lat - 1);
      if (yBottom <= yTop) continue;
      ctx.drawImage(this._off, sx, iLatRow, sw, 1, 0, yTop, this.cssW, yBottom - yTop);
    }
  }

  drawLand() {
    const { ctx } = this;
    ctx.fillStyle = `rgb(${PALETTE.land.join(',')})`;
    ctx.strokeStyle = PALETTE.landStroke;
    ctx.lineWidth = 1;
    for (const rings of LAND_POLYGONS) {
      ctx.beginPath();
      for (const ring of rings) {
        ring.forEach(([lon, lat], i) => {
          const x = this.lonToX(lon), y = this.latToY(lat);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      ctx.fill('evenodd');
      ctx.stroke();
    }
  }

  drawGraticule() {
    const { ctx } = this;
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 1;
    for (let lat = 0; lat <= GRID.lat1; lat += 10) {
      const y = this.latToY(lat);
      if (y < -5 || y > this.cssH + 5) continue;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.cssW, y); ctx.stroke();
    }
    for (let lon = GRID.lon0; lon <= GRID.lon1; lon += 10) {
      const x = this.lonToX(lon);
      if (x < -5 || x > this.cssW + 5) continue;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.cssH); ctx.stroke();
    }
  }

  // Proper marching-squares contours: for each cell, find where the field
  // crosses `level` along each of the 4 edges (linearly interpolated),
  // then connect the crossing points — this produces continuous,
  // correctly-positioned isopleths instead of the coarse "line through
  // cell center" approximation.
  drawContours(field, levels, strokeStyle) {
    const { ctx } = this;
    const w = GRID.nLon, h = GRID.nLat;
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    for (const level of levels) {
      for (let iLat = 0; iLat < h - 1; iLat++) {
        for (let iLon = 0; iLon < w - 1; iLon++) {
          const v00 = field[iLat * w + iLon];         // bottom-left
          const v10 = field[iLat * w + iLon + 1];      // bottom-right
          const v01 = field[(iLat + 1) * w + iLon];    // top-left
          const v11 = field[(iLat + 1) * w + iLon + 1]; // top-right

          const lonA = this.lonOfIdx(iLon), lonB = this.lonOfIdx(iLon + 1);
          const latA = this.latOfIdx(iLat), latB = this.latOfIdx(iLat + 1);
          const xA = this.lonToX(lonA), xB = this.lonToX(lonB);
          const yA = this.latToY(latA), yB = this.latToY(latB);

          const pts = [];
          // bottom edge (v00 -> v10)
          if ((v00 >= level) !== (v10 >= level)) {
            const t = (level - v00) / (v10 - v00 || 1e-6);
            pts.push([xA + (xB - xA) * t, yA]);
          }
          // right edge (v10 -> v11)
          if ((v10 >= level) !== (v11 >= level)) {
            const t = (level - v10) / (v11 - v10 || 1e-6);
            pts.push([xB, yA + (yB - yA) * t]);
          }
          // top edge (v01 -> v11)
          if ((v01 >= level) !== (v11 >= level)) {
            const t = (level - v01) / (v11 - v01 || 1e-6);
            pts.push([xA + (xB - xA) * t, yB]);
          }
          // left edge (v00 -> v01)
          if ((v00 >= level) !== (v01 >= level)) {
            const t = (level - v00) / (v01 - v00 || 1e-6);
            pts.push([xA, yA + (yB - yA) * t]);
          }

          if (pts.length === 2) {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            ctx.lineTo(pts[1][0], pts[1][1]);
            ctx.stroke();
          } else if (pts.length === 4) {
            // saddle case: connect in two pairs (visually acceptable
            // approximation rather than resolving true saddle ambiguity)
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]);
            ctx.moveTo(pts[2][0], pts[2][1]); ctx.lineTo(pts[3][0], pts[3][1]);
            ctx.stroke();
          }
        }
      }
    }
  }

  // Shear overlay, CIMSS-style: colored threshold contours (green
  // favorable <15kt, yellow neutral 15-20kt, red unfavorable 20kt+) over
  // a dark satellite-style base, plus streamline-style vector arrows.
  drawShearThresholds(env) {
    this.drawContours(env.shear, [15], 'rgba(90, 220, 110, 0.85)');
    this.drawContours(env.shear, [20], 'rgba(230, 220, 60, 0.85)');
    this.drawContours(env.shear, [25], 'rgba(255, 150, 40, 0.85)');
    this.drawContours(env.shear, [35], 'rgba(255, 70, 70, 0.9)');
  }

  drawVectorField(uField, vField, magForColor, env, colorFn, step = 4, offsetPx = null) {
    const { ctx } = this;
    for (let iLat = 1; iLat < GRID.nLat - 1; iLat += step) {
      for (let iLon = 1; iLon < GRID.nLon - 1; iLon += step) {
        const i = iLat * GRID.nLon + iLon;
        if (env.landMask[i] > 0.5) continue;
        const lat = this.latOfIdx(iLat), lon = this.lonOfIdx(iLon);
        if (lon < this.view.lon0 || lon > this.view.lon1 || lat < this.view.lat0 || lat > this.view.lat1) continue;
        const x = this.lonToX(lon) + (offsetPx ? offsetPx.x : 0), y = this.latToY(lat) + (offsetPx ? offsetPx.y : 0);
        const u = uField[i], v = vField[i];
        const mag = Math.hypot(u, v);
        const lenPx = Math.min(22, 4 + mag * 0.5);
        const ang = Math.atan2(-v, u);
        const dx = Math.cos(ang) * lenPx, dy = Math.sin(ang) * lenPx;
        const color = colorFn ? colorFn(magForColor ? magForColor[i] : mag) : [232, 237, 242];
        ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},0.8)`;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x - dx / 2, y - dy / 2);
        ctx.lineTo(x + dx / 2, y + dy / 2);
        ctx.stroke();
        const ah = 3.5;
        const b1 = ang + Math.PI - 0.4, b2 = ang + Math.PI + 0.4;
        ctx.beginPath();
        ctx.moveTo(x + dx / 2, y + dy / 2);
        ctx.lineTo(x + dx / 2 + Math.cos(b1) * ah, y + dy / 2 + Math.sin(b1) * ah);
        ctx.lineTo(x + dx / 2 + Math.cos(b2) * ah, y + dy / 2 + Math.sin(b2) * ah);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // Bilinear-sampled wind field lookup at an arbitrary (non-grid-aligned)
  // lat/lon — needed for streamline tracing, since each traced step lands
  // between grid points, not exactly on one.
  _sampleFieldBilinear(uField, vField, env, lat, lon) {
    const fLat = (lat - GRID.lat0) / GRID.res;
    const fLon = (lon - GRID.lon0) / GRID.res;
    const iLat0 = Math.max(0, Math.min(GRID.nLat - 2, Math.floor(fLat)));
    const iLon0 = Math.max(0, Math.min(GRID.nLon - 2, Math.floor(fLon)));
    const tLat = fLat - iLat0, tLon = fLon - iLon0;
    const i00 = iLat0 * GRID.nLon + iLon0, i10 = i00 + 1;
    const i01 = i00 + GRID.nLon, i11 = i01 + 1;
    const lerp2 = (f, a, b, c, d) =>
      (f[a] * (1 - tLon) + f[b] * tLon) * (1 - tLat) + (f[c] * (1 - tLon) + f[d] * tLon) * tLat;
    return {
      u: lerp2(uField, i00, i10, i01, i11),
      v: lerp2(vField, i00, i10, i01, i11),
      land: lerp2(env.landMask, i00, i10, i01, i11),
    };
  }

  // Traces genuine streamlines through the 200mb wind field instead of
  // discrete arrows — much clearer for seeing outflow channels, TUTT/ULL
  // circulation, and the general large-scale flow pattern at a glance,
  // the way a real upper-air streamline chart does. Seeds a spaced grid
  // of starting points across the visible view, integrates forward along
  // the local (bilinear-sampled) wind vector a fixed number of steps,
  // and draws each traced path with a directional fade and a small
  // arrowhead at the end.
  drawStreamlines(uField, vField, env, colorFn, seedSpacingPx = 70, steps = 32) {
    const { ctx } = this;
    const stepDeg = 0.55; // integration step size, in degrees per step (tuned for visual smoothness, not physical time)
    for (let sy = 30; sy < this.cssH; sy += seedSpacingPx) {
      for (let sx = 30; sx < this.cssW; sx += seedSpacingPx) {
        let lat = this.yToLat(sy), lon = this.xToLon(sx);
        if (lat < this.view.lat0 || lat > this.view.lat1 || lon < this.view.lon0 || lon > this.view.lon1) continue;
        const seedSample = this._sampleFieldBilinear(uField, vField, env, lat, lon);
        if (seedSample.land > 0.5) continue;
        const pts = [[lat, lon]];
        let totalMag = 0;
        for (let s = 0; s < steps; s++) {
          const { u, v, land } = this._sampleFieldBilinear(uField, vField, env, lat, lon);
          const mag = Math.hypot(u, v);
          if (mag < 0.5 || land > 0.5) break;
          totalMag += mag;
          // Convert the wind vector (kt-ish units) into a normalized
          // step direction — magnitude affects speed of advection along
          // the line (faster flow = longer strides), not just direction.
          const stepScale = Math.min(1.6, 0.4 + mag / 60) * stepDeg;
          lon += (u / mag) * stepScale;
          lat += (v / mag) * stepScale;
          if (lat < GRID.lat0 || lat > GRID.lat1 || lon < GRID.lon0 || lon > GRID.lon1) break;
          pts.push([lat, lon]);
        }
        if (pts.length < 4) continue;
        const avgMag = totalMag / (pts.length - 1);
        const color = colorFn ? colorFn(avgMag) : [232, 237, 242];
        for (let i = 1; i < pts.length; i++) {
          const [lat1, lon1] = pts[i - 1], [lat2, lon2] = pts[i];
          const x1 = this.lonToX(lon1), y1 = this.latToY(lat1);
          const x2 = this.lonToX(lon2), y2 = this.latToY(lat2);
          const alpha = 0.15 + 0.55 * (i / pts.length); // fades in from the seed, brightest near the arrow end
          ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha.toFixed(2)})`;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        // Arrowhead at the traced end, showing flow direction.
        const [lastLat, lastLon] = pts[pts.length - 1];
        const [prevLat, prevLon] = pts[pts.length - 2];
        const ex = this.lonToX(lastLon), ey = this.latToY(lastLat);
        const px = this.lonToX(prevLon), py = this.latToY(prevLat);
        const ang = Math.atan2(ey - py, ex - px);
        const ah = 4;
        ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},0.85)`;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(ang - 0.4) * ah, ey - Math.sin(ang - 0.4) * ah);
        ctx.lineTo(ex - Math.cos(ang + 0.4) * ah, ey - Math.sin(ang + 0.4) * ah);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // Stylized frontal boundary: a scalloped/triangular line trailing
  // southwest from each trough's axis, in the classic cold-front
  // convention — gives troughs a recognizable "front" identity on the
  // map instead of just an "L" label, and doubles as a visual cue for
  // where a weak non-tropical low near that boundary could seed
  // subtropical/CAG-style genesis.
  // Stylized frontal boundary trailing from each *extratropical low's*
  // axis (not a bare upper trough — fronts are surface features tied to
  // surface lows in reality) using real meteorological symbology —
  // alternating solid triangles (cold-front side) and solid semicircles
  // (warm-front side) along the line, the standard "stationary front"
  // convention.
  drawFrontalBoundaries(env) {
    const { ctx } = this;
    for (const t of env.extratropicalLows || []) {
      if (t.lon < this.view.lon0 - 8 || t.lon > this.view.lon1 + 8) continue;
      const segLenDeg = 3.2;
      const nSegs = 7;
      // Trails southeast from the trough axis, toward the subtropics —
      // matching how a real front actually drapes off a mid-latitude low
      // toward the Gulf/Florida/Bahamas, where it can actually interact
      // with a tropical cyclone. (Previous version used an angle that put
      // it northwest of the trough — the wrong direction entirely.)
      const angle = -1.3; // radians: mostly south, slightly east
      let px = t.lon, py = t.lat;
      const pts = [[px, py]];
      for (let s = 0; s < nSegs; s++) {
        px += Math.cos(angle) * segLenDeg;
        py += Math.sin(angle) * segLenDeg * 0.6;
        pts.push([px, py]);
      }
      // Project to screen space once, then work entirely in pixels —
      // symbol size/spacing needs to stay visually consistent regardless
      // of the lat/lon-to-pixel scale at the current zoom level.
      const screenPts = pts.map(([lon, lat]) => [this.lonToX(lon), this.latToY(lat)]);

      ctx.beginPath();
      ctx.strokeStyle = 'rgba(232, 237, 242, 0.85)';
      ctx.lineWidth = 1.6;
      screenPts.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.stroke();

      const symbolSpacingPx = 15;
      // Build cumulative arc length along the projected path, then place
      // symbols at fixed pixel intervals by walking that list — simpler
      // and more robust than trying to track spacing mid-segment.
      const cumLen = [0];
      for (let s = 0; s < screenPts.length - 1; s++) {
        const [x1, y1] = screenPts[s], [x2, y2] = screenPts[s + 1];
        cumLen.push(cumLen[s] + Math.hypot(x2 - x1, y2 - y1));
      }
      const totalLen = cumLen[cumLen.length - 1];
      let symbolIdx = 0;
      for (let d = symbolSpacingPx / 2; d < totalLen; d += symbolSpacingPx) {
        // find which segment this distance falls in
        let segIdx = 0;
        while (segIdx < cumLen.length - 2 && cumLen[segIdx + 1] < d) segIdx++;
        const [x1, y1] = screenPts[segIdx], [x2, y2] = screenPts[segIdx + 1];
        const segLen = cumLen[segIdx + 1] - cumLen[segIdx] || 1;
        const t = (d - cumLen[segIdx]) / segLen;
        const px2 = x1 + (x2 - x1) * t, py2 = y1 + (y2 - y1) * t;
        const ux = (x2 - x1) / segLen, uy = (y2 - y1) / segLen;
        const nx = -uy, ny = ux;

        const side = symbolIdx % 2 === 0 ? 1 : -1;
        if (side === 1) {
          // solid triangle (cold-front convention), pointing away from the line
          const tipX = px2 + nx * 8, tipY = py2 + ny * 8;
          const baseHalf = 4;
          ctx.beginPath();
          ctx.moveTo(px2 - ux * baseHalf, py2 - uy * baseHalf);
          ctx.lineTo(px2 + ux * baseHalf, py2 + uy * baseHalf);
          ctx.lineTo(tipX, tipY);
          ctx.closePath();
          ctx.fillStyle = 'rgba(94, 225, 230, 0.9)';
          ctx.fill();
        } else {
          // solid semicircle (warm-front convention), on the opposite side
          const cx = px2 - nx * 4, cy = py2 - ny * 4;
          const baseAngle = Math.atan2(ny, nx);
          ctx.beginPath();
          ctx.arc(cx, cy, 4, baseAngle - Math.PI / 2, baseAngle + Math.PI / 2);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255, 179, 71, 0.9)';
          ctx.fill();
        }
        symbolIdx++;
      }
    }
  }

  // Icons for manually spawned upper lows / ridges — otherwise they only
  // affect the physics invisibly, which defeats the point of placing them
  // deliberately. Fades out as the feature decays toward its lifetime end.
  drawUserFeatures(env, dayNum) {
    const { ctx } = this;
    for (const f of env.userFeatures) {
      if (f.lon < this.view.lon0 - 5 || f.lon > this.view.lon1 + 5) continue;
      const age = dayNum - f.spawnDay;
      const fade = Math.max(0, 1 - age / 5); // SPAWN.featureLifetimeDays, kept as a literal to avoid importing SPAWN here
      const x = this.lonToX(f.lon), y = this.latToY(f.lat);
      const pxPerDeg = this.cssW / (this.view.lon1 - this.view.lon0);
      const r = f.radius * pxPerDeg * 0.55;
      const color = f.type === 'low' ? 'rgba(94, 225, 230,' : 'rgba(255, 179, 71,';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `${color} ${0.55 * fade})`;
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = 'bold 12px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = `${color} ${0.9 * fade})`;
      ctx.fillText(f.type === 'low' ? 'ULL' : 'RIDGE', x, y + 4);
    }
  }

  drawPressureCenters(env) {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const hx = this.lonToX(env.highCenter.lon), hy = this.latToY(env.highCenter.lat);
    if (hx > -30 && hx < this.cssW + 30 && hy > -30 && hy < this.cssH + 30) {
      ctx.font = 'bold 16px "Space Grotesk", sans-serif';
      ctx.fillStyle = 'rgba(255, 179, 71, 0.9)';
      ctx.fillText('H', hx, hy);
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(255, 179, 71, 0.65)';
      ctx.fillText(`${env.highCenter.pressureMb}mb`, hx, hy + 15);
    }

    // Icelandic Low — the real physical "other half" of the NAO seesaw
    // (see constants.js), now visible now that the map extends up to
    // Iceland. Styled like the Bermuda High's "H" marker, in the same
    // red used for extratropical lows elsewhere, since this genuinely is
    // one — just semi-permanent rather than a traveling system.
    if (env.icelandicLow) {
      const ix = this.lonToX(env.icelandicLow.lon), iy = this.latToY(env.icelandicLow.lat);
      if (ix > -30 && ix < this.cssW + 30 && iy > -30 && iy < this.cssH + 30) {
        ctx.font = 'bold 16px "Space Grotesk", sans-serif';
        ctx.fillStyle = 'rgba(255, 93, 93, 0.9)';
        ctx.fillText('L', ix, iy);
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(255, 93, 93, 0.65)';
        ctx.fillText(`${env.icelandicLow.pressureMb}mb`, ix, iy + 15);
      }
    }

    for (const t of env.troughCenters) {
      if (t.lon < this.view.lon0 - 5 || t.lon > this.view.lon1 + 5) continue;
      const x = this.lonToX(t.lon), y = this.latToY(t.lat);
      if (x < -20 || x > this.cssW + 20 || y < -20 || y > this.cssH + 20) continue;
      ctx.font = 'bold 13px "Space Grotesk", sans-serif';
      ctx.fillStyle = 'rgba(94, 225, 230, 0.85)';
      ctx.fillText('TROF', x, y);
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(94, 225, 230, 0.6)';
      ctx.fillText(`${t.pressureMb}mb`, x, y + 13);
    }

    // Extratropical lows are the genuine surface-level pressure centers
    // (distinct from the bare upper troughs above) — styled like the "L"
    // on a real surface analysis, in red to match that convention, since
    // these are what fronts trail from and what a transitioning tropical
    // cyclone actually merges with.
    for (const l of env.extratropicalLows || []) {
      if (l.lon < this.view.lon0 - 5 || l.lon > this.view.lon1 + 5) continue;
      const x = this.lonToX(l.lon), y = this.latToY(l.lat);
      if (x < -20 || x > this.cssW + 20 || y < -20 || y > this.cssH + 20) continue;
      ctx.font = 'bold 16px "Space Grotesk", sans-serif';
      ctx.fillStyle = 'rgba(255, 93, 93, 0.9)';
      ctx.fillText('L', x, y);
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(255, 93, 93, 0.65)';
      ctx.fillText(`${l.pressureMb}mb`, x, y + 15);
    }

    // Natural upper-level lows (cutoff lows) — a distinct dashed-circle
    // marker with a "ULL" label, matching the same visual language used
    // for user-spawned ones but slightly dimmer since these are
    // ephemeral/natural rather than deliberately placed. These are also
    // a genesis source for subtropical cyclones — see simulation.js.
    for (const u of env.naturalUlls || []) {
      if (u.lon < this.view.lon0 - 5 || u.lon > this.view.lon1 + 5) continue;
      const x = this.lonToX(u.lon), y = this.latToY(u.lat);
      if (x < -20 || x > this.cssW + 20 || y < -20 || y > this.cssH + 20) continue;
      const pxPerDeg = this.cssW / (this.view.lon1 - this.view.lon0);
      const r = 6 * pxPerDeg * 0.55;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(94, 225, 230, 0.55)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(94, 225, 230, 0.8)';
      ctx.fillText('ULL', x, y + 3);
    }
  }

  // Classifies land exposure around a point: open ocean, a small
  // isolated feature (island — the AOI can extend over these, matching
  // e.g. Jamaica/Puerto Rico), or a large landmass (the AOI should stop
  // at its coastline, not extend across it). Distinguished by checking
  // a ring of points at a moderate radius around the center — a small
  // island has land at its center but mostly ocean around it; a large
  // landmass has land in most directions around it too.
  _classifyLandExposure(env, lat, lon) {
    const center = env.stateAt(lat, lon).land;
    if (center < 0.15) return 'ocean';
    const radius = 1.8;
    const dirs = 8;
    let landCount = 0;
    for (let k = 0; k < dirs; k++) {
      const ang = (k / dirs) * Math.PI * 2;
      const sLat = lat + Math.sin(ang) * radius;
      const sLon = lon + Math.cos(ang) * radius;
      if (env.stateAt(sLat, sLon).land > 0.4) landCount++;
    }
    return (landCount / dirs) > 0.55 ? 'largeLandmass' : 'smallIsland';
  }

  // NHC Tropical Weather Outlook-style formation area — now built the
  // same way the forecast cone is: projecting the wave's actual future
  // path (using its own real, steering/NAO-coupled motion physics — see
  // waves.js) and widening progressively with lead time, rather than a
  // single static shape. Truncated at the coastline of any large
  // landmass the projected path would cross (small islands like
  // Jamaica/Puerto Rico don't truncate it — the shape can extend over
  // those). Colored/thresholded to match the real <40%/40-60%/>60%
  // convention, with the familiar 48h/7-day percentage label. Only
  // shown once a wave's 7-day formation odds reach 10%.
  drawGenesisOutlook(env, osc, waveSource, dayNum) {
    const { ctx } = this;
    ctx.textAlign = 'center';
    const naoIdx = osc.naoIndex(dayNum);
    for (const wave of waveSource.waves) {
      if (wave.spawned) continue;
      const x0 = this.lonToX(wave.lon), y0 = this.latToY(wave.lat);
      if (x0 < -140 || x0 > this.cssW + 140) continue;
      const gpi = genesisPotential(env, osc, wave.lat, wave.lon, dayNum);
      const odds = formationOdds(gpi, GENESIS.gpiThreshold);
      if (odds.pct7day < 10) continue;
      const risk = odds.pct7day > 60 ? [255, 90, 90] : odds.pct7day >= 40 ? [255, 170, 60] : [255, 220, 80];

      // Length shrinks as confidence rises (a near-certain system has a
      // well-known, localized genesis area; a speculative one's
      // plausible zone spans much more of its future track).
      const confidenceLengthFactor = 1 - Math.min(0.78, (odds.pct7day / 100) * 0.85);
      const totalDays = 7 * confidenceLengthFactor;
      const stepDays = 0.5;
      const steps = Math.max(2, Math.round(totalDays / stepDays));

      const clone = new TropicalWave(wave.lat, wave.lon, wave.bornDay);
      const pathPoints = [{ lat: clone.lat, lon: clone.lon, dayFrac: 0 }];
      for (let s = 0; s < steps; s++) {
        clone.step(stepDays, env, naoIdx);
        if (this._classifyLandExposure(env, clone.lat, clone.lon) === 'largeLandmass') break;
        pathPoints.push({ lat: clone.lat, lon: clone.lon, dayFrac: (s + 1) / steps });
      }
      if (pathPoints.length < 2) continue;

      // Widening envelope, narrow near the current position and wider
      // toward the end of the projected track — same qualitative
      // approach the forecast cone uses, built as a left/right boundary
      // polygon rather than a single fixed ellipse.
      const baseWidthDeg = 0.55 + (odds.pct7day / 100) * 0.5;
      const leftPts = [], rightPts = [];
      for (let i = 0; i < pathPoints.length; i++) {
        const p = pathPoints[i];
        const a = pathPoints[Math.max(0, i - 1)], b = pathPoints[Math.min(pathPoints.length - 1, i + 1)];
        const dLon = b.lon - a.lon, dLat = b.lat - a.lat;
        const len = Math.hypot(dLon, dLat) || 1;
        const perpX = -dLat / len, perpY = dLon / len;
        const w = baseWidthDeg * (0.55 + 0.75 * p.dayFrac);
        leftPts.push({ lat: p.lat + perpY * w, lon: p.lon + perpX * w });
        rightPts.push({ lat: p.lat - perpY * w, lon: p.lon - perpX * w });
      }

      const tracePath = () => {
        ctx.beginPath();
        leftPts.forEach((p, i) => {
          const x = this.lonToX(p.lon), y = this.latToY(p.lat);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        for (let i = rightPts.length - 1; i >= 0; i--) {
          const x = this.lonToX(rightPts[i].lon), y = this.latToY(rightPts[i].lat);
          ctx.lineTo(x, y);
        }
        ctx.closePath();
      };

      ctx.save();
      tracePath();
      ctx.clip();
      ctx.strokeStyle = `rgba(${risk.join(',')}, 0.8)`;
      ctx.lineWidth = 1.5;
      const lastPt = pathPoints[pathPoints.length - 1];
      const xEnd = this.lonToX(lastPt.lon), yEnd = this.latToY(lastPt.lat);
      const minX = Math.min(x0, xEnd) - 60, maxX = Math.max(x0, xEnd) + 60;
      const minY = Math.min(y0, yEnd) - 60, maxY = Math.max(y0, yEnd) + 60;
      const hatchSpacing = 9;
      for (let hx = minX; hx < maxX + (maxY - minY); hx += hatchSpacing) {
        ctx.beginPath();
        ctx.moveTo(hx, minY);
        ctx.lineTo(hx - (maxY - minY), maxY);
        ctx.stroke();
      }
      ctx.restore();

      tracePath();
      ctx.strokeStyle = `rgba(${risk.join(',')}, 0.9)`;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      const s = 6;
      ctx.strokeStyle = `rgb(${risk.join(',')})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x0 - s, y0 - s); ctx.lineTo(x0 + s, y0 + s);
      ctx.moveTo(x0 + s, y0 - s); ctx.lineTo(x0 - s, y0 + s);
      ctx.stroke();

      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.fillStyle = `rgb(${risk.join(',')})`;
      ctx.fillText(`${odds.pct48h}% / ${odds.pct7day}%`, x0, Math.max(y0, yEnd) + 24);
    }
  }

  // Highlights the Central American Gyre "watch zone" during its active
  // seasonal windows (May-June, Oct-Nov) — CAG storms spawn directly
  // rather than from a visible tropical wave, so without this they can
  // seem to appear out of nowhere.
  // Highlights the MDR/East Atlantic box used for the SST-anomaly
  // feedback (see MDR_FEEDBACK in constants.js) with a labeled outline
  // and the current basin-average anomaly reading — lets you see exactly
  // what's driving that feedback rather than inferring it from the
  // regular SST map.
  // ITCZ: drawn as the real synoptic convention — a solid double line
  // with small perpendicular tick marks — spanning the visible basin at
  // its current seasonal latitude (see Environment.itczLat).
  drawItcz(env, dayNum) {
    const { ctx } = this;
    const lat = env.itczLat(dayNum);
    const y = this.latToY(lat);
    const yOffset = 3;
    const x0 = 0, x1 = this.cssW;

    ctx.strokeStyle = 'rgba(15, 15, 15, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x0, y - yOffset);
    ctx.lineTo(x1, y - yOffset);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x0, y + yOffset);
    ctx.lineTo(x1, y + yOffset);
    ctx.stroke();

    const tickSpacing = 42;
    for (let x = 20; x < x1; x += tickSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, y - yOffset - 4);
      ctx.lineTo(x, y + yOffset + 4);
      ctx.stroke();
    }

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(15, 15, 15, 0.9)';
    ctx.fillText('ITCZ', 16, y - 12);
  }

  // Caribbean monsoon trough: dashed magenta line with a bold label,
  // matching the real reference style — only shown once it's genuinely
  // seasonally active, not year-round.
  drawMonsoonTrough(env, dayNum) {
    const { ctx } = this;
    const strength = env.monsoonTroughStrength(dayNum);
    if (strength < 0.08) return;
    const geo = env.monsoonTroughGeometry(dayNum);
    const latC = geo.latCenter;
    const lonMin = geo.lonCenter - geo.lonHalfExtent, lonMax = geo.lonCenter + geo.lonHalfExtent;

    ctx.strokeStyle = `rgba(190, 60, 190, ${(0.55 + 0.35 * strength).toFixed(2)})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const lon = lonMin + (lonMax - lonMin) * (i / steps);
      const lat = latC + Math.sin((i / steps) * Math.PI) * 1.6;
      const x = this.lonToX(lon), y = this.latToY(lat);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    const labelLon = lonMin + (lonMax - lonMin) * 0.62;
    const labelLat = latC + 3.2;
    const lx = this.lonToX(labelLon), ly = this.latToY(labelLat);
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    const text = 'MONSOON TROUGH';
    const textW = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(155, 35, 165, 0.92)';
    ctx.fillRect(lx - textW / 2 - 7, ly - 11, textW + 14, 21);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, lx, ly + 4);
  }

  drawMdrBox(env) {
    const { ctx } = this;
    const x1 = this.lonToX(MDRF.boxLonMin), x2 = this.lonToX(MDRF.boxLonMax);
    const y1 = this.latToY(MDRF.boxLatMax), y2 = this.latToY(MDRF.boxLatMin);
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.85)';
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 2;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.setLineDash([]);
    const anomaly = env.mdrEastAtlAnomaly ?? 0;
    const label = `MDR/E.Atl anomaly: ${anomaly >= 0 ? '+' : ''}${anomaly.toFixed(2)}°C`;
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(10, 20, 32, 0.75)';
    const textW = ctx.measureText(label).width;
    ctx.fillRect(x1 + 2, y1 + 4, textW + 12, 20);
    ctx.fillStyle = 'rgba(255, 209, 102, 0.95)';
    ctx.fillText(label, x1 + 8, y1 + 19);
  }

  drawCagZone(dayNum) {
    const doy = dayNum % 365;
    const seasonality =
      Math.exp(-0.5 * Math.pow((doy - CAG.peak1DayOfYear) / CAG.width, 2)) +
      Math.exp(-0.5 * Math.pow((doy - CAG.peak2DayOfYear) / CAG.width, 2));
    if (seasonality < 0.15) return;
    const { ctx } = this;
    const x1 = this.lonToX(CAG.lonMin), x2 = this.lonToX(CAG.lonMax);
    const y1 = this.latToY(CAG.latMax), y2 = this.latToY(CAG.latMin);
    const alpha = Math.min(0.22, seasonality * 0.22);
    ctx.fillStyle = `rgba(180, 130, 255, ${alpha})`;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeStyle = `rgba(180, 130, 255, ${Math.min(0.6, alpha * 2.2)})`;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.setLineDash([]);
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = `rgba(220, 190, 255, ${Math.min(0.85, alpha * 3)})`;
    ctx.textAlign = 'left';
    ctx.fillText('CAG watch zone', x1 + 5, y1 + 13);
  }

  drawWaves(waveSource) {
    const { ctx } = this;
    for (const w of waveSource.waves) {
      if (w.spawned) continue;
      const x = this.lonToX(w.lon), y = this.latToY(w.lat);
      if (x < -14 || x > this.cssW + 14) continue;
      // A visible pulsing-style ring plus a solid core — small dots were
      // easy to miss against a busy field overlay.
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(216, 230, 238, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = 'rgba(216, 230, 238, 0.85)';
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(216, 230, 238, 0.7)';
      ctx.textAlign = 'left';
      ctx.fillText('wave', x + 10, y + 3);
    }
  }

  // By default, past-track lines only show the *current* calendar year's
  // dissipated storms — a full multi-year run would otherwise clutter the
  // map with every season ever simulated. Use drawSeasonTracks (below) to
  // deliberately browse a specific past season instead.
  drawPastTracks(archive, highlightId, currentYear) {
    const { ctx } = this;
    for (const storm of archive) {
      if (currentYear != null && calendarYearOf(storm.bornDay) !== currentYear && storm.id !== highlightId) continue;
      if (storm.peakKt < 34 && storm.id !== highlightId) continue;
      const isHighlighted = storm.id === highlightId;
      ctx.beginPath();
      ctx.strokeStyle = isHighlighted ? 'rgba(255, 209, 102, 0.95)' : 'rgba(150, 165, 178, 0.28)';
      ctx.lineWidth = isHighlighted ? 2.5 : 1;
      storm.track.forEach((pt, i) => {
        const x = this.lonToX(pt.lon), y = this.latToY(pt.lat);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      if (isHighlighted) {
        for (const pt of storm.track) {
          const x = this.lonToX(pt.lon), y = this.latToY(pt.lat);
          const cls = classify(pt.kt);
          ctx.beginPath();
          ctx.fillStyle = cls.color;
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // Deliberately browse a specific past season's tracks, in a distinct
  // color so they're clearly not part of the live current-year picture.
  // Deliberately uses the exact same rendering as drawPastTracks (colors,
  // highlight behavior, category-colored dots) — a past season's tracks
  // should look identical to "this year's past tracks," just filtered to
  // a different year, not a visually distinct purple scheme.
  drawSeasonTracks(archive, year, highlightId) {
    const { ctx } = this;
    for (const storm of archive) {
      if (calendarYearOf(storm.bornDay) !== year) continue;
      if (storm.peakKt < 34 && storm.id !== highlightId) continue;
      const isHighlighted = storm.id === highlightId;
      ctx.beginPath();
      ctx.strokeStyle = isHighlighted ? 'rgba(255, 209, 102, 0.95)' : 'rgba(150, 165, 178, 0.28)';
      ctx.lineWidth = isHighlighted ? 2.5 : 1;
      storm.track.forEach((pt, i) => {
        const x = this.lonToX(pt.lon), y = this.latToY(pt.lat);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      if (isHighlighted) {
        for (const pt of storm.track) {
          const x = this.lonToX(pt.lon), y = this.latToY(pt.lat);
          const cls = classify(pt.kt);
          ctx.beginPath();
          ctx.fillStyle = cls.color;
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  drawCycloneIcon(x, y, radiusPx, color, spinAngle, intensityKt) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spinAngle);
    const arms = intensityKt >= 64 ? 4 : 3;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.2, radiusPx * 0.16);
    ctx.lineCap = 'round';
    for (let a = 0; a < arms; a++) {
      const baseAngle = (a / arms) * Math.PI * 2;
      ctx.beginPath();
      const turns = 0.85, steps = 10;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const ang = baseAngle + t * Math.PI * 2 * turns;
        const r = radiusPx * (0.35 + 0.65 * t);
        const px = Math.cos(ang) * r, py = Math.sin(ang) * r;
        if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.globalAlpha = 0.9;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(10, 16, 24, 0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1.5, radiusPx * 0.22), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  drawWindSwaths(storms) {
    const { ctx } = this;
    const degPerKm = 1 / 111; // rough, fine for a visual swath
    for (const storm of storms) {
      const x = this.lonToX(storm.lon), y = this.latToY(storm.lat);
      const pxPerDeg = this.cssW / (this.view.lon1 - this.view.lon0);
      if (storm.r34Km > 0) {
        ctx.beginPath();
        ctx.arc(x, y, storm.r34Km * degPerKm * pxPerDeg, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(79, 209, 197, 0.5)';
        ctx.fillStyle = 'rgba(79, 209, 197, 0.06)';
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
      }
      if (storm.r64Km > 0) {
        ctx.beginPath();
        ctx.arc(x, y, storm.r64Km * degPerKm * pxPerDeg, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 93, 93, 0.55)';
        ctx.fillStyle = 'rgba(255, 93, 93, 0.08)';
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  drawStorms(storms, selectedId, spinClock, interpFrac) {
    const { ctx } = this;
    for (const storm of storms) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(232, 237, 242, 0.55)';
      ctx.lineWidth = 1.5;
      storm.track.forEach((pt, i) => {
        const x = this.lonToX(pt.lon), y = this.latToY(pt.lat);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      for (const pt of storm.track) {
        const x = this.lonToX(pt.lon), y = this.latToY(pt.lat);
        const cls = classify(pt.kt);
        ctx.beginPath();
        ctx.fillStyle = cls.color;
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // Smoothly interpolate the rendered position between the last two
      // tick positions using the animation loop's inter-tick progress, so
      // motion doesn't visibly snap once per tick — most noticeable (and
      // most fixed by this) at slow speed multipliers.
      let dispLat = storm.lat, dispLon = storm.lon;
      if (interpFrac != null && storm.track.length >= 2) {
        const a = storm.track[storm.track.length - 2];
        const b = storm.track[storm.track.length - 1];
        dispLat = a.lat + (b.lat - a.lat) * interpFrac;
        dispLon = a.lon + (b.lon - a.lon) * interpFrac;
      }
      const x = this.lonToX(dispLon), y = this.latToY(dispLat);
      const cls = classify(storm.intensityKt, storm.phase === 'extratropical');
      const r = 6 + Math.min(13, storm.intensityKt / 9);
      const spinSpeed = 0.6 + Math.min(2.2, storm.intensityKt / 45);
      const angle = spinClock * spinSpeed * (Math.PI * 2);
      if (storm.phase === 'remnant') {
        // Same visual language as an anonymous tropical wave (it's just
        // as weak/disorganized), but it carries a name — a remnant low is
        // a known, tracked system, not an unidentified disturbance.
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(216, 230, 238, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = 'rgba(216, 230, 238, 0.85)';
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        if (storm.id === selectedId) {
          ctx.beginPath();
          ctx.strokeStyle = '#e8edf2';
          ctx.lineWidth = 2;
          ctx.arc(x, y, 14, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(216, 230, 238, 0.85)';
        ctx.textAlign = 'left';
        ctx.fillText(`${storm.displayName} (remnant low)`, x + 10, y + 3);
        continue;
      }
      this.drawCycloneIcon(x, y, r, cls.color, angle, storm.intensityKt);
      if (storm.id === selectedId) {
        ctx.beginPath();
        ctx.strokeStyle = '#e8edf2';
        ctx.lineWidth = 2;
        ctx.arc(x, y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#e8edf2';
      ctx.font = '11px "JetBrains Mono", monospace';
      const riTag = storm.isRapidIntensifying ? ' ⚡RI' : '';
      const ercTag = storm.ercPhase !== 'none' ? ' ♻ERC' : '';
      const origTag = storm.origin === 'CAG' ? ' 🌀CAG' : '';
      const exTag = storm.phase === 'extratropical' ? ' EX' : '';
      const windPart = this.showMapWind ? `${Math.round(storm.intensityKt)}kt` : '';
      const pressurePart = this.showMapPressure ? `${storm.pressureMb}mb` : '';
      const statsPart = [windPart, pressurePart].filter(Boolean).join(' · ');
      ctx.fillText(`${storm.displayName}${statsPart ? ' · ' + statsPart : ''}${exTag}${riTag}${ercTag}${origTag}`, x + r + 6, y + 3);
    }
  }

  // Forecast cone (envelope quad per step) + spaghetti member lines for
  // the currently-selected active storm. Each member's line is colored
  // segment-by-segment by its forecast wind speed (matching the
  // convention real ensemble track plots use — see FORECAST_WIND_STOPS)
  // so the spread communicates possible future intensity, not just
  // possible future position.
  drawForecast(forecast) {
    if (!forecast) return;
    const { ctx } = this;
    if (this.showForecastCone) {
      ctx.fillStyle = 'rgba(255, 209, 102, 0.10)';
      ctx.beginPath();
      forecast.cone.forEach((c, i) => {
        const x = this.lonToX(c.lonMax), y = this.latToY(c.latMax);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      for (let i = forecast.cone.length - 1; i >= 0; i--) {
        const c = forecast.cone[i];
        ctx.lineTo(this.lonToX(c.lonMin), this.latToY(c.latMin));
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Mean track through the cone, like the black "control" line in a
      // real ensemble plot.
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(232, 237, 242, 0.85)';
      ctx.lineWidth = 2;
      forecast.cone.forEach((c, i) => {
        const x = this.lonToX(c.lonMean), y = this.latToY(c.latMean);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // NHC-style forecast nodes: a labeled marker every 24h along the
      // mean track showing projected category/wind, not just position.
      ctx.textAlign = 'center';
      for (let i = 0; i < forecast.cone.length; i++) {
        const c = forecast.cone[i];
        const stepsPerDay = Math.round(1 / (forecast.cone[1] ? forecast.cone[1].day - forecast.cone[0].day : 0.25));
        if (i % stepsPerDay !== 0) continue;
        const x = this.lonToX(c.lonMean), y = this.latToY(c.latMean);
        const cls = classify(c.ktMean ?? 0);
        ctx.beginPath();
        ctx.fillStyle = cls.color;
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0a1420';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.fillStyle = '#e8edf2';
        // Forecast intensity rounds to the nearest 5kt — matching how
        // real NHC advisories report forecast winds, and appropriately
        // reflecting that forecast intensity carries more uncertainty
        // than a live observation does.
        const roundedFcKt = Math.round((c.ktMean ?? 0) / 5) * 5;
        ctx.fillText(`${cls.short} ${roundedFcKt}kt`, x, y - 9);
      }
    }

    if (this.showForecastSpaghetti) {
      ctx.lineWidth = 1.6;
      for (const member of forecast.members) {
        for (let i = 1; i < member.length; i++) {
          const a = member[i - 1], b = member[i];
          const x1 = this.lonToX(a.lon), y1 = this.latToY(a.lat);
          const x2 = this.lonToX(b.lon), y2 = this.latToY(b.lat);
          // Uses the same Saffir-Simpson category colors as everywhere
          // else in the app (storm icons, track dots) rather than a
          // separate continuous wind-speed scale, so a glance at the
          // spaghetti tells you the same category language the rest of
          // the UI uses.
          const color = classify(b.kt).color;
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  drawShearBrush() {
    if (!this.shearBrush) return;
    const { ctx } = this;
    const { lat, lon, radiusDeg, mode } = this.shearBrush;
    const x = this.lonToX(lon), y = this.latToY(lat);
    const degToPx = this.cssW / (this.view.lon1 - this.view.lon0);
    const r = radiusDeg * degToPx;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = mode === 'weaken' ? 'rgba(94, 225, 230, 0.8)' : 'rgba(255, 93, 93, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  render(world, selectedId, spinClock, highlightArchiveId, forecast, interpFrac, viewingSeasonYear) {
    // Fill the whole canvas first (including any letterbox margins the
    // aspect-fit leaves on the sides/top/bottom) so they read as
    // deliberate framing rather than stale/leftover canvas content.
    this.ctx.fillStyle = `rgb(${PALETTE.satBase.join(',')})`;
    this.ctx.fillRect(0, 0, this.cssW, this.cssH);
    if (this.overlay === 'velpot') this._divergenceField = computeDivergenceField(world.env);
    if (this.overlay === 'mslp') this._mslpDisplayField = this._computeMslpDisplayField(world);
    this.drawOceanField(world.env);
    if (this.overlay === 'sst') {
      this.drawContours(world.env.sstDisplay, [20, 22, 24, 25, 26, 27, 28, 29, 30, 31], 'rgba(255,255,255,0.20)');
    } else if (this.overlay === 'mslp' && this._mslpDisplayField) {
      // Real isobar spacing — every 4mb — so an intense storm's tightly
      // packed lines and a tropical wave's shallow kink both read
      // clearly, the way a real surface analysis does.
      const levels = [];
      for (let mb = 892; mb <= 1024; mb += 4) levels.push(mb);
      this.drawContours(this._mslpDisplayField, levels, 'rgba(255,255,255,0.32)');
    } else if (this.overlay === 'sstAnomaly' || this.overlay === '500mb') {
      const field = this.overlay === 'sstAnomaly'
        ? Float32Array.from(world.env.sstDisplay, (v, i) => v - world.env.sstNormal[i])
        : world.env.upperHeight;
      const levels = this.overlay === 'sstAnomaly'
        ? [-2, -1, -0.5, 0.5, 1, 2]
        : [-0.6, -0.3, 0.3, 0.6];
      this.drawContours(field, levels, 'rgba(255,255,255,0.24)');
    } else if (this.overlay === 'shear') {
      this.drawShearThresholds(world.env);
    } else if (this.overlay === 'mpi') {
      const field = Float32Array.from(world.env.sst, (v) => mpiKtFromSst(v));
      this.drawContours(field, [34, 64, 84, 97, 114, 135, 150, 165], 'rgba(255,255,255,0.28)');
    } else if (this.overlay === 'velpot' && this._divergenceField) {
      this.drawContours(this._divergenceField, [-3, -1, 1, 3], 'rgba(30,30,30,0.35)');
    }
    this.drawLand();
    this.drawGraticule();
    if (this.overlay === 'shear') {
      this.drawVectorField(world.env.shearVecU, world.env.shearVecV, null, world.env, () => [232, 237, 242]);
    } else if (this.overlay === '200mb') {
      // Streamlines instead of discrete arrows — much clearer for seeing
      // outflow channels, TUTT/ULL circulation, and general large-scale
      // flow at a glance, matching how real upper-air streamline charts
      // read.
      this.drawStreamlines(world.env.upperWindU, world.env.upperWindV, world.env, () => [10, 16, 20]);
    } else if (this.overlay === 'steering') {
      this.drawVectorField(world.env.steerU, world.env.steerV, null, world.env, () => [94, 225, 230], 3);
    } else if (this.overlay === 'steering850') {
      this.drawVectorField(world.env.steer850U, world.env.steer850V, null, world.env, () => [255, 176, 59], 3);
    } else if (this.overlay === 'steeringBoth') {
      // Both layers at once, distinct colors so they stay readable
      // together — cyan for 500mb (what hurricanes/majors follow),
      // amber for 850mb (what waves/weak TD-TS follow) — same color
      // convention as the single-layer overlays above, just shown side
      // by side rather than needing to flip between them. Small pixel
      // offset on the 850mb layer so the two arrows at a shared grid
      // point don't draw directly on top of each other.
      this.drawVectorField(world.env.steerU, world.env.steerV, null, world.env, () => [94, 225, 230], 3);
      this.drawVectorField(world.env.steer850U, world.env.steer850V, null, world.env, () => [255, 176, 59], 3, { x: 5, y: 5 });
    }
    if (this.showFronts) this.drawFrontalBoundaries(world.env);
    this.drawUserFeatures(world.env, world.dayNum);
    this.drawPressureCenters(world.env);
    if (this.showOutlook) this.drawGenesisOutlook(world.env, world.osc, world.waveSource, world.dayNum);
    if (this.showPastTracks) this.drawPastTracks(world.archive, highlightArchiveId, calendarYearOf(world.dayNum));
    if (viewingSeasonYear != null) this.drawSeasonTracks(world.archive, viewingSeasonYear, highlightArchiveId);
    if (this.showCagZone) this.drawCagZone(world.dayNum);
    if (this.overlay === 'mdrsst') this.drawMdrBox(world.env);
    if (this.showItcz) this.drawItcz(world.env, world.dayNum);
    if (this.showMonsoonTrough) this.drawMonsoonTrough(world.env, world.dayNum);
    this.drawWaves(world.waveSource);
    if (this.showForecastCone || this.showForecastSpaghetti) {
      // forecast is now always an array (0, 1, or many storms' worth,
      // depending on the "all storms" toggle) — draw each independently.
      const forecasts = Array.isArray(forecast) ? forecast : (forecast ? [forecast] : []);
      for (const f of forecasts) this.drawForecast(f);
    }
    if (this.showSwath) this.drawWindSwaths(world.storms);
    this.drawStorms(world.storms, selectedId, spinClock, interpFrac);
    this.drawShearBrush();
  }
}
