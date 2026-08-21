// waves.js — "invisible" tropical waves that seed genesis.
//
// Rather than letting storms spin up anywhere at random, we spawn periodic
// disturbances at an upstream (eastern) source that drift westward, like a
// simplified African-easterly-wave analog. Storms can only form on top of
// an active wave, and only where/when the environment (GPI) is favorable.
// This gives genesis a rhythm tied to the wave interval instead of feeling
// like uniform noise.

import { GRID, GENESIS as GEN, AMO } from './constants.js';

const KT_TO_DEG_LON_PER_DAY = (kt, lat) => {
  // 1 degree longitude ≈ 60nm * cos(lat); kt = nm/hr
  const nmPerDegLon = 60 * Math.cos((lat * Math.PI) / 180);
  return (kt * 24) / Math.max(10, nmPerDegLon);
};
const KT_TO_DEG_LAT_PER_DAY = (kt) => (kt * 24) / 60; // 60nm per degree lat

export class TropicalWave {
  constructor(lat, lon, bornDay) {
    this.lat = lat;
    this.lon = lon;
    this.bornDay = bornDay;
    this.alive = true;
    this.spawned = false; // becomes true once it produces a storm (then retires)
    this.landDisruption = 0; // accumulates while over land, decays while over water — see genesisPotential's use of it
  }

  // Real waves aren't immune to the large-scale steering flow they're
  // embedded in — a weakness (gap) in the subtropical ridge can pull a
  // wave poleward well before it ever organizes into a storm, and a
  // genuinely weak Azores-Bermuda high (-NAO) makes that easier/earlier,
  // a strong one (+NAO) makes it later/rarer. Blends the traditional
  // climatological westward drift with the real local steering field
  // (which already reflects whatever ridge weakness is actually
  // present) plus an explicit NAO-modulated poleward bias that only
  // engages once the wave is far enough from the deep tropics for
  // recurvature to be physically plausible at all.
  step(dtDays, env, naoIdx = 0) {
    const baselineUKt = -GEN.waveSpeedKt;
    let uKt = baselineUKt, vKt = 0;
    if (env) {
      const s = env.stateAt(this.lat, this.lon);
      // Real disruption from crossing significant land lingers rather
      // than resetting instantly the moment the wave clears back over
      // water — accumulates while over land, decays gradually
      // afterward. See genesisPotential's use of this in waves.js.
      if (s.land > 0.3) {
        this.landDisruption = Math.min(1, this.landDisruption + dtDays * GEN.landDisruptionAccumPerDay);
      } else {
        this.landDisruption = Math.max(0, this.landDisruption - dtDays * GEN.landDisruptionRecoveryPerDay);
      }
      // Waves use the 850mb (low-level) layer specifically — the real
      // fix for wave/weak-storm tracks having felt too erratic after
      // steering noise was added directly to a single shared field
      // (that variability now lives here, and is the actual physically-
      // correct layer for a wave/TD-strength system to follow anyway).
      uKt = baselineUKt * (1 - GEN.waveSteeringBlendWeight) + s.steer850U * GEN.waveSteeringBlendWeight;
      vKt = s.steer850V * GEN.waveSteeringBlendWeight;
      const recurveLatFactor = Math.max(0, Math.min(1, (this.lat - GEN.waveRecurveLatStart) / GEN.waveRecurveLatRamp));
      vKt += Math.max(0, -naoIdx) * GEN.waveNaoRecurveCoeffKt * recurveLatFactor;
    }
    this.lon += KT_TO_DEG_LON_PER_DAY(uKt, this.lat) * dtDays;
    this.lat += KT_TO_DEG_LAT_PER_DAY(vKt) * dtDays;
    if (this.lon < GRID.lon0 - 2) this.alive = false;
  }
}

export class WaveSource {
  constructor(rand = Math.random, osc = null) {
    this.rand = rand;
    this.osc = osc;
    this.waves = [];
    this._lastSpawnDay = -999;
  }

  maybeSpawn(dayNum, env) {
    const seasonal = this.osc ? this.osc.seasonalFactor(dayNum) : 1;
    if (seasonal <= 0) return; // hard outside the genesis season window
    let interval =
      GEN.waveIntervalDaysOffSeason -
      (GEN.waveIntervalDaysOffSeason - GEN.waveIntervalDaysPeak) * seasonal;
    // AMO directly modulates genesis frequency (+AMO -> more storms,
    // -AMO -> fewer), on top of whatever it's already doing to SST —
    // real active/quiet AMO regimes affect Atlantic activity through more
    // than just thermodynamics (large-scale circulation response too),
    // so this is a deliberate direct effect, not just an SST side-effect.
    const amoIdx = this.osc ? this.osc.amoIndex : 0;
    interval *= 1 - amoIdx * AMO.waveIntervalShiftFrac;
    // ENSO and MDR SST anomaly directly modulate genesis frequency too —
    // this is the real mechanism behind season-to-season variance: a
    // -ENSO (La Nina, also correlates with lower MDR shear via the
    // existing ENSO-shear coupling) and/or a warm MDR/East-Atlantic
    // anomaly (also covers "warm Canary Current" — same region) season
    // should look *meaningfully* more active than a +ENSO/cool-MDR one,
    // not just have slightly nudged odds.
    if (env) {
      const ensoIdx = this.osc ? this.osc.ensoIndex(dayNum) : env.ensoIndex;
      interval *= 1 + ensoIdx * GEN.ensoWaveIntervalCoeff;
      interval *= 1 - env.mdrEastAtlAnomaly * GEN.mdrAnomalyWaveIntervalCoeff;
    }
    // MDR (easterly-wave) genesis tails off in explicit tiers rather
    // than one compounding rate: still ~often through Oct 15-Nov 1,
    // genuinely occasional Nov 1-15, only properly rare Nov 15-Dec 15
    // (held flat after — finer late-December+ tuning is deferred to a
    // dedicated genesis-focused pass rather than guessed at here).
    const doy = dayNum % 365;
    interval *= this._lateSeasonMultiplier(doy);
    interval = Math.max(1, interval);
    if (dayNum - this._lastSpawnDay >= interval) {
      const lat = this._spawnLat(doy);
      const lon = GEN.waveSourceLon;
      this.waves.push(new TropicalWave(lat, lon, dayNum));
      this._lastSpawnDay = dayNum;
    }
  }

  // Piecewise interval multiplier matching the explicit tiers described:
  // ~normal through Oct 15, gentle through Nov 1 ("still often"),
  // moderate through Nov 15 ("occasional"), and only reaching the
  // "rarer" ceiling by Dec 15 (held flat after that point).
  _lateSeasonMultiplier(doy) {
    if (doy <= GEN.mdrLateSeasonCutoffDoy) return 1;
    if (doy <= GEN.mdrLateSeasonNov1Doy) {
      const t = (doy - GEN.mdrLateSeasonCutoffDoy) / (GEN.mdrLateSeasonNov1Doy - GEN.mdrLateSeasonCutoffDoy);
      return 1 + t * (GEN.mdrLateSeasonMultAtNov1 - 1);
    }
    if (doy <= GEN.mdrLateSeasonNov15Doy) {
      const t = (doy - GEN.mdrLateSeasonNov1Doy) / (GEN.mdrLateSeasonNov15Doy - GEN.mdrLateSeasonNov1Doy);
      return GEN.mdrLateSeasonMultAtNov1 + t * (GEN.mdrLateSeasonMultAtNov15 - GEN.mdrLateSeasonMultAtNov1);
    }
    const t = Math.min(1, (doy - GEN.mdrLateSeasonNov15Doy) / (GEN.mdrLateSeasonDec15Doy - GEN.mdrLateSeasonNov15Doy));
    return GEN.mdrLateSeasonMultAtNov15 + t * (GEN.mdrLateSeasonMultAtDec15 - GEN.mdrLateSeasonMultAtNov15);
  }

  // Full seasonal structure: low riders early season (June), higher-
  // latitude emergence with meaningfully wider spread near peak season
  // (Aug-Sep) — letting both 20N+ emergence and low riders happen side
  // by side during peak, not just a shifted mean — then declining back
  // toward low riders late season (existing Nov1-Dec15 mechanic below,
  // unchanged).
  _spawnLat(doy) {
    const rampT = Math.max(0, Math.min(1,
      (doy - GEN.waveEarlySeasonRampStartDoy) / (GEN.waveEarlySeasonRampEndDoy - GEN.waveEarlySeasonRampStartDoy)));
    const seasonBaseLat = GEN.waveEarlySeasonBaseLat + (GEN.waveBaseLat - GEN.waveEarlySeasonBaseLat) * rampT;
    const seasonJitter = GEN.waveEarlySeasonJitterDeg + (GEN.wavePeakSeasonJitterDeg - GEN.waveEarlySeasonJitterDeg) * rampT;

    // Existing late-season decline, applied on top of whichever
    // seasonal base/jitter the ramp above produced — jitter also
    // tightens back toward early-season character late season, not
    // just the mean shifting.
    const t = Math.max(0, Math.min(1,
      (doy - GEN.waveLateSeasonLatShiftStartDoy) / (GEN.waveLateSeasonLatShiftFullDoy - GEN.waveLateSeasonLatShiftStartDoy)));
    const baseLat = seasonBaseLat + (GEN.waveLateSeasonBaseLat - seasonBaseLat) * t;
    // Bell-shaped rather than flat-uniform jitter — sum of two
    // independent draws, so spawns cluster toward the base latitude and
    // taper at the extremes instead of being equally likely anywhere in
    // the full range. A flat distribution was putting too many waves
    // right at the very low end (down to ~5.5N), a real weak-Coriolis
    // zone where genuine tropical development is inherently much less
    // likely — a real contributor to too many TDs dying before reaching
    // TS. Same total range as before, just realistically weighted.
    const jitter = seasonJitter + (GEN.waveEarlySeasonJitterDeg - seasonJitter) * t;
    const jitterDraw = ((this.rand() + this.rand()) - 1) * jitter;
    return baseLat + jitterDraw;
  }

  step(dtDays, env, dayNum) {
    const naoIdx = this.osc ? this.osc.naoIndex(dayNum) : 0;
    for (const w of this.waves) if (w.alive) w.step(dtDays, env, naoIdx);
    this.waves = this.waves.filter((w) => w.alive && !w.spawned);
  }
}

// Genesis Potential Index: combines SST, shear, dry air and large-scale
// convective favorability into a single 0..1 "is this a good spot/time"
// score. Loosely inspired by Emanuel-Nolan style GPI, heavily simplified.
export function genesisPotential(env, osc, lat, lon, dayNum, landDisruption = 0) {
  const s = env.stateAt(lat, lon);
  if (s.land > 0.3) return 0;

  const sstTerm = Math.max(0, (s.sst - GEN.minSstForGenesis) / 3); // ramps up over ~3C
  const shearTerm = Math.max(0, 1 - s.shear / GEN.maxShearForGenesis);
  const dryTerm = 1 - s.dryAir;
  const favTerm = (osc.combinedFavorability(lon, dayNum) + 1) / 2; // -> [0,1]

  let gpi =
    0.3 * Math.min(1, sstTerm) +
    0.3 * shearTerm +
    0.2 * dryTerm +
    0.2 * favTerm;

  // ITCZ proximity: a genuinely favorable convergence band even without
  // a closed circulation of its own, plus a stable-but-directional
  // "aid or delay" swing for wave interaction specifically — real ITCZ
  // interaction can either help a wave organize or disrupt it, not
  // uniformly one or the other. The swing is seeded from position/day
  // (not re-rolled every check) so it reads as a real, if unpredictable,
  // localized effect rather than flickering noise.
  const itczLat = env.itczLat(dayNum);
  const itczProximity = Math.max(0, 1 - Math.abs(lat - itczLat) / GEN.itczProximityDeg);
  if (itczProximity > 0) {
    gpi += itczProximity * GEN.itczGpiBoost;
    const swingSeed = Math.sin(lat * 12.9 + lon * 7.3 + Math.floor(dayNum / 2) * 3.1) * 43758.5453;
    const swing = (swingSeed - Math.floor(swingSeed)) * 2 - 1; // -> [-1, 1], stable per ~2-day window
    gpi += itczProximity * swing * GEN.itczWaveInteractionSwing;
  }

  // Caribbean monsoon trough: real, seasonal, distinct from the ITCZ —
  // a straightforward favorability boost when active and co-located
  // with its current (migrating, not fixed-box) footprint.
  const mtGeo = env.monsoonTroughGeometry(dayNum);
  if (Math.abs(lat - mtGeo.latCenter) <= mtGeo.latHalfExtent &&
      Math.abs(lon - mtGeo.lonCenter) <= mtGeo.lonHalfExtent) {
    gpi += env.monsoonTroughStrength(dayNum) * GEN.monsoonTroughGpiBoost;
  }

  // Coriolis constraint — real TC genesis is essentially impossible
  // very close to the equator (the spin-up a closed circulation needs
  // depends on the Coriolis parameter, which vanishes there) and only
  // becomes meaningfully favorable by roughly 8-10 degrees latitude.
  // This is a hard dynamical constraint, not something favorable SST/
  // shear/ITCZ convection should be able to override — applied
  // multiplicatively as a genuine gate, not an additive term the rest
  // of the formula could outweigh.
  const coriolisTerm = Math.max(0, Math.min(1, (Math.abs(lat) - 3) / 7));
  gpi *= coriolisTerm;

  // A wave that's recently crossed significant land (e.g., northern
  // South America) doesn't instantly regain full potential the moment
  // it clears the coast — real disruption from losing its low-level
  // moisture/structure over land lingers for a while. landDisruption is
  // an accumulated, decaying 0-1 value tracked per-wave (see
  // TropicalWave.step) and applied here as a genesis-potential penalty.
  gpi *= (1 - landDisruption * GEN.landDisruptionGpiPenalty);

  return Math.max(0, Math.min(1, gpi));
}

// NHC Tropical-Weather-Outlook-style formation odds: converts a wave's
// current GPI into approximate 48h / 7-day formation probabilities. Not a
// re-simulation — a monotonic mapping calibrated so a wave sitting right
// at the genesis threshold reads as a coin-flip on the longer window, and
// very favorable/hostile spots saturate toward the extremes, the same
// qualitative shape NHC's outlook percentages have relative to GPI-style
// indices in the literature.
export function formationOdds(gpi, gpiThreshold) {
  const margin = gpi - gpiThreshold;
  const logistic = (x, steep) => 1 / (1 + Math.exp(-x * steep));
  const odds7day = logistic(margin, 9) * 0.95;
  const odds48h = logistic(margin, 9) * 0.55; // shorter window is always lower odds
  return {
    pct48h: Math.round(Math.max(0, Math.min(100, odds48h * 100))),
    pct7day: Math.round(Math.max(0, Math.min(100, odds7day * 100))),
  };
}
