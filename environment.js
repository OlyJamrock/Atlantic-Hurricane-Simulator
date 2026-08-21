// environment.js — the gridded atmosphere/ocean state that storms live in.
//
// v0.3 additions on top of the real-geography/geostrophic-steering base:
//  - ENSO index now modulates basin shear (the dominant real mechanism
//    behind El Nino/La Nina's effect on Atlantic activity) in addition to
//    a smaller direct SST effect.
//  - The Bermuda high's position/strength carry a slow noise perturbation
//    ("pattern noise") on top of the smooth seasonal blend, so the
//    steering pattern itself — and therefore storm tracks — varies from
//    storm to storm and year to year instead of being a fixed function of
//    day-of-year.
//  - Shear is now also stored as a vector (direction + magnitude), derived
//    from the difference between the upper- and lower-level wind, for
//    rendering shear arrows and for future direction-relative physics.
//  - Pressure-center positions (the high, each trough) are computed once
//    per tick and exposed for the renderer's H/L labels.
//  - A separate seasonal-only SST field is kept so the UI can render a
//    true SST *anomaly* overlay (actual minus normal-for-the-date).

import { GRID, ENVIRONMENT as ENV, OSCILLATIONS as OSC, SEASON, TIME, AMO, SPAWN, ETLOW, MDR_FEEDBACK as MDRF } from './constants.js';
import { NoiseField } from './noise.js';
import { rasterizeLandMask } from './geography.js';
import { windToPressureMb } from './scale.js';

const idx = (iLat, iLon) => iLat * GRID.nLon + iLon;
const lerp = (a, b, t) => a + (b - a) * t;

export class Environment {
  constructor(oscillations, seed = 1) {
    this.osc = oscillations;
    this.n = GRID.nLat * GRID.nLon;

    this.landMask = rasterizeLandMask();
    this.sstBase = new Float32Array(this.n);        // peak-season climatology shape
    this.sst = new Float32Array(this.n);             // actual current SST
    this.sstNormal = new Float32Array(this.n);       // "normal for this date" (no ENSO/MJO) — anomaly reference
    this.shear = new Float32Array(this.n);
    this.shearClim = new Float32Array(this.n);
    this.shearUserAnomaly = new Float32Array(this.n);
    this.shearVecU = new Float32Array(this.n);       // for rendering shear arrows
    this.shearVecV = new Float32Array(this.n);
    this.upperHeight = new Float32Array(this.n);
    // Ambient/background sea-level pressure — distinct from a storm's
    // own central pressure. Real background MSLP genuinely varies
    // across the basin (subtropical ridge vs Caribbean/Gulf/BoC warm
    // pool vs troughing) and sets the *pressure gradient* a storm's
    // wind field responds to, not just its own central pressure in
    // isolation — see windGradientKt() in storm.js.
    this.bgPressureMb = new Float32Array(this.n);
    this.upperWindU = new Float32Array(this.n);   // "200mb" wind for its own overlay
    this.upperWindV = new Float32Array(this.n);
    this.jetU = new Float32Array(this.n);          // jet component alone, sampled by storms for steering
    this.dryAir = new Float32Array(this.n);
    this.steerU = new Float32Array(this.n);
    this.steerV = new Float32Array(this.n);
    // Separate low-level (850mb) steering — weak systems (waves, TD/TS)
    // are steered mostly by the low-level trade flow, not the same
    // mid-level flow that dominates hurricane/major steering. Real 850mb
    // trade winds have genuinely more variance than 500mb (fast surges
    // over 30kt, or periods of very weak flow), which is also the
    // physically correct fix for weak-storm tracks having felt too
    // erratic after steering noise was added directly to the single
    // shared field a couple rounds back — that variability belongs here,
    // not blended into what stronger storms use.
    this.steer850U = new Float32Array(this.n);
    this.steer850V = new Float32Array(this.n);

    this._shearNoise = new NoiseField({ width: 14, height: 7, seed: seed + 1 });
    // Tropical steering has genuine synoptic-scale day-to-day
    // variability (transient ridging, embedded disturbances, MJO/CCKW-
    // adjacent effects not otherwise resolved) that the smooth
    // climatological trade-wind formula alone doesn't capture — this is
    // what was making steering feel too static/predictable. Two
    // independent fields for U/V so the noise doesn't just uniformly
    // speed up or slow down the flow in one direction.
    this._steerNoiseU = new NoiseField({ width: 16, height: 8, seed: seed + 11 });
    this._steerNoiseV = new NoiseField({ width: 16, height: 8, seed: seed + 17 });
    this._dryNoise = new NoiseField({ width: 10, height: 6, seed: seed + 2 });
    this._patternNoiseLon = new NoiseField({ width: 8, height: 1, seed: seed + 3, wrapX: false });
    this._patternNoiseStr = new NoiseField({ width: 8, height: 1, seed: seed + 4, wrapX: false });
    // Caribbean monsoon trough — its own noise, independent of the
    // ridge's pattern above: real day-to-day/week-to-week variability
    // (it weakens, strengthens, shifts, and can temporarily disappear
    // even within its active season, not just follow a smooth seasonal
    // curve), plus separate drift for how far east/north it extends
    // from its Central America/SW Caribbean anchor on a given day.
    this._monsoonTroughNoiseStr = new NoiseField({ width: 10, height: 1, seed: seed + 23, wrapX: false });
    this._monsoonTroughNoiseExtent = new NoiseField({ width: 10, height: 1, seed: seed + 29, wrapX: false });
    this._troughNoise = new NoiseField({ width: 10, height: 4, seed: seed + 5, wrapX: true });
    this._hotPocketNoise = new NoiseField({ width: 9, height: 5, seed: seed + 6 });
    // Coarse, slow-drifting texture applied to the NAO tripole bands so
    // they read as organic swaths (like real SSTA imagery) rather than
    // perfectly uniform zonal stripes.
    this._naoSwathNoise = new NoiseField({ width: 8, height: 6, seed: seed + 8 });
    this._ullNoise = new NoiseField({ width: 12, height: 6, seed: seed + 9 });
    // Storm-induced wave-breaking shear "wake" — genuinely stateful,
    // written to by storms (see Environment.injectWaveBreaking, called
    // from storm.js) and decayed here each tick.
    this.waveBreakingShear = new Float32Array(this.n);
    // Tracks the ULL contribution specifically (separate from the total
    // shear field) so natural ULL cores can be detected and shown on the
    // map, not just felt invisibly as part of the combined shear number.
    this.ullBoostField = new Float32Array(this.n);
    this.naturalUlls = []; // [{lat, lon, strength}], recomputed each tick
    this._waveBreakingActive = false;
    // Manually spawned upper lows / ridges (see constants.js SPAWN) —
    // decaying, user-placed Gaussian bumps in the same height field the
    // simulation's own Bermuda high/troughs use.
    this.userFeatures = [];
    // Independent per-cell noise (lattice matches grid resolution exactly,
    // sampled at integer positions — i.e. no smoothing between cells) to
    // give SST isotherms the jagged, fine-scale texture real satellite SST
    // has, instead of perfectly smooth arcs. Small amplitude — this is a
    // display/contour detail, not a physically meaningful signal, so it's
    // kept separate from `sst` (which storms still sense as smooth).
    this._fineTextureNoise = new NoiseField({ width: GRID.nLon, height: GRID.nLat, seed: seed + 7 });
    this.sstDisplay = new Float32Array(this.n);

    this._troughPhases = Array.from(
      { length: ENV.troughCount },
      (_, i) => (i / ENV.troughCount) * 360
    );
    // User-adjustable strength multiplier per natural trough — lets
    // someone strengthen/weaken an existing trough directly (distinct
    // from the shear-paint brush and from spawning a brand new feature).
    // Decays slowly back toward 1 so a one-time adjustment doesn't
    // permanently override the trough's natural evolution forever.
    this.troughUserMultiplier = new Array(ENV.troughCount).fill(1);

    // Genuinely separate surface-level entities from the upper troughs —
    // see ETLOW in constants.js. Each is {lat, lon, strength, spawnDay,
    // pressureMb, userSpawned}.
    this.extratropicalLows = [];
    // Basin-scale MDR/East Atlantic SST anomaly feedback state — see
    // MDR_FEEDBACK in constants.js. Lagged by one tick.
    this.mdrEastAtlAnomaly = 0;
    this._mdrEastAtlAnomalyPrev = 0;
    this._mdr850MagnitudePrev = 15; // seeded near a typical trade-wind speed so the very first tick isn't an artificial cold/warm shock
    this._ullDriftPrev = ENV.ullDriftDegPerDay;
    this._ullDriftAccumulated = 0; // running offset, not a rate*dayNum product — avoids a discontinuous jump whenever the rate itself changes

    this.highCenter = { lat: ENV.highLat, lon: ENV.highLonPeak, strength: 1 };
    this.troughCenters = [];
    this.ensoIndex = 0;

    this._buildSstClimatology();
  }

  latOf(iLat) { return GRID.lat0 + iLat * GRID.res; }
  lonOf(iLon) { return GRID.lon0 + iLon * GRID.res; }

  // Two-segment latitude interpolation for SST climatology — equator to
  // 45N uses the original (already-calibrated) curve shape; 45N to 70N
  // continues cooling toward the arctic endpoint. Deliberately uses fixed
  // reference latitudes, not GRID.lat1, so the climatology can't silently
  // warp if the grid's extent changes again later.
  // Real SST climatology doesn't fall off at one steady rate from the
  // equator to 45N — it stays close to the tropical peak through the
  // deep tropics/subtropics, then drops much more sharply through the
  // ~28-45N "extratropical transition zone" (found via a real bug: a
  // storm was maintaining Cat5/870mb intensity past 38N, because SST
  // there was still reading ~27.3C — comfortably within MPI-table major-
  // hurricane territory. A single two-segment power curve can't be both
  // gentle enough to keep the deep tropics accurate and steep enough to
  // properly cap intensity by the mid-30s latitude, so this adds a third
  // breakpoint specifically for that zone.)
  _sstTwoSegment(lat, equatorVal, subtropicalVal, midVal, arcticVal) {
    const subtropicalLat = ENV.sstSubtropicalBreakLat;
    const midLat = ENV.sstClimatologyMidLat;
    if (lat <= subtropicalLat) {
      const f = Math.max(0, lat) / subtropicalLat;
      return lerp(equatorVal, subtropicalVal, Math.pow(f, 1.25));
    }
    if (lat <= midLat) {
      const f2 = (lat - subtropicalLat) / (midLat - subtropicalLat);
      return lerp(subtropicalVal, midVal, f2);
    }
    const maxLat = ENV.sstClimatologyMaxLat;
    const f3 = Math.min(1, (lat - midLat) / (maxLat - midLat));
    return lerp(midVal, arcticVal, f3);
  }

  isLand(iLat, iLon) { return this.landMask[idx(iLat, iLon)] > 0.5; }
  landFrac(iLat, iLon) { return this.landMask[idx(iLat, iLon)]; }

  _buildSstClimatology() {
    for (let iLat = 0; iLat < GRID.nLat; iLat++) {
      const lat = this.latOf(iLat);
      const latFrac = Math.min(1, (lat - GRID.lat0) / (ENV.sstClimatologyMidLat - GRID.lat0));
      for (let iLon = 0; iLon < GRID.nLon; iLon++) {
        const lon = this.lonOf(iLon);
        let sst = this._sstTwoSegment(lat, ENV.sstEquatorPeak, ENV.sstSubtropicalPeak, ENV.sstPolewardPeak, ENV.sstArcticPeak);
        const dLon = (lon - ENV.warmPoolLon) / ENV.warmPoolWidth;
        const dLatPool = (lat - ENV.warmPoolLatCenter) / ENV.warmPoolLatWidth;
        sst += ENV.sstWarmPoolBoost * Math.exp(-dLon * dLon) * Math.exp(-dLatPool * dLatPool);
        this.sstBase[idx(iLat, iLon)] = sst;
      }
    }
  }

  // Slow non-tropical "pattern noise" nudging the high's longitude and
  // strength day to day, sampled from a 1D noise strip driven by dayNum.
  _patternPerturbation(dayNum) {
    const u = (dayNum * ENV.patternNoiseDegPerDay * 0.02) % this._patternNoiseLon.w;
    const lonNudge = this._patternNoiseLon.sample(u, 0) * ENV.patternNoiseLonAmpDeg;
    const strNudge = this._patternNoiseStr.sample((u * 1.3) % this._patternNoiseStr.w, 0) * ENV.patternNoiseStrengthAmp;
    return { lonNudge, strNudge };
  }

  // Returns { h, dHdLon, dHdLat } — value and analytic gradient in one
  // pass, avoiding a finite-difference stencil. `nao` is the current NAO
  // index: +NAO strengthens and shifts the high poleward/west (fewer,
  // later recurves — storms track farther before turning); -NAO weakens
  // and shifts it equatorward/east (earlier, easier recurves).
  _highFieldWithGrad(lat, lon, seasonal, pattern, nao) {
    const lonNow = lerp(ENV.highLonOffSeason, ENV.highLonPeak, seasonal) +
      pattern.lonNudge - nao * OSC.naoHighLonShiftDeg;
    const latNow = ENV.highLat + nao * OSC.naoHighLatShiftDeg;
    const strength = Math.max(
      0.1,
      lerp(ENV.highStrengthOffSeason, ENV.highStrengthPeak, seasonal) +
        pattern.strNudge + nao * OSC.naoHighStrengthCoeff
    );
    const dLat = lat - latNow;
    const dLon = lon - lonNow;
    const R2 = ENV.highRadiusDeg * ENV.highRadiusDeg;
    const r2 = dLat * dLat + dLon * dLon * 0.6;
    const h = strength * Math.exp(-r2 / (2 * R2));
    return { h, dHdLon: -h * (0.6 * dLon) / R2, dHdLat: -h * dLat / R2, lonNow, latNow, strength };
  }

  // Per-trough noise: each trough gets its own strength wobble and
  // latitude wander, sampled from different offsets of a shared noise
  // field, so the mid-latitude pattern doesn't feel like a fixed
  // metronome — troughs strengthen, weaken, and wander independently.
  _troughNoiseFor(troughIndex, dayNum) {
    const u = (dayNum * ENV.troughNoiseDegPerDay * 0.05 + troughIndex * 3.7) % this._troughNoise.w;
    const strNudge = this._troughNoise.sample(u, troughIndex * 0.5) * ENV.troughStrengthNoiseAmp;
    const latNudgeRaw = this._troughNoise.sample(u + 5, troughIndex * 0.5 + 1);
    // Asymmetric: a northward nudge (positive) applies at full amplitude
    // (Canada/Northeast should be genuinely common), a southward one
    // (negative) is damped (the US Southwest should be a rare
    // excursion, not an equally-likely outcome).
    const latNudge = latNudgeRaw * ENV.troughLatNoiseAmpDeg * (latNudgeRaw >= 0 ? 1 : ENV.troughLatNoiseSouthDampen);
    return { strNudge, latNudge };
  }

  _troughFieldWithGrad(lat, lon, dayNum) {
    let h = 0, dHdLon = 0, dHdLat = 0;
    this._troughPhases.forEach((phase0, ti) => {
      const noise = this._troughNoiseFor(ti, dayNum);
      const lonNow = ENV.troughLonRangeStart + ((dayNum * ENV.troughDriftDegPerDay + phase0) % 140);
      const latNow = ENV.troughLatBase - 6 - 10 * Math.sin((phase0 * Math.PI) / 180) + noise.latNudge;
      const strength = Math.max(0.15, ENV.troughStrength * (1 + noise.strNudge)) * (this.troughUserMultiplier[ti] ?? 1);
      const dLat = lat - latNow;
      const dLon = lon - lonNow;
      const R2 = ENV.troughRadiusDeg * ENV.troughRadiusDeg;
      const r2 = dLat * dLat * 1.4 + dLon * dLon * 0.5;
      const hi = -strength * Math.exp(-r2 / (2 * R2));
      h += hi;
      dHdLon += -hi * (0.5 * dLon) / R2;
      dHdLat += -hi * (1.4 * dLat) / R2;
    });
    return { h, dHdLon, dHdLat };
  }

  _troughCenterPositions(dayNum) {
    return this._troughPhases.map((phase0, ti) => {
      const noise = this._troughNoiseFor(ti, dayNum);
      const strength = Math.max(0.15, ENV.troughStrength * (1 + noise.strNudge)) * (this.troughUserMultiplier[ti] ?? 1);
      return {
        lon: ENV.troughLonRangeStart + ((dayNum * ENV.troughDriftDegPerDay + phase0) % 140),
        lat: ENV.troughLatBase - 6 - 10 * Math.sin((phase0 * Math.PI) / 180) + noise.latNudge,
        strength,
        pressureMb: Math.round(1013 - strength * 21),
      };
    });
  }

  update(dayNum, activeStorms = [], rand = Math.random) {
    // Decay the storm-induced wave-breaking shear wake. Computed from the
    // actual day gap since the last update (not a fixed tick assumption)
    // so this stays correct even for the history/rewind Environment
    // instance, which can jump by large or irregular day gaps.
    const dtSinceLast = this._lastUpdateDay == null ? 0 : Math.max(0, dayNum - this._lastUpdateDay);
    // Accumulate the ULL drift offset using last tick's rate (itself
    // derived from the actual subtropical steering flow — see the
    // post-loop computation below) — an accumulated running offset, not
    // rate*dayNum, specifically so a day-to-day change in the rate
    // doesn't cause the sampled noise field (and therefore any detected
    // ULL cores) to jump discontinuously.
    this._ullDriftAccumulated += this._ullDriftPrev * dtSinceLast;
    if (dtSinceLast > 0 && this._waveBreakingActive) {
      const decayFactor = Math.pow(0.5, dtSinceLast / ENV.waveBreakingDecayHalfLifeDays);
      let anyLeft = false;
      for (let i = 0; i < this.n; i++) {
        this.waveBreakingShear[i] *= decayFactor;
        if (this.waveBreakingShear[i] > 0.01) anyLeft = true;
      }
      this._waveBreakingActive = anyLeft;
    }

    if (this.userFeatures.length) {
      this.userFeatures = this.userFeatures.filter(
        (f) => dayNum - f.spawnDay < SPAWN.featureLifetimeDays
      );
    }
    if (dtSinceLast > 0) {
      const troughDecay = Math.pow(0.5, dtSinceLast / 4); // ~4-day half-life back toward neutral (1x)
      for (let ti = 0; ti < this.troughUserMultiplier.length; ti++) {
        this.troughUserMultiplier[ti] = 1 + (this.troughUserMultiplier[ti] - 1) * troughDecay;
      }
    }
    this._lastUpdateDay = dayNum;
    this._mdrEastAtlAnomalyPrev = this.mdrEastAtlAnomaly;

    const ensoIdx = this.osc.ensoIndex(dayNum);
    const ensoSst = this.osc.ensoSstAnomaly(dayNum);
    const ensoShear = this.osc.ensoShearAnomaly(dayNum);
    const naoIdx = this.osc.naoIndex(dayNum);
    const amoIdx = this.osc.amoIndex;
    const seasonal = this.osc.climatologyBlendFactor(dayNum);
    // Seasonal trade wind speed — genuinely faster early season, relaxing
    // to a minimum around early September, and only partially recovering
    // late season (not back up to the early-season speed) — computed
    // once per tick rather than per cell.
    const doy = dayNum % 365;
    let tradeSeasonalKt;
    if (doy <= ENV.tradeSeasonTroughDay) {
      const t = Math.min(1, (ENV.tradeSeasonTroughDay - doy) / 130);
      tradeSeasonalKt = ENV.tradeEasterlyPeakSeasonKt + (ENV.tradeEasterlyEarlySeasonKt - ENV.tradeEasterlyPeakSeasonKt) * t;
    } else {
      const t = Math.min(1, (doy - ENV.tradeSeasonTroughDay) / 90);
      tradeSeasonalKt = ENV.tradeEasterlyPeakSeasonKt + (ENV.tradeEasterlyLateSeasonKt - ENV.tradeEasterlyPeakSeasonKt) * t;
    }
    const pattern = this._patternPerturbation(dayNum);

    this.troughCenters = this._troughCenterPositions(dayNum);
    this._stepExtratropicalLows(dayNum, dtSinceLast, rand);
    const highG0 = this._highFieldWithGrad(ENV.highLat, ENV.highLonPeak, seasonal, pattern, naoIdx);
    this.highCenter = {
      lat: highG0.latNow,
      lon: highG0.lonNow,
      strength: highG0.strength,
      pressureMb: Math.round(1013 + highG0.strength * 17),
    };
    // The Icelandic Low's own strength, scaled by NAO the same direction
    // the Azores-Bermuda high already responds to (+NAO deepens both,
    // -NAO weakens both — a genuine gradient/seesaw, not two independent
    // knobs).
    const icelandicLowStrength = Math.max(0.15, ENV.icelandicLowBaseStrength + naoIdx * ENV.icelandicLowNaoCoeff);
    this.icelandicLow = {
      lat: ENV.icelandicLowLat,
      lon: ENV.icelandicLowLon,
      strength: icelandicLowStrength,
      pressureMb: Math.round(1013 - icelandicLowStrength * 22),
    };
    this.ensoIndex = ensoIdx;
    this.naoIndex = naoIdx;

    for (let iLat = 0; iLat < GRID.nLat; iLat++) {
      const lat = this.latOf(iLat);
      // Capped at 45N on purpose — shear/dry-air/genesis climatology was
      // calibrated for the original 0-45N span; tropical cyclones don't
      // meaningfully operate north of there in this sim anyway, so
      // everything above 45N just holds at the "poleward" climatology
      // value rather than silently diluting toward the map's new, taller
      // extent (which exists for SST/land display up to Greenland, not
      // for cyclone physics).
      const latFrac = Math.min(1, (lat - GRID.lat0) / (ENV.sstClimatologyMidLat - GRID.lat0));
      // A SEPARATE, uncapped fraction spanning the full grid extent
      // (0-70N), used only for spatial noise-texture sampling (NAO
      // swath, hot pocket, shear noise, ULL, dry-air texture) — these
      // are visual/spatial variety, not climatology, and must keep
      // varying with real latitude all the way to the grid's edge.
      // Reusing the climatology-capped latFrac above for these (an
      // earlier bug) froze the noise pattern above 45N, which is exactly
      // what caused natural ULLs to appear in duplicate/triplet clusters
      // there — the local-max scan was finding several "peaks" along
      // what was really one frozen, latitude-flat ridge.
      const latFracFull = Math.min(1, (lat - GRID.lat0) / (GRID.lat1 - GRID.lat0));
      // Basin-scale MDR/East Atlantic SST anomaly feedback weight —
      // strongest in the tropics/subtropics, fading by MDRF.latWeightMaxLat.
      const mdrFeedbackWeight = Math.max(0, 1 - lat / MDRF.latWeightMaxLat);
      const mdrDryAirAdjust = -this._mdrEastAtlAnomalyPrev * MDRF.dryAirCoeffPerDegC * mdrFeedbackWeight;
      const mdrShearAdjust = -this._mdrEastAtlAnomalyPrev * MDRF.shearCoeffPerDegC * mdrFeedbackWeight;

      for (let iLon = 0; iLon < GRID.nLon; iLon++) {
        const lon = this.lonOf(iLon);
        const i = idx(iLat, iLon);

        // --- SST: seasonal climatology (normal-for-date, kept separately
        // for the anomaly overlay) + ENSO anomaly + NAO tropical/
        // subtropical dipole (-NAO warms the tropics, +NAO warms the
        // subtropics — the real NAO-SST relationship) + mild MJO cooling wake.
        const offSeasonSst = this._sstTwoSegment(lat, ENV.sstEquatorOffSeason, ENV.sstSubtropicalOffSeason, ENV.sstPolewardOffSeason, ENV.sstArcticOffSeason);
        const normalSst = lerp(offSeasonSst, this.sstBase[i], seasonal);
        this.sstNormal[i] = normalSst;
        const mjoFav = this.osc.mjoFavorability(lon, dayNum);

        // NAO SST tripole: three latitude bands of alternating sign,
        // each an independent Gaussian in latitude, textured by a slow
        // spatial noise field so the anomaly reads as organic swaths
        // rather than uniform stripes — see constants.js for the band
        // definitions.
        const swathU = ((lon - dayNum * 0.15 - GRID.lon0) / (GRID.lon1 - GRID.lon0)) * this._naoSwathNoise.w;
        const swathV = latFracFull * this._naoSwathNoise.h;
        const swathTexture = 1 + this._naoSwathNoise.sample(swathU, swathV) * OSC.naoSwathNoiseAmp;
        const band = (center, width, coeff) =>
          coeff * Math.exp(-0.5 * Math.pow((lat - center) / width, 2));
        const naoSstEffect = naoIdx * swathTexture * (
          band(OSC.naoBand1LatCenter, OSC.naoBand1Width, OSC.naoBand1CoeffC) +
          band(OSC.naoBand2LatCenter, OSC.naoBand2Width, OSC.naoBand2CoeffC) +
          band(OSC.naoBand3LatCenter, OSC.naoBand3Width, OSC.naoBand3CoeffC)
        );
        // AMO: basin-coherent (broad, not narrowly banded like the NAO
        // tripole terms), strongest over the tropics/MDR, genuinely
        // persistent state (see stepAmo in oscillations.js).
        const amoSstEffect = amoIdx * AMO.tropicalSstCoeffC *
          Math.exp(-0.5 * Math.pow((lat - AMO.tropicalCenterLat) / AMO.tropicalWidth, 2));

        // Localized "hot pockets" within the warm pool — real SST fields
        // aren't uniform; mesoscale eddies and shallow-mixed-layer patches
        // regularly push small areas 1C+ above their surroundings. Slow
        // spatial drift so the pattern evolves across a season rather than
        // flickering, and scaled by season + warm-pool proximity so it
        // only shows up where/when it's realistic.
        const hotU = ((lon - dayNum * 0.05 - GRID.lon0) / (GRID.lon1 - GRID.lon0)) * this._hotPocketNoise.w;
        const hotV = latFracFull * this._hotPocketNoise.h;
        const hotVal = Math.max(0, this._hotPocketNoise.sample(hotU, hotV));
        const dWarmLon = (lon - ENV.warmPoolLon) / ENV.warmPoolWidth;
        const warmPoolWeight = Math.exp(-dWarmLon * dWarmLon) * (1 - latFrac * 0.5);
        const hotPocket = hotVal * ENV.sstHotPocketAmp * warmPoolWeight * seasonal;

        // Weak 850mb trade flow -> less evaporative cooling/mixing ->
        // warmer MDR SST; strong flow -> the opposite. Uses last tick's
        // basin-average MDR 850mb magnitude (computed post-loop below,
        // same lagged pattern the MDR East-Atlantic SST feedback already
        // uses) since this tick's field isn't finished yet at this point
        // in the loop. Scoped to the MDR specifically via the same
        // latitude/longitude weighting the other MDR feedback uses.
        const trade850Deviation = ENV.steer850ReferenceMagnitudeKt - this._mdr850MagnitudePrev;
        const trade850SstEffect = trade850Deviation * ENV.steer850SstCoeffPerKt * mdrFeedbackWeight;

        this.sst[i] = normalSst + ensoSst + naoSstEffect - Math.max(0, -mjoFav) * 0.2 + hotPocket + amoSstEffect + trade850SstEffect;
        // Jagged display-only variant for the SST/anomaly overlays' fill
        // and contour lines — ocean-only (land cells stay unperturbed,
        // it'd be meaningless there) and only where there's actually
        // water to texture.
        const fineVal = this._fineTextureNoise._at(iLon, iLat); // raw lattice value, no interpolation
        this.sstDisplay[i] = this.sst[i] + fineVal * 0.22;

        // --- Upper-level height field: Bermuda high (+ pattern noise + NAO) + Icelandic Low (NAO's other half) + troughs + extratropical lows + user-spawned features
        const highG = this._highFieldWithGrad(lat, lon, seasonal, pattern, naoIdx);
        const troughG = this._troughFieldWithGrad(lat, lon, dayNum);
        const etlowG = this._extratropicalLowContribution(lat, lon);
        const userG = this._userFeatureContribution(lat, lon, dayNum);
        const dIceLat = lat - this.icelandicLow.lat, dIceLon = lon - this.icelandicLow.lon;
        const icelandicLowH = -this.icelandicLow.strength *
          Math.exp(-0.5 * (dIceLat * dIceLat + dIceLon * dIceLon) / (ENV.icelandicLowWidth * ENV.icelandicLowWidth));
        const h = highG.h + troughG.h + etlowG.h + userG.h + icelandicLowH;
        this.upperHeight[i] = Math.max(-1.4, Math.min(1.2, h));

        // --- Background/ambient MSLP: NOT the cause of subsidence/
        // divergence anomalies — the other way around (upper-level
        // ridging drives subsidence, which raises surface pressure; warm
        // SST/oceanic-atmospheric coupling drives divergence, which
        // lowers it). Higher background pressure -> stronger pressure
        // gradient -> a storm at a given central pressure can support
        // higher winds there (typically MDR/open Atlantic under a
        // healthy subtropical ridge). Lower background pressure ->
        // weaker gradient -> lower winds for the same central pressure
        // (typically Caribbean/Gulf/BoC, where warm SST locally
        // suppresses ambient MSLP even before any storm arrives).
        const bgRidgeMb = Math.max(0, highG.h) * ENV.bgPressureRidgeMbPerUnit;
        const bgTroughMb = Math.min(0, troughG.h) * ENV.bgPressureTroughMbPerUnit;
        const bgWarmSstMb = -Math.max(0, this.sst[i] - ENV.bgPressureSstBaselineC) * ENV.bgPressureSstMbPerDegC;
        this.bgPressureMb[i] = ENV.bgPressureReferenceMb + bgRidgeMb + bgTroughMb + bgWarmSstMb;

        // --- Shear: seasonal climatology + ENSO adjustment + MJO/CCKW
        // modulation + drifting noise + trough boost, reduced under the
        // ridge. Real MDR shear is genuinely mixed even in peak season —
        // the noise term alone (below) is large enough to swing a given
        // spot from favorable to hostile over a matter of days.
        const climLow = lerp(ENV.shearBaseLowOffSeason, ENV.shearBaseLowPeak, seasonal);
        const climHigh = lerp(ENV.shearBaseHighOffSeason, ENV.shearBaseHighPeak, seasonal);
        const climShear = lerp(climLow, climHigh, latFrac);
        const noiseU =
          ((lon - dayNum * ENV.shearNoiseDriftDegPerDay - GRID.lon0) / (GRID.lon1 - GRID.lon0)) *
          this._shearNoise.w;
        const noiseV = latFracFull * this._shearNoise.h;
        const shearNoiseVal = this._shearNoise.sample(noiseU, noiseV);
        const troughBoost = Math.max(0, -this.upperHeight[i]) * ENV.troughShearBoost;
        // Ridge suppression and MJO/CCKW "favorability" are real, but
        // both are fundamentally tropical/subtropical mechanisms — a
        // transient ridge or a favorable MJO phase doesn't meaningfully
        // cut into the jet's own structural vertical shear at high
        // latitude the way it can suppress shear in the deep tropics.
        // Without tapering these, the sim could produce mid-latitude
        // pockets of very low shear sitting right next to (or under) very
        // strong upper-level westerlies — physically inconsistent, since
        // shear IS the difference between the fast upper flow and the
        // much slower surface flow near the jet.
        const midLatTaper = Math.max(0, 1 - Math.max(0, lat - ENV.midLatShearTaperStartLat) / ENV.midLatShearTaperWidthDeg);
        const ridgeSuppression = Math.max(0, this.upperHeight[i]) * 3.5 * midLatTaper;
        // ENSO's shear effect is strongest over the tropical Atlantic/Caribbean
        // (low latitude), tapering at higher latitude — matches the real pattern.
        const ensoLatWeight = Math.max(0, 1 - latFrac * 1.3);
        // El Nino's shear enhancement (and La Nina's suppression) over
        // the Atlantic is strongest over the western basin — western
        // Atlantic, Caribbean, and western MDR — not uniform across the
        // whole basin; it tapers noticeably by the time you reach the
        // eastern MDR/East Atlantic.
        const ensoLonWeight = Math.max(0.35, 1 - Math.max(0, lon + 50) / 60);
        const mjoCckwFav = this.osc.combinedFavorability(lon, dayNum); // [-1,1]
        const mjoShearAdjust = -mjoCckwFav * ENV.shearMjoCckwCoeffKt * midLatTaper;

        // TUTT: semi-permanent subtropical shear source, present through
        // peak season, distinct from the transient traveling troughs
        // above. Real TUTTs are themselves ENSO-modulated — El Nino
        // years see a more active/persistent TUTT (part of the same
        // large-scale upper-level pattern that raises shear generally);
        // La Nina years see it weaker and less reliably present.
        const tuttSeasonDist = Math.abs((dayNum % 365) - ENV.tuttPeakDayOfYear);
        const tuttSeasonal = ENV.tuttFloor + (1 - ENV.tuttFloor) *
          Math.exp(-0.5 * Math.pow(tuttSeasonDist / ENV.tuttSeasonWidth, 2));
        const tuttEnsoFactor = Math.max(0.25, 1 + ensoIdx * ENV.tuttEnsoCoeff);
        const dTutt = Math.hypot(lat - ENV.tuttLat, lon - ENV.tuttLon);
        const tuttBoost = Math.exp(-0.5 * Math.pow(dTutt / ENV.tuttWidth, 2)) * ENV.tuttShearBoost * tuttSeasonal * tuttEnsoFactor;

        // Upper-level lows: thresholded noise -> sharp, episodic pockets
        // rather than smooth continuous variation.
        const ullU = ((lon - this._ullDriftAccumulated - GRID.lon0) / (GRID.lon1 - GRID.lon0)) * this._ullNoise.w;
        const ullV = latFracFull * this._ullNoise.h;
        const ullVal = this._ullNoise.sample(ullU, ullV);
        const ullBoost = Math.max(0, ullVal - ENV.ullThreshold) / (1 - ENV.ullThreshold) * ENV.ullMaxBoost;
        this.ullBoostField[i] = ullBoost;

        // Storm-induced wave-breaking wake (genuinely stateful, deposited
        // by storm.js, decayed just below).
        const wakeBoost = this.waveBreakingShear[i];

        // Late-season (Oct-Dec) shear increase specifically over the
        // central/eastern MDR — a real, distinct climatological pattern,
        // not just the generic "off-season = more shear everywhere" the
        // symmetric seasonal blend above already captures. This is what
        // actually shuts down Cabo Verde-type genesis by November in a
        // normal year (real activity shifts toward the Caribbean/Gulf/
        // subtropics instead), and the general seasonal climatology
        // alone doesn't reproduce it since it treats early- and late-
        // season as equally "off-peak."
        const lateSeasonDoy = dayNum % TIME.daysPerYear;
        const lateSeasonRamp = Math.max(0, Math.min(1, (lateSeasonDoy - ENV.lateSeasonMdrShearStartDoy) / ENV.lateSeasonMdrShearRampDays));
        const eMdrDLon = (lon - ENV.lateSeasonMdrShearLonCenter) / ENV.lateSeasonMdrShearLonWidth;
        const eMdrDLat = (lat - ENV.lateSeasonMdrShearLatCenter) / ENV.lateSeasonMdrShearLatWidth;
        const eMdrWeight = Math.exp(-0.5 * (eMdrDLon * eMdrDLon + eMdrDLat * eMdrDLat));
        const lateSeasonMdrShearBoost = lateSeasonRamp * eMdrWeight * ENV.lateSeasonMdrShearBoostKt;

        const clim = Math.max(
          2,
          climShear + shearNoiseVal * ENV.shearNoiseAmp * 0.5 + troughBoost - ridgeSuppression +
            ensoShear * ensoLatWeight * ensoLonWeight + mjoShearAdjust + tuttBoost + ullBoost + wakeBoost + mdrShearAdjust +
            lateSeasonMdrShearBoost
        );
        this.shearClim[i] = clim;
        this.shear[i] = Math.max(1, clim + this.shearUserAnomaly[i]);

        // --- Dry air / relative humidity: baseline noise + a basin-scale
        // east-west gradient (dry near Africa, progressively moister
        // toward the western Atlantic/Caribbean — not just a localized
        // effect right at the coast) + discrete traveling SAL outbreak
        // pulses (episodic plumes, not a static haze) + mid-latitude
        // trough dry-air entrainment.
        const dryU =
          ((lon - dayNum * ENV.dryAirDriftDegPerDay - GRID.lon0) / (GRID.lon1 - GRID.lon0)) *
          this._dryNoise.w;
        const dryV = latFracFull * this._dryNoise.h;
        const dryNoiseVal = (this._dryNoise.sample(dryU, dryV) + 1) / 2;
        // Basin-scale gradient: 1 at the African coast, decaying gradually
        // across most of the basin (not clipped to zero a third of the
        // way across), so the eastern Atlantic reads persistently drier
        // than the western Atlantic even away from discrete pulses.
        const distFromAfrica = ENV.africanCoastLon - lon;
        const eastWestGradient = Math.max(0, 1 - distFromAfrica / ENV.dryAirEastWestSpanDeg);
        const combinedFav = this.osc.combinedFavorability(lon, dayNum);
        const salDoyDist = Math.abs((dayNum % 365) - ENV.salPeakDayOfYear);
        const salSeasonal = ENV.salFloor + (ENV.salPeakStrength - ENV.salFloor) *
          Math.exp(-0.5 * Math.pow(salDoyDist / ENV.salWidth, 2));

        // Traveling SAL pulses: 2-3 overlapping generations, each a
        // Gaussian plume in longitude that emerged from the African coast
        // at some past day and has been drifting/weakening since.
        let salPulse = 0;
        for (let k = 0; k < 3; k++) {
          const age = (dayNum % ENV.salPulseIntervalDays) + k * ENV.salPulseIntervalDays;
          if (age > ENV.salPulseLifetimeDays) continue;
          const pulseLon = ENV.africanCoastLon - age * ENV.salPulseSpeedDegPerDay;
          const dLonPulse = lon - pulseLon;
          const ageDecay = Math.exp(-age / (ENV.salPulseLifetimeDays * 0.45));
          const lonEnvelope = Math.exp(-0.5 * Math.pow(dLonPulse / ENV.salPulseWidthDeg, 2));
          salPulse += ageDecay * lonEnvelope;
        }
        const latEnvelope = Math.exp(-0.5 * Math.pow((lat - ENV.salPulseLatCenter) / ENV.salPulseLatWidth, 2));
        const salPulseTerm = salPulse * latEnvelope * ENV.salPulseStrength * salSeasonal;

        // Mid-latitude troughs entrain dry air southward into the
        // tropics/subtropics ahead of/around them — reuse the same
        // trough-center distance concept the shear boost above uses.
        let troughDryInjection = 0;
        for (const t of this.troughCenters) {
          const d = Math.hypot(lat - t.lat, lon - t.lon);
          if (d < ENV.dryAirTroughInjectionRadiusDeg) {
            troughDryInjection = Math.max(
              troughDryInjection,
              (1 - d / ENV.dryAirTroughInjectionRadiusDeg) * t.strength * ENV.dryAirTroughInjectionMax
            );
          }
        }

        // Basin-scale MDR/East Atlantic SST anomaly feedback — strongest
        // in the tropics/subtropics, fading by MDRF.latWeightMaxLat.
        let dry = dryNoiseVal * ENV.dryAirNoiseWeight +
          eastWestGradient * ENV.dryAirContinentalStrength * salSeasonal +
          salPulseTerm + troughDryInjection -
          Math.max(0, combinedFav) * ENV.dryAirFavorableRelief + mdrDryAirAdjust;
        this.dryAir[i] = Math.max(0, Math.min(1, dry));

        // --- Steering + shear vector: both derived from the same
        // upper/lower wind decomposition. Steering uses the full geostrophic
        // wind; the shear *vector* (for rendering arrows) is upper-minus-lower,
        // normalized and scaled to the scalar shear magnitude above so
        // arrows visually track the same field storms actually feel.
        const dHdLon = highG.dHdLon + troughG.dHdLon + etlowG.dHdLon + userG.dHdLon;
        const dHdLat = highG.dHdLat + troughG.dHdLat + etlowG.dHdLat + userG.dHdLat;
        const geoU = -dHdLat * ENV.steeringGeostrophicScale;
        const geoV = dHdLon * ENV.steeringGeostrophicScale;

        const tradeFalloff = Math.max(0, 1 - Math.pow(latFrac / 0.75, 1.6));
        // The western Caribbean/Bay of Campeche is a real steering "dead
        // zone" — trade winds are climatologically much weaker there than
        // over the open MDR, which is exactly why a storm that lingers in
        // that box gets an outsized chance at explosive intensification
        // (more time sitting over the warmest water with nothing pushing
        // it along).
        const wCaribDLon = (lon - ENV.wCaribbeanDeadZoneLon) / ENV.wCaribbeanDeadZoneWidthDeg;
        const wCaribDLat = (lat - ENV.wCaribbeanDeadZoneLat) / ENV.wCaribbeanDeadZoneWidthDeg;
        const wCaribWeight = Math.exp(-0.5 * (wCaribDLon * wCaribDLon + wCaribDLat * wCaribDLat));
        const tradeReduction = 1 - wCaribWeight * ENV.wCaribbeanDeadZoneStrength;
        const tropicalEasterly = -tradeSeasonalKt * (0.35 + 0.65 * tradeFalloff) * tradeReduction;
        // Mid-latitude prevailing westerlies: real trade easterlies (Hadley
        // cell) give way to Ferrel-cell-driven westerly flow around 28-30N
        // — a genuine wind *reversal*, not a fade to near-zero. Without
        // this, steering barely changed north of the subtropics, which is
        // exactly backwards from how the real atmosphere behaves there
        // and is part of why storms should visibly accelerate/reorient
        // once well poleward (on top of the separate jet-embedding effect).
        const westerlyOnset = Math.max(0, Math.min(1, (lat - ENV.westerlyOnsetLat) / ENV.westerlyRampWidthDeg));
        const midLatWesterly = ENV.midLatWesterlyKt * westerlyOnset;
        const tradeEasterly = tropicalEasterly * (1 - westerlyOnset) + midLatWesterly;
        // 500mb (mid-level) steering — what hurricanes/majors actually
        // follow. No high-frequency noise added directly here anymore;
        // that variability belongs to the separate 850mb layer below —
        // mid-level flow is genuinely smoother/more climatological,
        // which is also what real forecasters mean when they say a
        // major's steering is "in line with the pattern."
        this.steerU[i] = tradeEasterly + geoU;
        this.steerV[i] = geoV + 0.4;

        // 850mb (low-level) steering — what waves and weak TD/TS
        // systems actually follow. Real low-level trade flow has
        // genuinely more variance than mid-level flow: can surge past
        // 30kt in the MDR, or drop to nearly nothing, both of which
        // matter beyond just storm motion — weak 850mb flow means less
        // evaporative cooling/mixing, which is what actually links a
        // slack trade-wind period to a warmer MDR (see the SST feedback
        // a bit further down using this tick's field, lagged one tick
        // the same way the MDR SST feedback already does). Tapered out
        // toward the mid-latitudes, where storms are already
        // hurricane-strength (mostly 500mb-steered) by the time they
        // get there anyway.
        const lowLevelTaper = Math.max(0, 1 - Math.max(0, lat - ENV.steer850TaperMaxLat) / 10);
        const s850U =
          ((lon - dayNum * ENV.steerNoiseDriftDegPerDay - GRID.lon0) / (GRID.lon1 - GRID.lon0)) * this._steerNoiseU.w;
        const s850V = latFracFull * this._steerNoiseU.h;
        const noise850U = this._steerNoiseU.sample(s850U, s850V) * ENV.steer850NoiseAmpKt * lowLevelTaper;
        const noise850V = this._steerNoiseV.sample(s850U * 1.3, s850V) * ENV.steer850NoiseAmpKt * 0.6 * lowLevelTaper;
        this.steer850U[i] = tradeEasterly * ENV.steer850TradeMultiplier + geoU * 0.5 + noise850U;
        this.steer850V[i] = geoV * 0.5 + 0.4 + noise850V;

        // Upper wind ~ geostrophic (scaled up, that's the 200mb flow);
        // lower wind ~ trades. Shear vector = upper - lower.
        const upperU = geoU * 1.7, upperV = geoV * 1.7;
        // Jet stream: visual-only addition to the 200mb display field —
        // a band of strong westerlies whose latitude/strength responds to
        // NAO, with streak boosts near troughs (real jet streaks intensify
        // in the exit region ahead of a trough).
        const jetLatNow = ENV.jetLatBase + naoIdx * ENV.jetNaoLatShiftDeg;
        const jetProfile = Math.exp(-Math.pow((lat - jetLatNow) / ENV.jetWidthDeg, 2));
        let jetSpeed = (ENV.jetSpeedKt + naoIdx * ENV.jetNaoSpeedCoeffKt) * jetProfile;
        for (const t of this.troughCenters) {
          const d = Math.hypot(lat - t.lat, lon - (t.lon + 12)); // exit region east of the trough
          jetSpeed += ENV.jetStreakBoostKt * jetProfile * Math.exp(-Math.pow(d / ENV.jetStreakRadiusDeg, 2));
        }

        // Storm-induced upper-level outflow: a real, and visually obvious,
        // feature of any organized tropical cyclone — strong anticyclonic
        // divergence aloft, radiating outward from the storm center.
        // Visual-only (like the jet, doesn't feed back into steering/shear,
        // which are already calibrated), but this is what actually makes
        // active storms visibly perturb the 200mb field the way real
        // satellite/model 200mb charts show.
        let outflowU = 0, outflowV = 0;
        for (const storm of activeStorms) {
          const dLatS = lat - storm.lat, dLonS = lon - storm.lon;
          const dist = Math.hypot(dLatS, dLonS);
          const influenceRadius = 6 + storm.intensityKt / 22; // stronger storms outflow further
          if (dist > influenceRadius || dist < 0.25) continue;
          const falloff = Math.exp(-Math.pow(dist / influenceRadius, 2) * 1.4);
          const outflowMag = storm.intensityKt * 0.42 * falloff;
          outflowU += outflowMag * (dLonS / dist);
          outflowV += outflowMag * (dLatS / dist);
        }

        this.upperWindU[i] = upperU + jetSpeed + outflowU;
        this.upperWindV[i] = upperV + outflowV;
        this.jetU[i] = jetSpeed;
        const lowerU = tradeEasterly * 0.6, lowerV = 0.15;
        let svU = upperU - lowerU, svV = upperV - lowerV;
        const svMag = Math.hypot(svU, svV) || 1;
        this.shearVecU[i] = (svU / svMag) * this.shear[i];
        this.shearVecV[i] = (svV / svMag) * this.shear[i];
      }
    }

    // Compute this tick's basin-average MDR/East Atlantic SST anomaly for
    // NEXT tick's feedback (see MDR_FEEDBACK in constants.js) — done once
    // here rather than restructuring the loop above into two passes.
    {
      let sum = 0, count = 0;
      for (let iLat = 0; iLat < GRID.nLat; iLat++) {
        const lat = this.latOf(iLat);
        if (lat < MDRF.boxLatMin || lat > MDRF.boxLatMax) continue;
        for (let iLon = 0; iLon < GRID.nLon; iLon++) {
          const lon = this.lonOf(iLon);
          if (lon < MDRF.boxLonMin || lon > MDRF.boxLonMax) continue;
          const i = idx(iLat, iLon);
          if (this.landMask[i] > 0.5) continue;
          sum += this.sst[i] - this.sstNormal[i];
          count++;
        }
      }
      this.mdrEastAtlAnomaly = count > 0 ? sum / count : 0;
    }

    // Same idea for this tick's basin-average 850mb trade-flow magnitude
    // in the MDR, for next tick's SST feedback above (weak trades ->
    // warmer MDR, strong trades -> cooler).
    {
      let sum = 0, count = 0;
      for (let iLat = 0; iLat < GRID.nLat; iLat++) {
        const lat = this.latOf(iLat);
        if (lat < MDRF.boxLatMin || lat > MDRF.boxLatMax) continue;
        for (let iLon = 0; iLon < GRID.nLon; iLon++) {
          const lon = this.lonOf(iLon);
          if (lon < MDRF.boxLonMin || lon > MDRF.boxLonMax) continue;
          const i = idx(iLat, iLon);
          if (this.landMask[i] > 0.5) continue;
          sum += Math.hypot(this.steer850U[i], this.steer850V[i]);
          count++;
        }
      }
      this._mdr850MagnitudePrev = count > 0 ? sum / count : this._mdr850MagnitudePrev;
    }

    // Compute this tick's average subtropical steering flow (roughly the
    // latitude band ULLs actually occur in, given the ullMaxLon
    // restriction above) for NEXT tick's ULL drift rate — real ULLs
    // move with the broader steering pattern, not at a fixed constant
    // speed regardless of what the actual flow looks like that day.
    {
      let sumU = 0, count = 0;
      for (let iLat = 0; iLat < GRID.nLat; iLat++) {
        const lat = this.latOf(iLat);
        if (lat < 20 || lat > 34) continue;
        for (let iLon = 0; iLon < GRID.nLon; iLon++) {
          const lon = this.lonOf(iLon);
          if (lon > ENV.ullMaxLon + 15 || lon < GRID.lon0) continue;
          const i = idx(iLat, iLon);
          if (this.landMask[i] > 0.5) continue;
          sumU += this.steerU[i];
          count++;
        }
      }
      // steerU is in kt; convert to a degrees-longitude-per-day drift
      // rate the same way storm motion does, keeping a sensible floor so
      // it never goes fully stationary or reverses direction outright.
      const avgSteerKt = count > 0 ? sumU / count : -ENV.ullDriftDegPerDay * 24;
      this._ullDriftPrev = Math.max(0.6, (-avgSteerKt * 24) / 55);
    }

    // Detect natural ULL cores (local maxima in the ULL field above a
    // real-core threshold) so they're visible on the map, not just an
    // invisible contribution buried in the total shear number — a coarse
    // scan with simple distance-based deduplication, capped at a few
    // concurrent cores so the map doesn't get cluttered. Only re-run once
    // per simulated day (not every 6h tick) — natural ULLs drift slowly,
    // and the scan itself isn't free.
    if (this._lastUllScanDay == null || dayNum - this._lastUllScanDay >= 1) {
      this._lastUllScanDay = dayNum;
      const markerThreshold = ENV.ullMaxBoost * 0.62;
      const candidates = [];
      const stride = 2;
      for (let iLat = stride; iLat < GRID.nLat - stride; iLat += stride) {
        for (let iLon = stride; iLon < GRID.nLon - stride; iLon += stride) {
          const i = idx(iLat, iLon);
          const v = this.ullBoostField[i];
          if (v < markerThreshold) continue;
          if (this.landMask[i] > 0.5) continue;
          if (this.lonOf(iLon) > ENV.ullMaxLon) continue;
          // local-max check within a small window
          let isMax = true;
          for (let dLat = -stride; dLat <= stride && isMax; dLat++) {
            for (let dLon = -stride; dLon <= stride; dLon++) {
              if (dLat === 0 && dLon === 0) continue;
              const ni = idx(iLat + dLat, iLon + dLon);
              if (this.ullBoostField[ni] > v) { isMax = false; break; }
            }
          }
          if (isMax) candidates.push({ lat: this.latOf(iLat), lon: this.lonOf(iLon), strength: v });
        }
      }
      candidates.sort((a, b) => b.strength - a.strength);
      const cores = [];
      for (const c of candidates) {
        if (cores.length >= 3) break;
        if (cores.some((k) => Math.hypot(k.lat - c.lat, k.lon - c.lon) < 8)) continue;
        cores.push(c);
      }
      this.naturalUlls = cores;
    }
  }

  // --- interactive shear painting ---
  paintShear(lat, lon, radiusDeg, deltaKt, maxAbs) {
    for (let iLat = 0; iLat < GRID.nLat; iLat++) {
      const cellLat = this.latOf(iLat);
      const dLat = cellLat - lat;
      if (Math.abs(dLat) > radiusDeg) continue;
      for (let iLon = 0; iLon < GRID.nLon; iLon++) {
        const cellLon = this.lonOf(iLon);
        const dLon = cellLon - lon;
        const d = Math.hypot(dLat, dLon);
        if (d > radiusDeg) continue;
        const falloff = 1 - d / radiusDeg;
        const i = idx(iLat, iLon);
        const next = this.shearUserAnomaly[i] + deltaKt * falloff;
        this.shearUserAnomaly[i] = Math.max(-maxAbs, Math.min(maxAbs, next));
      }
    }
  }

  clearShearPaint() { this.shearUserAnomaly.fill(0); }

  // Places a user-controlled extratropical low directly — distinct from
  // an upper low (ULL, shear-only) and from the automatically-generated
  // ones below: this is a genuine surface-level low with its own front.
  spawnUserExtratropicalLow(lat, lon, dayNum) {
    this.extratropicalLows.push({
      lat, lon, strength: ETLOW.strength * 1.3, spawnDay: dayNum,
      pressureMb: Math.round(1013 - ETLOW.strength * 1.3 * 20), userSpawned: true,
    });
  }

  // Natural spawning: when a trough is far enough poleward and there's
  // room under the active cap, it can spin up its own surface-level
  // reflection — a real, common synoptic pattern (surface low forms
  // near/ahead of the upper trough axis), but tracked as its own object
  // with its own lifespan from here on, not tied to the trough's fate.
  _stepExtratropicalLows(dayNum, dtDays, rand) {
    this.extratropicalLows = this.extratropicalLows.filter(
      (l) => dayNum - l.spawnDay < ETLOW.lifetimeDays
    );
    if (this.extratropicalLows.length >= ETLOW.maxActive) return;
    for (const t of this.troughCenters) {
      if (t.lat < ETLOW.spawnMinLat) continue;
      if (rand() > ETLOW.spawnChancePerTick) continue;
      this.extratropicalLows.push({
        lat: t.lat + (rand() - 0.5) * ETLOW.spawnOffsetLatDeg,
        lon: t.lon + ETLOW.spawnOffsetLonDeg * (0.5 + rand()),
        strength: ETLOW.strength * (0.8 + rand() * 0.5),
        spawnDay: dayNum,
        pressureMb: Math.round(1013 - ETLOW.strength * 20),
        userSpawned: false,
      });
      break; // at most one new spawn per tick
    }
  }

  _extratropicalLowContribution(lat, lon) {
    let h = 0, dHdLon = 0, dHdLat = 0;
    for (const l of this.extratropicalLows) {
      const dLat = lat - l.lat, dLon = lon - l.lon;
      const R2 = ETLOW.radiusDeg * ETLOW.radiusDeg;
      const r2 = dLat * dLat + dLon * dLon;
      const hi = -l.strength * Math.exp(-r2 / (2 * R2));
      h += hi;
      dHdLon += -hi * dLon / R2;
      dHdLat += -hi * dLat / R2;
    }
    return { h, dHdLon, dHdLat };
  }

  // Strengthens/weakens whichever natural trough is nearest the given
  // point — distinct from painting a local shear anomaly or spawning a
  // brand new upper low: this adjusts an existing trough's own strength
  // directly. Decays back toward 1x over time (see update()) so it's a
  // nudge, not a permanent override of the trough's natural evolution.
  adjustNearestTrough(lat, lon, deltaMultiplier) {
    if (!this.troughCenters.length) return;
    let nearestIdx = 0, nearestDist = Infinity;
    this.troughCenters.forEach((t, i) => {
      const d = Math.hypot(t.lat - lat, t.lon - lon);
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    });
    const current = this.troughUserMultiplier[nearestIdx] ?? 1;
    this.troughUserMultiplier[nearestIdx] = Math.max(0.15, Math.min(2.5, current + deltaMultiplier));
  }

  // Places a user-controlled upper low ('low', weakens the ridge locally
  // and boosts shear — real cutoff-low behavior) or ridge ('high', boosts
  // steering and suppresses shear locally), decaying over
  // SPAWN.featureLifetimeDays.
  spawnFeature(type, lat, lon, dayNum) {
    const strength = type === 'low' ? SPAWN.upperLowStrength : SPAWN.ridgeStrength;
    const radius = type === 'low' ? SPAWN.upperLowRadiusDeg : SPAWN.ridgeRadiusDeg;
    this.userFeatures.push({ type, lat, lon, strength, radius, spawnDay: dayNum });
  }

  _userFeatureContribution(lat, lon, dayNum) {
    let h = 0, dHdLon = 0, dHdLat = 0;
    for (const f of this.userFeatures) {
      const age = dayNum - f.spawnDay;
      const ageFade = 1 - age / SPAWN.featureLifetimeDays; // linear fade-out
      const sign = f.type === 'low' ? -1 : 1;
      const dLat = lat - f.lat, dLon = lon - f.lon;
      const R2 = f.radius * f.radius;
      const r2 = dLat * dLat + dLon * dLon;
      const hi = sign * f.strength * ageFade * Math.exp(-r2 / (2 * R2));
      h += hi;
      dHdLon += -hi * dLon / R2;
      dHdLat += -hi * dLat / R2;
    }
    return { h, dHdLon, dHdLat };
  }

  // Called by a recurving/jet-embedded storm to leave a temporary shear
  // "wake" behind it — see storm.js. Additive with a cap so repeated
  // deposits from a slow-moving storm don't run away.
  injectWaveBreaking(lat, lon, amountKt) {
    this._waveBreakingActive = true;
    const r = ENV.waveBreakingDepositRadiusDeg;
    const iLatMin = Math.max(0, Math.round(lat - r - GRID.lat0));
    const iLatMax = Math.min(GRID.nLat - 1, Math.round(lat + r - GRID.lat0));
    const iLonMin = Math.max(0, Math.round(lon - r - GRID.lon0));
    const iLonMax = Math.min(GRID.nLon - 1, Math.round(lon + r - GRID.lon0));
    for (let iLat = iLatMin; iLat <= iLatMax; iLat++) {
      const cellLat = this.latOf(iLat);
      const dLat = cellLat - lat;
      for (let iLon = iLonMin; iLon <= iLonMax; iLon++) {
        const cellLon = this.lonOf(iLon);
        const dLon = cellLon - lon;
        const d = Math.hypot(dLat, dLon);
        if (d > r) continue;
        const falloff = 1 - d / r;
        const i = idx(iLat, iLon);
        this.waveBreakingShear[i] = Math.min(ENV.waveBreakingMaxKt, this.waveBreakingShear[i] + amountKt * falloff);
      }
    }
  }

  _clampIdx(lat, lon) {
    let iLat = Math.round((lat - GRID.lat0) / GRID.res);
    let iLon = Math.round((lon - GRID.lon0) / GRID.res);
    iLat = Math.max(0, Math.min(GRID.nLat - 1, iLat));
    iLon = Math.max(0, Math.min(GRID.nLon - 1, iLon));
    return { iLat, iLon };
  }

  // ITCZ (Intertropical Convergence Zone) — the belt of low-level
  // convergence between the NE and SE trade winds. Doesn't itself
  // contain a closed circulation, but is a genuinely favorable band for
  // disturbance development, and its position migrates seasonally with
  // the sun — further north (~10-11N) near peak season, closer to the
  // equator (~5N) in the off-season. Real Atlantic climatology.
  itczLat(dayNum) {
    return 5 + this.osc.seasonalFactor(dayNum) * 6;
  }

  // Caribbean monsoon trough — a real, distinct feature from the ITCZ:
  // broader, can sit well away from the equator, and (unlike the ITCZ)
  // often contains embedded vorticity/disturbances of its own. Not
  // permanent even within its active season — genuinely weakens,
  // shifts, and can temporarily all but disappear, on top of (not
  // instead of) the seasonal envelope below.
  //
  // Seasonal shape, per real Atlantic climatology: May ramps up,
  // Jun-Sep is strongest, Oct-Nov remains genuinely active (important
  // for late-season development) but tapering and more variable,
  // Dec-Apr usually weak/absent (a low baseline, not a hard zero —
  // "usually" isn't "never").
  _monsoonTroughSeasonalEnvelope(doy) {
    if (doy >= 121 && doy < 152) { // May: ramping up
      const t = (doy - 121) / 31;
      return 0.25 + t * 0.55;
    }
    if (doy >= 152 && doy < 274) { // Jun-Sep: strongest, peak ~Aug 1
      const distFromPeak = Math.abs(doy - 213) / 61;
      return Math.max(0.78, 1 - distFromPeak * 0.22);
    }
    if (doy >= 274 && doy < 335) { // Oct-Nov: still active, tapering
      const t = (doy - 274) / 61;
      return 0.78 - t * 0.55;
    }
    return 0.06; // Dec-Apr: usually weak/absent, low baseline
  }

  monsoonTroughStrength(dayNum) {
    const doy = dayNum % 365;
    const envelope = this._monsoonTroughSeasonalEnvelope(doy);
    // Real week-to-week variability layered on top of the seasonal
    // shape — the actual mechanism behind "even during its active
    // season it can weaken, shift, or temporarily disappear," not just
    // a smooth curve that only changes with the calendar.
    const noiseU = (dayNum * ENV.monsoonTroughNoiseDriftDegPerDay) % this._monsoonTroughNoiseStr.w;
    const noiseVal = this._monsoonTroughNoiseStr.sample(noiseU, 0);
    const variability = Math.max(0.05, 1 + noiseVal * ENV.monsoonTroughVariabilityAmp);
    return Math.max(0, envelope * variability);
  }

  // The trough is anchored on Central America/the southwestern
  // Caribbean, not spread evenly across "the Caribbean" as a whole —
  // but genuinely migrates, extending further east or north depending
  // on the larger atmospheric pattern on a given day, rather than
  // sitting in one fixed box all season.
  monsoonTroughGeometry(dayNum) {
    const extentU = (dayNum * ENV.monsoonTroughNoiseDriftDegPerDay * 0.7) % this._monsoonTroughNoiseExtent.w;
    const extentNoise = Math.max(0, this._monsoonTroughNoiseExtent.sample(extentU, 0));
    const eastExtension = extentNoise * ENV.monsoonTroughMaxEastExtensionDeg;
    const northExtension = extentNoise * ENV.monsoonTroughMaxNorthExtensionDeg;
    return {
      latCenter: ENV.monsoonTroughBaseLat + northExtension * 0.5,
      lonCenter: ENV.monsoonTroughBaseLon + eastExtension * 0.5,
      latHalfExtent: ENV.monsoonTroughBaseLatHalfExtent + northExtension * 0.5,
      lonHalfExtent: ENV.monsoonTroughBaseLonHalfExtent + eastExtension,
    };
  }

  stateAt(lat, lon) {
    const { iLat, iLon } = this._clampIdx(lat, lon);
    const i = idx(iLat, iLon);
    return {
      sst: this.sst[i],
      sstNormal: this.sstNormal[i],
      shear: this.shear[i],
      upperHeight: this.upperHeight[i],
      bgPressureMb: this.bgPressureMb[i],
      dryAir: this.dryAir[i],
      steerU: this.steerU[i],
      steerV: this.steerV[i],
      steer850U: this.steer850U[i],
      steer850V: this.steer850V[i],
      shearVecU: this.shearVecU[i],
      shearVecV: this.shearVecV[i],
      jetU: this.jetU[i],
      land: this.landMask[i],
    };
  }
}

export { idx as gridIndex };
