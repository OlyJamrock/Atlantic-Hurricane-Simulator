// oscillations.js — the large-scale "background rhythm" of the basin.
//
// These aren't trying to be literal MJO/CCKW physics — they're compact
// stand-ins that produce the right qualitative behavior:
//   MJO:  a slow (~45 day), large (~broad fraction of basin), eastward-
//         propagating envelope of enhanced/suppressed convection.
//   CCKW: a faster (~5-8 day), narrower, eastward-propagating pulse train,
//         riding on top of the MJO envelope (as in reality, CCKWs are often
//         more effective at triggering genesis when the MJO envelope is
//         already favorable).
//   ENSO-like: a very slow basin-mean SST/convection breathing cycle so
//         some "seasons" in a long run are simply busier than others.
//
// All three expose a favorability value roughly in [-1, 1] at a given
// longitude (degrees, basin-relative) and time (days since sim start).

import { GRID, OSCILLATIONS as OSC, SEASON, TIME, AMO } from './constants.js';

function wrappedPhaseDistance(lonA, lonB, spanDeg) {
  let d = (lonA - lonB) % spanDeg;
  if (d > spanDeg / 2) d -= spanDeg;
  if (d < -spanDeg / 2) d += spanDeg;
  return d; // in [-span/2, span/2]
}

export class OscillationState {
  constructor() {
    this.basinSpan = GRID.lon1 - GRID.lon0;
    // NAO and AMO are both genuine persistent state (see stepNao/stepAmo
    // below) — everything else in this class is a pure function of
    // simulated day.
    this.naoIndexPersistent = 0.15;
    this.amoIndex = 0.15;
    this.naoEma = 0;
  }

  // Longitude (basin-relative, degrees) of the MJO's enhanced-convection center today.
  mjoCenterLon(dayNum) {
    const frac = (dayNum / OSC.mjoPeriodDays) % 1;
    return GRID.lon0 + frac * this.basinSpan;
  }

  cckwCenterLon(dayNum) {
    const frac = (dayNum / OSC.cckwPeriodDays) % 1;
    return GRID.lon0 + frac * this.basinSpan;
  }

  // MJO favorability at a longitude: cosine bump centered on mjoCenterLon,
  // width controlled by mjoWavelengthFrac.
  mjoFavorability(lon, dayNum) {
    const center = this.mjoCenterLon(dayNum);
    const width = this.basinSpan * OSC.mjoWavelengthFrac;
    const d = wrappedPhaseDistance(lon, center, this.basinSpan);
    const norm = Math.max(-1, Math.min(1, d / (width / 2)));
    return OSC.mjoAmplitude * Math.cos((norm * Math.PI) / 2);
  }

  cckwFavorability(lon, dayNum) {
    const center = this.cckwCenterLon(dayNum);
    const width = this.basinSpan * OSC.cckwWavelengthFrac;
    const d = wrappedPhaseDistance(lon, center, this.basinSpan);
    const norm = Math.max(-1, Math.min(1, d / (width / 2)));
    return OSC.cckwAmplitude * Math.cos((norm * Math.PI) / 2);
  }

  // ENSO-like index, roughly -2..+2 (ONI-ish scale). Two incommensurate
  // periods summed gives an irregular multi-year cycle — some "seasons"
  // sit near neutral, some spend the whole season strongly one way, like
  // the real thing, without needing a stochastic process.
  ensoIndex(dayNum) {
    const a = Math.sin((2 * Math.PI * dayNum) / OSC.ensoPeriodADays);
    const b = Math.sin((2 * Math.PI * dayNum) / OSC.ensoPeriodBDays + 1.4);
    // Independent, slower amplitude envelope on a third incommensurate
    // period — this is what lets a given La Nina episode land Strong
    // while the next El Nino episode stays Weak (real ENSO strength
    // varies independently event to event, it isn't a fixed sinusoid
    // that always peaks at the same magnitude in both directions).
    const envelope = 1 + OSC.ensoEnvelopeAmplitude *
      Math.sin((2 * Math.PI * dayNum) / OSC.ensoEnvelopePeriodDays + 0.6);
    return OSC.ensoAmplitude * envelope * (0.65 * a + 0.35 * b);
  }

  // Basin SST anomaly attributable to ENSO (deg C).
  ensoSstAnomaly(dayNum) {
    return this.ensoIndex(dayNum) * OSC.ensoSstCoeffC;
  }

  // Basin shear anomaly attributable to ENSO (kt). Positive index
  // (El Nino-like) increases shear over the tropical Atlantic/Caribbean —
  // the dominant real mechanism suppressing Atlantic activity in El Nino
  // years; negative index (La Nina-like) reduces it.
  ensoShearAnomaly(dayNum) {
    return this.ensoIndex(dayNum) * OSC.ensoShearCoeffKt;
  }

  // NAO-like index, roughly -3..+3. Faster-varying than ENSO (two shorter
  // incommensurate periods), independent phase offset so it's not just a
  // rescaled copy of the ENSO signal.
  // NAO index — genuinely persistent state, not a function of dayNum
  // (the dayNum parameter is kept for call-site compatibility but unused).
  // Real NAO regimes hold for weeks to months; a mean-reverting stochastic
  // process with a long correlation time reproduces that "sticks, then
  // eventually drifts" character naturally, where a fixed-period sinusoid
  // always flips on schedule regardless of how the periods are tuned.
  naoIndex(dayNum) {
    return this.naoIndexPersistent;
  }

  // Advances the NAO's persistent state by one tick — an Ornstein-
  // Uhlenbeck-style mean-reverting random walk. `rand` should be the
  // world's seeded RNG so the whole simulation stays deterministic given
  // a seed.
  stepNao(dtDays, rand) {
    const tau = OSC.naoRegimeCorrelationDays;
    const sigma = OSC.naoRegimeNoiseSigma;
    const gauss = (rand() + rand() + rand() + rand() - 2) * 1.7;
    this.naoIndexPersistent += (-this.naoIndexPersistent / tau) * dtDays + sigma * Math.sqrt(dtDays) * gauss;
    this.naoIndexPersistent = Math.max(-3, Math.min(3, this.naoIndexPersistent));
  }

  // Advances the AMO's persistent state by one tick. Two things drive it:
  // (1) its own slow, independent multi-year rhythm, and (2) a long
  // exponential moving average of the NAO index — a genuine multi-month
  // NAO regime, not a brief wobble, nudges the AMO's *target* — which the
  // AMO index itself then relaxes toward with real inertia (relaxHalfLifeDays),
  // so it takes a sustained pattern to actually move the AMO, and once
  // moved it stays there for a while even if the NAO immediately flips
  // back. This is what gives AMO its "sticks for months" character
  // distinct from the NAO's own faster wobble.
  stepAmo(dayNum, dtDays) {
    const nao = this.naoIndex(dayNum);
    const emaAlpha = 1 - Math.pow(0.5, dtDays / AMO.naoEmaHalfLifeDays);
    this.naoEma += (nao - this.naoEma) * emaAlpha;

    const baseline = AMO.baselineAmplitude * Math.sin((2 * Math.PI * dayNum) / AMO.baselinePeriodDays);
    const target = baseline - AMO.naoForcingCoeff * this.naoEma;

    const relaxAlpha = 1 - Math.pow(0.5, dtDays / AMO.relaxHalfLifeDays);
    this.amoIndex += (target - this.amoIndex) * relaxAlpha;
  }

  // Slow basin-mean SST anomaly (deg C), ENSO-like breathing.
  // (kept as a thin alias so existing callers relying on the old name
  // still work — the real computation now lives in ensoSstAnomaly above.)

  // Seasonal favorability in [0, 1], peaking at SEASON.peakDayOfYear with
  // a Gaussian falloff, but hard-gated to zero outside the real season
  // window — genesis simply doesn't happen in January.
  seasonalFactor(dayNum) {
    const doy = dayNum % TIME.daysPerYear;
    if (doy < SEASON.startDayOfYear || doy > SEASON.endDayOfYear) return 0;
    let d = Math.abs(doy - SEASON.peakDayOfYear);
    if (d > TIME.daysPerYear / 2) d = TIME.daysPerYear - d;
    const g = Math.exp(-0.5 * Math.pow(d / SEASON.width, 2));
    return SEASON.floor + (1 - SEASON.floor) * g;
  }

  // Blend factor used for SST/high-position climatology (0 outside the
  // hard window is too abrupt for those — a storm shouldn't see the ocean
  // instantly change temperature at midnight on the season boundary — so
  // this version keeps a soft floor even outside the genesis window).
  climatologyBlendFactor(dayNum) {
    const doy = dayNum % TIME.daysPerYear;
    let d = Math.abs(doy - SEASON.peakDayOfYear);
    if (d > TIME.daysPerYear / 2) d = TIME.daysPerYear - d;
    const g = Math.exp(-0.5 * Math.pow(d / (SEASON.width * 1.6), 2));
    return 0.15 + 0.85 * g;
  }

  // Combined convective favorability used by genesis + intensity dry-air coupling.
  // MJO sets the broad envelope; CCKW modulates on top, but only really matters
  // (like in nature) when the MJO envelope isn't actively hostile.
  combinedFavorability(lon, dayNum) {
    const mjo = this.mjoFavorability(lon, dayNum);
    const cckw = this.cckwFavorability(lon, dayNum);
    const cckwWeight = 0.5 + 0.5 * Math.max(0, mjo); // damp CCKW inside MJO-suppressed phase
    return Math.max(-1, Math.min(1, mjo + cckw * cckwWeight * 0.6));
  }
}
