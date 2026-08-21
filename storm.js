// storm.js — a single tropical cyclone: position, intensity, and history.
//
// Intensity model (per tick):
//   1. Compute Maximum Potential Intensity (MPI) from local SST — the
//      thermodynamic ceiling the storm is trying to reach.
//   2. Compute how fast it can move toward that ceiling, penalized by
//      shear and dry mid-level air.
//   3. Apply trough interaction: very close to an upper trough axis, shear
//      dominates and this is captured already via env.shear. At a *moderate*
//      distance from a trough, real storms sometimes benefit from enhanced
//      upper-level outflow/divergence — we add a small intensification aid
//      in that band, and it decays outside it.
//   4. Land and cold water impose hard weakening rates that override the
//      intensification tendency.
//
// Motion model: steering flow (env.steerU/steerV) plus a constant
// poleward/westward "beta drift" that stronger/larger storms exhibit
// (beta-effect from the meridional gradient of planetary vorticity —
// simplified to a fixed nudge rather than solving vorticity advection).

import { GRID, ENVIRONMENT as ENV, STORM as ST, TRACK_WOBBLE as WOB, ERC, RI, SIZE as SZ, CAG, ET, OUTFLOW, REMNANT as REM } from './constants.js';
import { classify, windToPressureMb, windFromPressureMb } from './scale.js';

// MPI table: SST (deg C) -> [pressure mb, wind midpoint kt, wind half-
// width kt] at the theoretical absolute ceiling — calibrated directly to
// real analog storms per SST. This is NOT "what a storm in a favorable
// environment should reach" — it's the rarely-touched absolute ceiling
// assuming everything (ventilation, shear, moisture, ocean heat content)
// lines up essentially perfectly. Piecewise linear in SST; extrapolated
// beyond the table's ends using the nearest segment's slope.
const MPI_TABLE = [
  [24, 1015, 45, 8], [25, 990, 60, 5], [26, 960, 110, 5], [27, 930, 130, 5],
  [28, 900, 150, 5], [29, 880, 162.5, 7.5], [30, 860, 172.5, 7.5],
  [31, 840, 182.5, 7.5], [32, 822, 191, 8],
];

function interpMpiTable(sst) {
  if (sst <= MPI_TABLE[0][0]) return MPI_TABLE[0];
  for (let i = 1; i < MPI_TABLE.length; i++) {
    if (sst <= MPI_TABLE[i][0]) {
      const [s0, p0, w0, h0] = MPI_TABLE[i - 1];
      const [s1, p1, w1, h1] = MPI_TABLE[i];
      const t = (sst - s0) / (s1 - s0);
      return [sst, p0 + (p1 - p0) * t, w0 + (w1 - w0) * t, h0 + (h1 - h0) * t];
    }
  }
  const [s0, p0, w0, h0] = MPI_TABLE[MPI_TABLE.length - 2];
  const [s1, p1, w1, h1] = MPI_TABLE[MPI_TABLE.length - 1];
  const dt = sst - s1;
  const slopeP = (p1 - p0) / (s1 - s0), slopeW = (w1 - w0) / (s1 - s0), slopeH = (h1 - h0) / (s1 - s0);
  return [sst, p1 + slopeP * dt, w1 + slopeW * dt, h1 + slopeH * dt];
}

let _idCounter = 1;

const KT_TO_DEG_LAT_PER_DAY = (kt) => (kt * 24) / 60; // 60nm per degree lat
const KT_TO_DEG_LON_PER_DAY = (kt, lat) => {
  const nmPerDegLon = 60 * Math.cos((lat * Math.PI) / 180);
  return (kt * 24) / Math.max(10, nmPerDegLon);
};

export class Storm {
  constructor({ lat, lon, name = null, number, bornDay, initialIntensityKt = 28, subtropical = false, rand = Math.random, initialAgeDays = 0, ceilingBiasKt = 0 }) {
    this.id = _idCounter++;
    this.name = name; // null until (if ever) the storm reaches 34kt
    this.number = number; // "01L" etc. — assigned at genesis, always present
    this.lat = lat;
    this.lon = lon;
    this.intensityKt = initialIntensityKt;
    this.initialIntensityKt = initialIntensityKt;
    this.peakKt = initialIntensityKt;
    this.bornDay = bornDay;
    this.ageDays = initialAgeDays;
    this.dissipated = false;
    this.landfall = false;
    this.subtropical = subtropical;
    this.basin = 'atlantic'; // overridden to 'epac' by World.spawnStorm() for manually-placed Eastern Pacific systems
    this.origin = 'MDR';
    this.phase = 'tropical'; // 'tropical' | 'extratropical'
    this.etOnsetDay = null;
    this.absorptionProximityDays = 0;
    this.remnantUnfavorableDays = 0; // tracks sustained-bad-conditions while a remnant low, for the fade-out timer
    this.meandering = false;
    this.track = [{ lat, lon, kt: initialIntensityKt, mb: 1013, day: bornDay }];
    this.lastEnv = null; // populated each tick, useful for UI/inspection
    // Mean-reverting "wobble" — non-tropical/synoptic influences that make
    // every storm's path a little different even from a similar starting
    // point and environment, instead of motion being fully deterministic.
    this.wobbleU = 0;
    this.wobbleV = 0;
    this.shearEma = null;
    this.outflowEma = 0;
    this.weakDays = 0; // cumulative time spent below ST.weakLingerThresholdKt without organizing
    this.ace = 0;
    this.forwardSpeedKt = 0;
    this.headingRad = 0;
    // Intensity ceiling: real storms vary enormously in how well their
    // inner core organizes even given similar large-scale environments
    // (eyewall structure, moisture entrainment on scales this model
    // doesn't resolve). Rather than pretend the environment alone
    // determines outcome, draw a per-storm ceiling at genesis, weighted to
    // match the real Atlantic peak-intensity distribution (~50% of named
    // storms reach hurricane strength, ~21% reach major). The environment
    // still determines *whether* a storm approaches its ceiling, and can
    // always cap it lower (shear/dry air/land), just never higher.
    //
    // The TS-only bucket (50%) is itself split: a genuinely marginal
    // sub-tier (34-45kt ceiling) representing the real, common population
    // of short-lived "flash" tropical storms that barely organize before
    // falling apart, versus a more capable TS-only tier that can sustain
    // a longer life without ever reaching hurricane strength.
    const r = rand();
    if (r < 0.35) this.ceilingKt = 34 + rand() * 11;         // marginal, short-lived-prone
    else if (r < 0.50) this.ceilingKt = 45 + rand() * 18;    // more capable TS-only
    else if (r < 0.79) this.ceilingKt = 64 + rand() * 31;    // caps Cat 1-2
    else this.ceilingKt = 96 + rand() * 62;                   // Cat 3-5, occasionally into extreme-C5 territory
    // Season/origin-specific bias (currently used by CAG genesis — early
    // vs late season Caribbean systems have real, different climatological
    // outcomes; see simulation.js). Floored so it can suppress but not
    // fully zero out a storm's potential.
    this.ceilingKt = Math.max(25, this.ceilingKt + ceilingBiasKt);

    // Widened to genuinely allow the real-world spread: a 155kt storm can
    // sit in the high 920s (shallow for its wind) just as plausibly as a
    // 145kt storm can reach the low 890s (deep for its wind) — individual
    // storm structure (size, forward speed, background pressure) causes
    // real divergence from the mean wind-pressure curve, not just a
    // narrow band around it.
    this.pressureVarianceFactor = 0.46 + rand() * 0.9; // ~0.46-1.36 — used for size/MPI-band derivation only, see below
    // Tight, additive wind-pressure scatter — deliberately separate from
    // pressureVarianceFactor above (which drives size/MPI positioning,
    // not the actual wind-pressure pairing). Sum-of-4-uniforms gives a
    // roughly bell-shaped distribution: most storms land within about
    // +/-7mb of the mean curve, with rare tails out to about +/-14mb —
    // enough to make e.g. a 100kt storm in the low 970s a genuine, rare
    // anomaly, while keeping something like a 115kt storm at 970mb
    // (a ~32mb gap from the mean) actually impossible.
    this.pressureDeficitOffsetMb = (rand() + rand() + rand() + rand() - 2) * 7;
    this.pressureMb = windToPressureMb(initialIntensityKt, this.pressureDeficitOffsetMb);
    this.minPressureMb = this.pressureMb;
    this.track[0].mb = this.pressureMb;

    this.intensityHistory = []; // rolling ~24h of {day, kt} for the RI badge
    this.isRapidIntensifying = false;
    this.ercPhase = 'none'; // 'none' | 'weakening' | 'reforming'
    this.ercTimer = 0;
    this.ercCooldown = 0;

    // Size (rough proxy for the 34kt wind radius), correlated inversely
    // with the pressure-variance factor — see constants.js SIZE.
    this.sizeFactor = 1.3 - ((this.pressureVarianceFactor - 0.82) / 0.36) * 0.6; // ~0.7-1.3
    this.r34Km = 0;
    this.r64Km = 0;
    this._updateSize();
  }

  // Real central pressure isn't a deterministic function of wind speed
  // alone — the same wind can pair with very different pressures
  // depending on the ambient pressure gradient the storm sits in
  // (stronger under a healthy subtropical ridge, weaker over warm
  // Caribbean/Gulf/BoC water — see env.bgPressureMb) and storm size
  // (a tighter core sees a steeper local gradient for the same
  // pressure). On top of that, pressure doesn't track wind
  // instantaneously — during RI, wind often leads and pressure catches
  // up over the following day or so, which is implemented here as a
  // genuine lag (relaxation toward a target, not an instant snap) rather
  // than just extra random noise.
  // The gradient offset a storm's actual pressure deviates from the
  // plain mean wind-pressure curve by — shared between _updatePressure
  // (what pressure a storm actually settles toward for its current
  // wind) and _mpiKtFromPressure (the wind ceiling implied by the SST's
  // pressure floor) so the two stay consistent with each other rather
  // than silently using different gradient models.
  _pressureGradientOffsetMb(s) {
    const bgDeviation = s.bgPressureMb - ENV.bgPressureReferenceMb;
    const bgCoeff = bgDeviation >= 0 ? ST.bgGradientMbCoeffRidge : ST.bgGradientMbCoeffTrough;
    const sizeGradientBonus = (1 - this.sizeFactor) * ST.smallStormGradientMbCoeff;
    // A weak, barely-organized TD can't leverage the ambient background
    // pressure pattern the way a mature, well-organized storm can — it
    // doesn't have the deep, coherent circulation needed to "tap into" a
    // broader-scale gradient. Real outlier W/P combos are a sign of RI,
    // genuinely low background pressure, or a broad TC — not something
    // that should already be available to a fresh 25kt depression.
    // Ramps from ~0 at genesis-strength up to full effect by 50kt.
    const organizationGate = Math.min(1, this.intensityKt / 50);
    const rawGradientShift = bgDeviation * (bgCoeff + sizeGradientBonus) * organizationGate;
    const gradientShiftMb = Math.max(-ST.maxGradientShiftMb, Math.min(ST.maxGradientShiftMb, rawGradientShift));
    return Math.max(-ST.maxTotalPressureShiftMb,
      Math.min(ST.maxTotalPressureShiftMb, gradientShiftMb + this.pressureDeficitOffsetMb * organizationGate));
  }

  _updatePressure(s, dtDays) {
    const totalOffsetMb = this._pressureGradientOffsetMb(s);
    const targetPressureMb = windToPressureMb(this.intensityKt, totalOffsetMb);
    // Rising target (pressure trying to get shallower) means the storm
    // is weakening pressure-wise — catch up fast. A falling target
    // (pressure trying to get deeper) means it's intensifying — keep the
    // slower, deliberately realistic RI lag. Inferred directly from
    // target-vs-current rather than needing an external "is weakening"
    // signal passed in.
    const isWeakeningPressureWise = targetPressureMb > this.pressureMb;
    const halfLife = isWeakeningPressureWise ? ST.pressureLagHalfLifeDaysWeakening : ST.pressureLagHalfLifeDays;
    const lagAlpha = 1 - Math.pow(0.5, dtDays / halfLife);
    this.pressureMb = Math.round(this.pressureMb + (targetPressureMb - this.pressureMb) * lagAlpha);
    this.minPressureMb = Math.min(this.minPressureMb, this.pressureMb);
  }

  // A storm's circulation extends well beyond its exact center point —
  // sampling only the center's land value treats crossing a narrow
  // peninsula (Yucatan, Florida at its narrowest, etc.) the same as
  // being deep in a wide continental interior, when in reality the
  // storm's outer circulation still has real ocean exposure on both
  // sides of a narrow landmass, which measurably slows decay and is
  // exactly what lets real storms cross something like Yucatan and
  // reemerge into the Gulf instead of fully dying en route. Blends the
  // center value with a ring of samples at a radius scaled to the
  // storm's own size — a bigger storm "feels" a wider land/sea pattern
  // around it than a small one does.
  _effectiveLandFraction(env) {
    const centerLand = env.stateAt(this.lat, this.lon).land;
    const radiusDeg = Math.max(0.7, (this.r34Km / 111) * 0.55);
    const samples = [
      env.stateAt(this.lat, this.lon + radiusDeg).land,
      env.stateAt(this.lat, this.lon - radiusDeg).land,
      env.stateAt(this.lat + radiusDeg, this.lon).land,
      env.stateAt(this.lat - radiusDeg, this.lon).land,
    ];
    const avgSurrounding = samples.reduce((a, b) => a + b, 0) / samples.length;
    return centerLand * 0.55 + avgSurrounding * 0.45;
  }

  _updateSize() {
    const base = SZ.baseR34Km + this.intensityKt * SZ.ktToR34Km + Math.abs(this.lat) * SZ.latToR34Km;
    this.r34Km = base * this.sizeFactor;
    this.r64Km = this.intensityKt >= 64 ? this.r34Km * SZ.r64FractionOfR34 : 0;
  }

  get classification() { return classify(this.intensityKt, this.phase === 'extratropical'); }
  get displayName() { return this.name || this.number; }

  // MPI is now strictly pressure-based, per the actual physics: SST sets
  // a genuine thermodynamic floor on how deep central pressure can get,
  // not a wind value directly. Wind is derived from that pressure floor
  // via the same gradient relationship governing a storm's actual
  // pressure (_pressureGradientOffsetMb) — so under a strong ridge (or
  // for a small/tight storm), the wind ceiling implied by a given
  // pressure floor is genuinely higher than a flat wind-based MPI table
  // would ever allow, which is exactly what lets real outlier
  // combinations (a compact major posting unusually high wind for a
  // pressure that isn't itself record-setting) actually happen here,
  // while the pressure floor itself still can't be exceeded.
  _mpiKtFromPressure(s) {
    const mpiPressureMb = interpMpiTable(s.sst)[1];
    const totalOffsetMb = this._pressureGradientOffsetMb(s);
    const windCeiling = windFromPressureMb(mpiPressureMb - totalOffsetMb);
    // Higher-latitude TCs trade peak wind for size — the same central
    // pressure deficit spreads over a broader radius (see the
    // latToR34Km size growth), giving a genuinely weaker pressure
    // gradient, and therefore lower peak wind for a given pressure,
    // than an equivalent storm in the deep tropics would show.
    const latWindDiscount = Math.max(SZ.latWindDiscountFloor,
      1 - Math.max(0, Math.abs(this.lat) - SZ.latWindDiscountStartLat) * SZ.latWindDiscountPerDeg);
    return windCeiling * latWindDiscount;
  }

  _troughInteractionKt(upperHeight, distToTroughAxisDeg) {
    // upperHeight < 0 means we're under/near a trough. We don't track a true
    // "axis distance" field, so approximate: the more negative upperHeight
    // is *without* being extreme, the more likely we're in the favorable
    // outflow band rather than right under the coldest part of the trough.
    if (upperHeight >= 0) return 0; // under a ridge: no trough aid
    const depth = -upperHeight; // roughly 0..1.4
    // favorable band roughly where depth is small-to-moderate; right under
    // the trough axis (large depth) is handled by the shear boost instead.
    const aid = Math.exp(-Math.pow((depth - 0.3) / 0.25, 2)) * ST.troughAidMaxKt;
    return aid;
  }

  // Direct interaction with the nearest traveling trough/cutoff low:
  // within capture range, the storm gets pulled poleward and accelerated
  // eastward (the real mechanism behind an early/sharp recurve and the
  // forward-speed jump that comes with it), and — if close enough without
  // being right under the cold core — gets an extra outflow-aided
  // intensification boost, standing in for a cutoff low enhancing the
  // storm's upper-level divergence.
  _troughCapture(env) {
    let nearestDist = Infinity, nearestStrength = 0, nearestDLat = 0, nearestDLon = 0;
    for (const t of env.troughCenters) {
      const dLat = t.lat - this.lat, dLon = t.lon - this.lon;
      const dist = Math.hypot(dLat, dLon);
      if (dist < nearestDist) {
        nearestDist = dist; nearestStrength = t.strength; nearestDLat = dLat; nearestDLon = dLon;
      }
    }
    let pullU = 0, pullV = 0, outflowAidKt = 0;
    if (nearestDist < ENV.troughCaptureRadiusDeg) {
      const proximity = Math.pow(1 - nearestDist / ENV.troughCaptureRadiusDeg, 1.5);
      pullV = proximity * nearestStrength * ENV.troughCaptureVKtPerStrength;
      pullU = proximity * nearestStrength * ENV.troughCaptureUKtPerStrength;
    }
    // Outflow channels: real TCs can be ventilated by a single poleward
    // channel, a transverse one, or — when multiple upper features (a
    // trough AND a nearby ULL, or more than one ULL) are simultaneously
    // well-positioned — dual or even triple channels, which genuinely
    // ventilate a storm far better than any single one alone. Counted
    // here as how many distinct troughs/ULLs are within outflow range at
    // once, each contributing its own aid, with the *count* itself
    // mattering (see the dual/triple bonus in step()'s outflow-quality
    // tracking) on top of the summed magnitude.
    let channelCount = 0;
    if (nearestDist < ENV.troughOutflowBoostRadiusDeg) {
      const proximity = 1 - nearestDist / ENV.troughOutflowBoostRadiusDeg;
      outflowAidKt += proximity * nearestStrength * ENV.troughOutflowBoostMaxKt;
      channelCount++;
    }
    for (const u of env.naturalUlls || []) {
      const d = Math.hypot(u.lat - this.lat, u.lon - this.lon);
      if (d < ENV.troughOutflowBoostRadiusDeg) {
        const proximity = 1 - d / ENV.troughOutflowBoostRadiusDeg;
        outflowAidKt += proximity * (u.strength / 20) * ENV.troughOutflowBoostMaxKt * 0.7;
        channelCount++;
      }
    }
    return { pullU, pullV, outflowAidKt, nearestDist, channelCount };
  }

  // Distance to the nearest genuinely separate extratropical low (see
  // ETLOW in constants.js/environment.js) — this, not bare upper-trough
  // proximity, is what a real transitioning tropical cyclone actually
  // merges with. Falls back to trough distance if no extratropical low
  // currently exists, so ET can still occur via a strong upper trough
  // alone (a real, if less classic, pathway) when no surface low has
  // spun up yet.
  _nearestExtratropicalLowDist(env, troughFallbackDist) {
    if (!env.extratropicalLows || !env.extratropicalLows.length) return troughFallbackDist;
    let nearest = Infinity;
    for (const l of env.extratropicalLows) {
      const d = Math.hypot(l.lat - this.lat, l.lon - this.lon);
      if (d < nearest) nearest = d;
    }
    return Math.min(nearest, troughFallbackDist);
  }

  step(env, osc, dtDays, dayNum, rand = Math.random) {
    if (this.dissipated) return;

    const s = env.stateAt(this.lat, this.lon);
    this.lastEnv = s;
    this.ageDays += dtDays;

    // ---- Intensity ----
    // Smoothed shear: a real storm's inner core responds to sustained
    // conditions, not a single synoptic snapshot — using an EMA instead
    // of instantaneous shear stops brief noise spikes from flickering an
    // established storm's intensification on and off, and is what RI
    // eligibility below checks against.
    this.shearEma = this.shearEma == null ? s.shear : this.shearEma * (1 - RI.shearEmaWeight) + s.shear * RI.shearEmaWeight;

    // Established, well-organized storms are measurably more resilient to
    // a given amount of shear than a fresh depression is — real major
    // hurricanes regularly shrug off shear that would tear apart a weaker
    // system. Without this, the higher/noisier shear climatology fights
    // storms that have already built real structure just as hard as it
    // fights brand-new ones, which isn't realistic.
    // Genesis itself already implies at least a marginally favorable
    // environment (the GPI threshold filters for that) — a system
    // shouldn't be as easy to immediately tear apart as a flat
    // intensity-only resilience discount allows, which was a real
    // contributor to too many TDs dying within their first day or two
    // (found by tracing actual failures: most were dying at age 1.0-1.5
    // days regardless of birth latitude, not from a bad spawn position).
    // Separate from and multiplicative with the existing intensity-based
    // discount below, which is about established/intense storms
    // shrugging off shear, not about this.
    const ageResilience = this.ageDays < RI.organizationRampDays ? 0.72 : 1.0;
    const resilience = (this.intensityKt >= 90 ? 0.68 : this.intensityKt >= 64 ? 0.85 : 1.0) * ageResilience;
    const rawShearPenalty =
      Math.max(0, this.shearEma - ST.shearToleranceKt) * ST.weakenShearFactor * resilience;
    const troughAid = this._troughInteractionKt(s.upperHeight);
    const capture = this._troughCapture(env);
    // Decent upper-level ventilation (trough interaction, outflow aid)
    // genuinely helps a storm shrug off marginal shear — real hurricanes
    // in an otherwise-so-so environment can still organize and even
    // intensify when their outflow is well-supported. Capped well short
    // of fully canceling the penalty — good ventilation buys real
    // headroom in marginal conditions, it doesn't make hostile shear
    // irrelevant.
    const ventilationQuality = Math.max(0, troughAid) + Math.max(0, capture.outflowAidKt);
    const ventilationShearOffset = Math.min(rawShearPenalty * 0.6, ventilationQuality * ST.ventilationShearOffsetCoeff);
    const shearPenalty = Math.max(0, rawShearPenalty - ventilationShearOffset);
    const dryPenalty = s.dryAir * ST.dryAirWeakenFactor * ageResilience;

    // Sustained upper-level ventilation quality: real max potential
    // intensity is set by SST (the thermodynamic formula below already
    // reaches Cat5 territory at 30C+), but a storm's own random ceiling
    // draw was the actual thing stopping RI storms in great environments
    // from ever getting there. A storm that keeps genuinely good outflow
    // support (trough-aided, low shear) for real *time* — not just a
    // passing tick of it — earns a growing extension on its ceiling.
    // Multiple simultaneous channels (a trough AND a nearby ULL, or more
    // than one ULL at once) genuinely ventilate a storm far better than
    // any single channel alone — a real dual/triple-channel bonus, not
    // just a bigger single number.
    const channelBonus = capture.channelCount >= 3 ? OUTFLOW.tripleChannelBonus
      : capture.channelCount >= 2 ? OUTFLOW.dualChannelBonus : 1.0;
    const outflowQualityNow = this.shearEma <= OUTFLOW.qualityShearThreshold
      ? (troughAid + capture.outflowAidKt) * channelBonus : 0;
    const outflowAlpha = 1 - Math.pow(0.5, dtDays / OUTFLOW.emaHalfLifeDays);
    this.outflowEma += (outflowQualityNow - this.outflowEma) * outflowAlpha;
    // Scaled by how strong the storm's own base ceiling already is —
    // this is what keeps the extension an "RI storm in a great
    // environment reaches its own full potential" mechanic rather than a
    // way for a fundamentally weaker-potential storm (drawn into the
    // TS-only or Cat1-2 bucket) to leapfrog into major territory, which
    // was quietly inflating the season's overall hurricane/major counts
    // well past the intended ~50%/~21% distribution.
    const extensionScale = this.ceilingKt >= 96 ? 1.0 : this.ceilingKt >= 64 ? 0.35 : 0.15;
    const ceilingExtensionKt = Math.min(OUTFLOW.maxExtensionKt, this.outflowEma * OUTFLOW.extensionPerEmaUnit) * extensionScale;

    // A displaced upper-level anticyclone — the storm's own outflow
    // anticyclone pushed off-center (by an approaching trough or strong
    // upper flow) instead of sitting cleanly poleward of the core —
    // induces easterly shear across the storm, which real forecasters
    // treat as a genuine ceiling-limiting factor distinct from ordinary
    // shear magnitude. Proxied here by the shear vector's own easterly
    // (negative U) component: a well-ventilated storm's shear vector
    // doesn't usually run strongly easterly, so when it does, something
    // upstream is off, and it caps how far the ceiling extension above
    // can take the storm regardless of how good the outflow otherwise looks.
    const displacedAnticycloneStress = Math.max(0, -s.shearVecU - OUTFLOW.easterlyShearToleranceKt);
    const anticycloneCeilingCapKt = Math.max(0, OUTFLOW.maxExtensionKt - displacedAnticycloneStress * OUTFLOW.easterlyShearCeilingPenaltyPerKt);
    const effectiveCeilingKt = this.ceilingKt + Math.min(ceilingExtensionKt, this.ceilingKt >= 96 ? anticycloneCeilingCapKt : ceilingExtensionKt);

    const mpi = Math.min(this._mpiKtFromPressure(s), effectiveCeilingKt);
    const gap = mpi - this.intensityKt;

    // Extratropical transition trigger: a real system (peaked as at
    // least a tropical storm) that's gotten far enough poleward and is
    // deeply interacting with an extratropical low/front (or, lacking a
    // spun-up surface low, a strong-enough upper trough / genuinely
    // baroclinic high-shear environment) loses its warm core. This does
    // NOT create a new storm object; it's the same system, same name,
    // continuing to be tracked, just with a different physical character
    // from here on.
    const etProximityDist = this._nearestExtratropicalLowDist(env, capture.nearestDist);
    if (this.phase === 'tropical' && this.peakKt >= 34 && this.lat >= ET.latThreshold &&
        (etProximityDist < ET.troughSupportRadiusDeg || this.shearEma >= ET.shearTriggerKt)) {
      this.phase = 'extratropical';
      this.etOnsetDay = dayNum;
      this.sizeFactor *= ET.sizeExpansionFactor;
    }

    if (this.phase === 'extratropical') {
      // Post-tropical systems don't run on the warm-core MPI-approach
      // model at all — they either draw baroclinic energy from a
      // supporting extratropical low/front (can maintain or even
      // slightly regain strength, the real Sandy-style mechanism) or
      // steadily weaken once that support fades, plus the usual hard
      // land override.
      const etAge = dayNum - this.etOnsetDay;
      const wellSupported = etProximityDist < ET.troughSupportRadiusDeg;
      let etTendency = wellSupported ? ET.baroclinicSupportKtPerDay : -ET.unsupportedDecayKtPerDay;
      if (etAge > ET.maxDurationDays) etTendency = -ET.unsupportedDecayKtPerDay * 2.2; // finally winds down for good
      // Real atmosphere-ocean coupling doesn't switch off just because a
      // system has gone post-tropical — "well supported" by a trough
      // lets it draw on baroclinic energy too, so it's allowed a modest
      // premium over the pure warm-core SST ceiling, but not unbounded.
      // Without this, a storm that went ET while still intense could
      // maintain major-hurricane-level intensity indefinitely regardless
      // of how cold the water beneath it had actually become (the actual
      // mechanism behind a reported Cat5 maintaining 870mb well past
      // 38N) — the below-20C check further down was nowhere near enough
      // on its own since it only engaged in genuinely cold water, not
      // the much broader range of "too warm to be this strong, but not
      // *that* cold" in between.
      const etCeilingKt = this._mpiKtFromPressure(s) * ET.sstCeilingPremiumFactor;
      if (this.intensityKt > etCeilingKt) {
        etTendency = Math.min(etTendency, -(this.intensityKt - etCeilingKt) * ET.sstCeilingOverageDecayPerKt);
      }
      const effLand = this._effectiveLandFraction(env);
      if (effLand > 0.05) etTendency = -ST.weakenOverLandKtPerDay * effLand;
      else if (s.sst < 20) etTendency = Math.min(etTendency, -ET.unsupportedDecayKtPerDay * 1.3);

      this.intensityKt = Math.max(0, this.intensityKt + etTendency * dtDays);
      this.peakKt = Math.max(this.peakKt, this.intensityKt);
      this._updatePressure(s, dtDays);
      this._updateSize();
      // Genuine absorption: a post-tropical system that gets and stays
      // truly close to a trough/extratropical low doesn't just linger
      // and fade on its own — it merges into that larger system, the
      // way a transitioning TC often does in reality once it's drawn
      // into a front or a stronger baroclinic low. Distinct from the
      // fixed maxDurationDays decay above, which models the case where
      // no such merger happens and the system just winds down alone.
      if (etProximityDist < ET.absorptionRadiusDeg) {
        this.absorptionProximityDays += dtDays;
        if (this.absorptionProximityDays >= ET.absorptionDays) {
          this.dissipated = true;
          this.absorbed = true;
        }
      } else {
        this.absorptionProximityDays = Math.max(0, this.absorptionProximityDays - dtDays * 2);
      }
      if (this.intensityKt < ST.minIntensityKt && this.ageDays > 0.5) {
        this.phase = 'remnant';
        this.remnantUnfavorableDays = 0;
      }
      this._advance(env, s, capture, dtDays, dayNum, rand);
      return;
    }

    if (this.phase === 'remnant') {
      // A degenerated system doesn't just vanish — it persists as a weak,
      // meandering low that either fully fades after sustained
      // unfavorable conditions, or reorganizes back into a tropical
      // cyclone (keeping its original name) if the environment turns
      // favorable again. Real, if not hugely common — this is what makes
      // "storms can completely degenerate without the possibility of
      // reforming" no longer true.
      const favorable = s.sst >= REM.minSstForRegenesis && this.shearEma <= REM.maxShearForRegenesis && s.dryAir <= REM.maxDryAirForRegenesis;
      // Intensity genuinely evolves while remnant, not frozen at
      // whatever it was on transition — real remnant lows keep weakening
      // under continued unfavorable conditions (which is what actually
      // makes the 20kt floor below reachable through ongoing decay, not
      // just an edge case at the moment of transition), and hold roughly
      // steady rather than re-strengthening under favorable ones (any
      // real strengthening happens via the regenesis roll below, not a
      // gradual climb while still nominally "remnant"). Applied *before*
      // the floor check right below, so a storm that decays past it this
      // tick is caught this tick, not one tick late.
      this.intensityKt = Math.max(0, this.intensityKt - (favorable ? 0 : REM.unfavorableDecayKtPerDay) * dtDays);
      // Below 20kt, it's too weak to meaningfully track or reorganize —
      // dissipates outright regardless of how favorable conditions
      // otherwise look, taking priority over the sustained-unfavorable-
      // days fade timer below. At or above 20kt, it stays a genuine,
      // trackable remnant low with real regenesis potential.
      if (this.intensityKt < REM.minIntensityToPersistKt) {
        this.dissipated = true;
        this._advance(env, s, capture, dtDays, dayNum, rand);
        return;
      }
      if (favorable) {
        this.remnantUnfavorableDays = Math.max(0, this.remnantUnfavorableDays - dtDays * REM.unfavorableRecoveryDaysPerTick);
        if (s.land < 0.3 && rand() < REM.regenesisChancePerTick) {
          this.phase = 'tropical';
          this.intensityKt = REM.regenesisInitialKt;
          this.isRapidIntensifying = false;
          this.intensityHistory = [];
          this.ercPhase = 'none';
          this.ercTimer = 0;
          this.meandering = false;
          this._updatePressure(s, dtDays);
          this._updateSize();
          this._advance(env, s, capture, dtDays, dayNum, rand);
          return;
        }
      } else {
        this.remnantUnfavorableDays += dtDays;
        if (this.remnantUnfavorableDays >= REM.fadeUnfavorableDaysThreshold) {
          this.dissipated = true;
          this._advance(env, s, capture, dtDays, dayNum, rand);
          return;
        }
      }
      // A remnant low over land just fades faster, same physical
      // reasoning as a real tropical cyclone's land decay, but it's
      // already so weak there's no meaningful wind field left to model —
      // just accelerate the fade timer directly.
      if (s.land > 0.3) this.remnantUnfavorableDays += dtDays * 1.5;
      this._updatePressure(s, dtDays);
      this._advance(env, s, capture, dtDays, dayNum, rand);
      return;
    }

    // Eyewall replacement cycle state machine (only reachable by intense
    // hurricanes). Runs independently of the normal approach-to-MPI
    // tendency below — while active, it overrides the tendency outright,
    // since a real ERC weakens/reforms the core regardless of how
    // favorable the large-scale environment still is.
    this.ercCooldown = Math.max(0, this.ercCooldown - dtDays);
    // Real ERCs vary a lot in how long they take — a quick, clean cycle
    // vs. one that drags on for days, especially when shear/dry air pile
    // on top of it. Both the duration and the extra weakening scale with
    // how hostile the environment is right now, not just a fixed rate.
    const ercEnvStress = Math.max(0, (this.shearEma - ST.shearToleranceKt) / 15) +
      Math.max(0, (s.dryAir - 0.3) / 0.35);
    const ercStressFactor = Math.min(1, ercEnvStress);
    // Storm structure and current intensity both modulate how readily an
    // ERC actually gets going — see ERC constants in constants.js for the
    // reasoning behind each factor.
    const sizeErcOnsetFactor = 1 + (1 - this.sizeFactor) * ERC.smallCoreOnsetBonus;
    const intensityErcFactor = 1 + Math.max(0, (this.intensityKt - ERC.triggerKt) / 10) * ERC.intensityOnsetBonusPer10Kt;
    const effectiveErcChance = ERC.chancePerTick * sizeErcOnsetFactor * intensityErcFactor;
    if (this.ercPhase === 'none') {
      if (this.intensityKt >= ERC.triggerKt && this.ercCooldown <= 0 && rand() < effectiveErcChance) {
        this.ercPhase = 'weakening';
        // Storm size biases where in the duration range this particular
        // ERC lands — a compact core skews toward the fast end (rapid
        // ERC), a broad one toward the slow end (long ERC), on top of
        // real event-to-event randomness so it's a bias, not a rule.
        const sizeDurationBias = Math.max(0, Math.min(1, (this.sizeFactor - 0.7) / 0.6));
        const durationT = sizeDurationBias * ERC.sizeDurationWeight + rand() * (1 - ERC.sizeDurationWeight);
        const baseDays = ERC.weakenDaysMin + durationT * (ERC.weakenDaysMax - ERC.weakenDaysMin);
        this.ercTimer = baseDays * (1 + ercStressFactor * ERC.envStressMaxExtension);
      }
    } else if (this.ercPhase === 'weakening') {
      this.ercTimer -= dtDays;
      if (this.ercTimer <= 0) {
        this.ercPhase = 'reforming';
        const baseDays = ERC.reformDaysMin + rand() * (ERC.reformDaysMax - ERC.reformDaysMin);
        this.ercTimer = baseDays * (1 + ercStressFactor * ERC.envStressMaxExtension);
      }
    } else if (this.ercPhase === 'reforming') {
      this.ercTimer -= dtDays;
      if (this.ercTimer <= 0) {
        this.ercPhase = 'none';
        this.ercCooldown = ERC.cooldownDays;
        // A completed ERC leaves behind a genuinely larger storm — the
        // new outer eyewall that's replaced the old inner one becomes
        // the storm's new primary wind field, which is real and lasting,
        // not just a temporary wobble during the cycle itself.
        this.sizeFactor = Math.min(ERC.maxSizeFactorFromErc, this.sizeFactor + ERC.sizeFactorGainPerErc);
      }
    }

    let tendencyKtPerDay;
    const effLand = this._effectiveLandFraction(env);
    if (effLand > 0.05) {
      // Real land decay isn't a flat rate — the Kaplan-DeMaria pattern
      // (and just basic physics: losing the warm-ocean energy source and
      // gaining surface friction) hits harder, faster, the stronger a
      // storm was to begin with. A weak TS barely changes rate; a major
      // can lose more than double the old flat rate in the first day.
      //
      // This scales continuously with the actual land fraction, with no
      // artificial floor — the previous 0.5 threshold meant a storm
      // crossing a small island (Jamaica reads ~0.25 land fraction on
      // this 1-degree grid; the whole island doesn't fill a full cell)
      // got treated as fully over open water and weakened not at all,
      // which is a real, serious problem for any smaller island in the
      // basin, not just Jamaica specifically. Uses the *effective*
      // (neighborhood-blended) land fraction rather than the exact
      // center point — a storm crossing a narrow peninsula (Yucatan)
      // still has real ocean exposure on both sides of its own
      // circulation, which is what lets it survive the crossing and
      // reemerge instead of decaying as if it were deep in a continent.
      const landIntensityBonus = Math.max(0, this.intensityKt - ST.landDecayIntensityThresholdKt) * ST.landDecayIntensityCoeffPerKt;
      tendencyKtPerDay = -(ST.weakenOverLandKtPerDay + landIntensityBonus) * effLand;
      this.landfall = true;
    } else if (s.sst < 24) {
      // Same idea for a still-tropical storm recurving into cold water
      // at higher latitude — a major shouldn't coast along at nearly
      // full strength just because its pressure is still deep; losing
      // its warm core support hits it harder than it hits a weak system.
      const coldIntensityBonus = Math.max(0, this.intensityKt - ST.landDecayIntensityThresholdKt) * ST.coldWaterIntensityCoeffPerKt;
      tendencyKtPerDay = -(ST.weakenColdWaterKtPerDay + coldIntensityBonus) * ((24 - s.sst) / 4);
    } else if (this.ercPhase === 'weakening') {
      tendencyKtPerDay = -ERC.weakenRateKtPerDay - ercStressFactor * ERC.envStressExtraWeakenKtPerDay;
    } else {
      // approach MPI at a rate proportional to the gap (like a relaxation
      // toward equilibrium), then subtract environmental penalties and add
      // trough-outflow aid.
      let approachRate = 0.52;
      let rateCeiling = ST.intensifyRateMaxKtPerDay;

      // Real climatology has plenty of tropical storms that plateau in
      // the 34-64kt range without ever reaching hurricane strength —
      // structural/shear-marginal limitations distinct from the very-
      // young-system organization ramp below. Found via direct
      // measurement that this band specifically was over-producing
      // hurricanes relative to target climatology (measured ~9
      // hurricanes/season against a 6-storm target, while majors were
      // already close to target) — targeted here specifically rather
      // than lowering the base approach rate overall, which would have
      // also undone the TD-to-TS organization-ramp tuning from a
      // separate pass.
      if (this.intensityKt >= 34 && this.intensityKt < 64) {
        approachRate *= SZ.tsPlateauApproachMultiplier;
      }

      // Storm size (sizeFactor, already tied to this storm's own pressure-
      // variance character at genesis — see the constructor) directly
      // affects how efficiently it can intensify: a small, "pinhole eye"
      // core exports mass/angular momentum far more efficiently than a
      // broad one, which is the real mechanism behind the most explosive
      // RI events coming from compact storms. Larger storms intensify
      // more gradually but — separately, in the ERC logic below — hold
      // their structure together longer once they get there.
      const sizeIntensifyFactor = 1 + (1 - this.sizeFactor) * SZ.smallCoreRiBonus;
      approachRate *= sizeIntensifyFactor;

      // A freshly-formed system hasn't built a real inner core yet and
      // simply can't intensify at full speed no matter how favorable the
      // large-scale environment looks — real storms take a day or two to
      // organize before intensification really gets going, RI or not.
      // Without this, the "gap to MPI" alone was enough to produce
      // major-hurricane intensity within ~1 day even outside the RI path.
      const organizationRamp = Math.min(1, RI.organizationRampFloor + (1 - RI.organizationRampFloor) * (this.ageDays / RI.organizationRampDays));
      approachRate *= organizationRamp;

      // Rapid intensification: when shear, moisture, and SST are all
      // simultaneously excellent (the real RI recipe) and there's real
      // room below the ceiling, allow a much faster approach — this is
      // what produces genuine 30-50kt+/24h deepening events instead of
      // capping every storm at the same steady climb rate. Checked
      // against the smoothed shear (above), not the instantaneous value,
      // so RI persists through brief wobbles the way it does in reality.
      // Gated on the same minimum age as the organization ramp above —
      // RI is an acceleration of an already-organizing storm, not a way
      // to skip the organizing phase entirely, and its rate ceiling is
      // *also* ramped so a storm that's only just become RI-eligible
      // can't instantly jump to its full RI ceiling in one tick.
      const riFavorable =
        this.ageDays >= RI.minAgeDays &&
        this.shearEma <= RI.maxShearKt && s.sst >= RI.minSst &&
        s.dryAir <= RI.maxDryAir && gap >= RI.minGapKt;
      if (riFavorable) {
        approachRate *= RI.boostMultiplier;
        rateCeiling = RI.maxRateKtPerDay * organizationRamp;
      } else {
        rateCeiling *= organizationRamp;
      }

      const approach = Math.max(0, gap) * approachRate;
      tendencyKtPerDay = approach - shearPenalty - dryPenalty + troughAid + capture.outflowAidKt;
      tendencyKtPerDay = Math.min(tendencyKtPerDay, rateCeiling);

      // Weak-lingering penalty: track how long the storm has sat below
      // the "actually organized" threshold. Resets whenever it clears a
      // meaningfully *higher* bar (not the same threshold — without this
      // hysteresis gap, a storm oscillating right around the line could
      // keep resetting its own timer every time it ticked back above it,
      // defeating the whole point), and only bites once it's had real
      // grace time to try — a fresh depression isn't penalized for being
      // a fresh depression.
      if (this.intensityKt >= ST.weakLingerThresholdKt + ST.weakLingerResetHysteresisKt) {
        this.weakDays = 0;
      } else if (this.intensityKt < ST.weakLingerThresholdKt) {
        this.weakDays += dtDays;
        const overGrace = this.weakDays - ST.weakLingerGraceDays;
        if (overGrace > 0) {
          const rampFactor = Math.min(1, overGrace / ST.weakLingerRampDays);
          tendencyKtPerDay -= ST.weakLingerExtraDecayKtPerDay * rampFactor;
        }
      }
    }

    this.intensityKt = Math.max(0, this.intensityKt + tendencyKtPerDay * dtDays);

    // A storm that's weakened out of major-hurricane territory has lost
    // the deep, well-organized structure an eyewall replacement cycle
    // actually requires — real ERCs don't continue in a system that's
    // dropped below Cat2 strength, regardless of which sub-phase it was
    // in when that happened. Checked here (after intensity is finalized
    // for this tick), not earlier, so it's correct the same tick a storm
    // crosses the threshold rather than one tick late.
    if ((this.ercPhase === 'weakening' || this.ercPhase === 'reforming') && this.intensityKt < ERC.minIntensityToContinueKt) {
      this.ercPhase = 'none';
      this.ercCooldown = ERC.cooldownDays;
    }

    // Hard absolute age-based cap, independent of (and on top of) the
    // rate-ceiling ramps above: no matter how favorable the environment
    // or how generous the rate/RI math gets, a storm physically cannot
    // be older than this and stronger than this — guarantees "2-3 days
    // TD-to-major" stays a genuine extreme case rather than something the
    // rate-ramp math could still sneak past given a big enough MPI gap.
    const ageBasedCap = this.initialIntensityKt + this.ageDays * 24; // crosses 96kt (major) at ~3 days from a fresh TD
    this.intensityKt = Math.min(this.intensityKt, ageBasedCap);
    this.peakKt = Math.max(this.peakKt, this.intensityKt);
    this._updatePressure(s, dtDays);
    this._updateSize();

    if (this.intensityKt < ST.minIntensityKt && this.ageDays > 0.5) {
      this.phase = 'remnant';
      this.remnantUnfavorableDays = 0;
    }

    this._advance(env, s, capture, dtDays, dayNum, rand);
  }

  // Motion, wobble, and track-recording — shared by both the tropical and
  // extratropical intensity paths above (extracted so ET storms keep
  // moving/being tracked exactly like any other storm; only their
  // intensity model differs).
  _advance(env, s, capture, dtDays, dayNum, rand) {
    const trackKt = Math.round(this.intensityKt / 5) * 5;
    if (this.phase === 'tropical') {
      // Rolling 24h intensity history -> RI badge (tropical-only; ET
      // systems don't get flagged as "rapid intensifying").
      this.intensityHistory.push({ day: dayNum, kt: this.intensityKt });
      while (this.intensityHistory.length > RI.historyTicks + 1) this.intensityHistory.shift();
      if (this.intensityHistory.length > RI.historyTicks) {
        const delta = this.intensityKt - this.intensityHistory[0].kt;
        this.isRapidIntensifying = delta >= RI.badgeThresholdKt;
      }
      // ACE: NHC's formula is 10^-4 * sum(Vmax_kt^2) over every 6h period
      // at TS strength+, using the rounded best-track wind value. Real
      // ACE continues to accrue during ET too, but we keep it tropical-
      // only here for simplicity.
      if (trackKt >= 34 && !this.subtropical && this.basin !== 'epac') {
        this.ace += Math.pow(trackKt, 2) * 1e-4 * (dtDays / 0.25);
      }
    }

    // ---- Motion ----
    // Beta drift: stronger/older storms drift poleward-westward a bit more;
    // simplified as a fixed vector scaled gently by intensity.
    const betaScale = 0.6 + Math.min(1, this.intensityKt / 100) * 0.8;
    const betaU = -ENV.betaDriftKt * 0.4 * betaScale;
    const betaV = ENV.betaDriftKt * 0.5 * betaScale;

    // Jet embedding: a storm that's gotten far enough poleward starts
    // feeling a fraction of the upper-level jet directly, on top of the
    // smooth geostrophic steering — this is what makes forward speed
    // genuinely jump during/after recurvature instead of staying uniform.
    const jetProximity = Math.max(0, 1 - Math.abs(this.lat - ENV.jetLatBase) / 14);
    const jetContribution = s.jetU * jetProximity * ENV.jetSteeringFraction;

    // A recurving storm meaningfully embedded in the jet induces real
    // downstream Rossby-wave-breaking response, locally enhancing shear —
    // deposit a temporary wake into the shared environment (decayed back
    // out over a couple days in environment.js) rather than an instant
    // one-tick effect.
    if (jetProximity > 0.35 && this.forwardSpeedKt > 20) {
      env.injectWaveBreaking(this.lat, this.lon, jetProximity * ENV.waveBreakingMaxKt * 0.5);
    }

    // Two-layer steering blend: weak systems (TD/TS, below 34-64kt)
    // follow low-level (850mb) flow more; hurricanes/majors follow mid-
    // level (500mb) flow more, matching how these actually behave —
    // full weight to 850mb at/below TS strength, full weight to 500mb
    // by hurricane strength, smoothly blended in between.
    const weight850 = Math.max(0, Math.min(1, 1 - (this.intensityKt - 34) / 30));
    const blendedSteerU = s.steerU * (1 - weight850) + s.steer850U * weight850;
    const blendedSteerV = s.steerV * (1 - weight850) + s.steer850V * weight850;

    const uKt = (blendedSteerU + betaU + capture.pullU + jetContribution) * (this.phase === 'remnant' ? REM.steeringWeight : 1);
    const vKt = (blendedSteerV + betaV + capture.pullV) * (this.phase === 'remnant' ? REM.steeringWeight : 1);

    // Wobble: Ornstein-Uhlenbeck-style mean-reverting noise standing in for
    // non-tropical/synoptic influences (frontal interaction, transient
    // ridging, etc.) that add real track uncertainty beyond the resolved
    // large-scale flow. Two independent Gaussian-ish draws via sum-of-uniforms.
    // Central American Gyre-spawned storms meander more (weak steering,
    // broad low-level circulation) until a trough gets close enough to
    // actually pick them up — at which point they behave like any other
    // trough-captured storm and stop meandering for good. Remnant lows
    // meander for the same underlying reason (weak, disorganized) but use
    // their own multiplier and don't get "picked up" out of it that way.
    if (this.meandering && capture.nearestDist < ENV.troughCaptureRadiusDeg) this.meandering = false;
    const wobbleMult = this.phase === 'remnant' ? REM.meanderWobbleMultiplier : (this.meandering ? CAG.meanderWobbleMultiplier : 1);
    const gauss = () => (rand() + rand() + rand() + rand() - 2) * 1.7;
    this.wobbleU += (-this.wobbleU * WOB.decayPerDay + gauss() * WOB.noiseKtPerSqrtDay * wobbleMult) * dtDays;
    this.wobbleV += (-this.wobbleV * WOB.decayPerDay + gauss() * WOB.noiseKtPerSqrtDay * wobbleMult) * dtDays;
    this.wobbleU = Math.max(-WOB.maxKt * wobbleMult, Math.min(WOB.maxKt * wobbleMult, this.wobbleU));
    this.wobbleV = Math.max(-WOB.maxKt * wobbleMult, Math.min(WOB.maxKt * wobbleMult, this.wobbleV));

    const totalU = uKt + this.wobbleU;
    const totalV = vKt + this.wobbleV;
    this.forwardSpeedKt = Math.hypot(totalU, totalV);
    this.headingRad = Math.atan2(totalV, totalU);

    this.lon += KT_TO_DEG_LON_PER_DAY(totalU, this.lat) * dtDays;
    this.lat += KT_TO_DEG_LAT_PER_DAY(totalV) * dtDays;

    // Leaving the grid entirely ends the storm.
    if (
      this.lat < GRID.lat0 - 1 || this.lat > GRID.lat1 + 3 ||
      this.lon < GRID.lon0 - 3 || this.lon > GRID.lon1 + 3
    ) {
      this.dissipated = true;
    }

    this.track.push({ lat: this.lat, lon: this.lon, kt: trackKt, mb: this.pressureMb, day: dayNum, phase: this.phase });
  }
}
