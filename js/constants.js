// constants.js — all tunable numbers live here so the physics can be
// balanced without hunting through the model code.

export const GRID = {
  // Real Atlantic basin display extent: Gulf of Mexico/Central America to
  // the West African coast, equator to the mid-latitudes. Widened east
  // and west (beyond the "working" basin itself) specifically to hit the
  // Wikipedia reference's exact aspect ratio (1280x792 = 1.6162) while
  // keeping BOTH full tropical/Caribbean/MDR coverage from the equator
  // AND reaching Greenland/Iceland by default — solving that requires
  // more longitude than the basin itself needs; see js/render.js's
  // aspect-ratio math and GRID.defaultViewLat1 below for the other half
  // of this calculation.
  lat0: 0,      // southern edge, deg N
  lat1: 70,     // northern edge, deg N — extended to cover Greenland/Iceland/UK, matching the requested reference extent
  lon0: -118,   // western edge, deg (negative = west) — extra room into Mexico/E.Pacific for aspect-ratio purposes
  lon1: 14,     // eastern edge — extra room into Europe/N.Africa for aspect-ratio purposes
  res: 1,       // degrees per cell
};
GRID.nLat = Math.round((GRID.lat1 - GRID.lat0) / GRID.res) + 1;
GRID.nLon = Math.round((GRID.lon1 - GRID.lon0) / GRID.res) + 1;
// The simulation grid extends to 70N so physics (ET storms, troughs,
// the Icelandic Low, etc.) has real room to work with. The default
// visible map crops to lat1=62.97 — solved precisely (not eyeballed) to
// hit the reference's exact aspect ratio using the wider longitude span
// above, while keeping full tropical coverage from the equator AND
// reaching Greenland/Iceland, rather than trading one off against the
// other. A person can still pan/zoom further north/east/west manually.
GRID.defaultViewLat1 = 62.97;

export const TIME = {
  hoursPerTick: 6,
  ticksPerSecond: 4,
  daysPerYear: 365,
};

// Atlantic hurricane season climatology peaks ~Sept 10 (day-of-year ~253),
// consistent with NHC's seasonal probability curve. Genesis is hard-gated
// to a real season window (roughly late April through mid-December) rather
// than trailing off asymptotically forever.
export const SEASON = {
  peakDayOfYear: 253,
  width: 42,
  startDayOfYear: 108,   // ~Apr 18 — essentially no genesis before this
  endDayOfYear: 354,     // ~Dec 20 — essentially none after this
  floor: 0.04,
};

export const OSCILLATIONS = {
  mjoPeriodDays: 45,
  mjoAmplitude: 1.0,
  mjoWavelengthFrac: 0.9,
  cckwPeriodDays: 6,
  cckwAmplitude: 0.6,
  cckwWavelengthFrac: 0.35,
  // ENSO-like index (roughly -2..+2, ~ONI-style), built from a couple of
  // slow, incommensurate sinusoids rather than one clean sine — gives a
  // more irregular, realistic-feeling multi-year cycle without needing a
  // real stochastic driver. Negative = La Nina-like (favorable), positive
  // = El Nino-like (hostile), matching real Atlantic season correlation.
  // ENSO index is now scaled to directly represent the actual Nino 3.4
  // region SST anomaly in deg C (matching NOAA's operational ONI
  // convention), not an arbitrary unitless index — standard categories:
  // Neutral -0.5 to +0.5, Weak 0.5-1.0, Moderate 1.0-1.5, Strong 1.5+.
  // Real ENSO events regularly reach 2.0-2.5C at peak strength (e.g. the
  // 1997-98 and 2015-16 El Ninos).
  ensoPeriodADays: 950,
  ensoPeriodBDays: 620,
  ensoAmplitude: 1.6,
  ensoEnvelopePeriodDays: 1310, // incommensurate with both periods above — independent strength variation
  ensoEnvelopeAmplitude: 0.42,  // lets peak magnitude range roughly 0.9x to 1.4x the base amplitude
  ensoSstCoeffC: 0.13,     // deg C of Atlantic-wide SST anomaly per deg C of Nino 3.4 anomaly (teleconnection is damped, not 1:1)
  ensoShearCoeffKt: 6.2,   // kt of basin shear added per deg C of Nino 3.4 anomaly (El Nino => more shear)

  // North Atlantic Oscillation-like index (roughly -3..+3, ~NAO-index
  // scale). Independent, faster-varying than ENSO (real NAO fluctuates on
  // weekly-to-seasonal timescales, not just multi-year). -NAO: weaker/
  // displaced-south Azores high (favors earlier/more recurves), warmer
  // tropical SST anomaly, cooler subtropics. +NAO: stronger, more
  // poleward-displaced high (storms track farther west before any
  // recurve), warmer subtropics, cooler tropics — matches the real
  // NAO-SST dipole and its effect on Atlantic hurricane tracks.
  naoPeriodADays: 70,
  naoPeriodBDays: 190,
  // NAO-like index, roughly -3..+3. Genuinely persistent, stateful
  // "regime" process (see stepNao in oscillations.js) rather than a pure
  // sinusoid — real NAO can sit in one phase for months before flipping,
  // which a smooth periodic function can't reproduce no matter how the
  // periods are tuned (it always flips on a fixed schedule).
  naoAmplitude: 1.6, // retained for reference/back-compat; not used by stepNao directly
  naoRegimeCorrelationDays: 110,   // how long a NAO regime tends to persist before drifting away
  naoRegimeNoiseSigma: 0.082,      // day-to-day stochastic driving noise (reduced — cuts noisy flicker near zero while keeping real regime drift)
  naoHighLatShiftDeg: 5,      // how far the high's latitude shifts per unit NAO
  naoHighLonShiftDeg: 7,       // how far the high's longitude shifts per unit NAO
  naoHighStrengthCoeff: 0.16,  // strength change per unit NAO (+NAO = stronger high)
  // NAO SST signature as a real tripole (not a smooth latitude gradient):
  // three latitude bands of alternating sign, each amplitude-modulated by
  // the NAO index — this is what produces distinct warm/cool *swaths*
  // (like the real NOAA CRW SSTA product) instead of one boring uniform
  // blend. Band 1 (tropics) and Band 2 (subtropics) are opposite sign, and
  // Band 3 (mid-latitude, ~35-50N) opposes Band 2 again, matching the
  // real NAO SST tripole structure in the North Atlantic.
  naoBand1LatCenter: 12, naoBand1Width: 9, naoBand1CoeffC: -0.55,
  naoBand2LatCenter: 28, naoBand2Width: 8, naoBand2CoeffC: 0.6,
  naoBand3LatCenter: 42, naoBand3Width: 7, naoBand3CoeffC: -0.65,
  naoSwathNoiseScaleDeg: 14,  // spatial scale of the organic swath texture
  naoSwathNoiseAmp: 0.45,     // how much the noise modulates band strength (organic, not zonal stripes)
};

// AMO (Atlantic Multidecadal Oscillation) — unlike ENSO/NAO/MJO, which
// are all pure functions of simulated day, the AMO here is genuine
// persistent state (see OscillationState.stepAmo in oscillations.js):
// far more inertial than the NAO, it changes on a timescale of months to
// years rather than weeks, and real AMO regimes are themselves partly
// sustained/reinforced by prolonged NAO patterns (months of +NAO tends to
// leave a cold MDR / warm subtropics signature that can nudge the AMO
// state negative, and vice versa for sustained -NAO). +AMO warms the
// tropics/MDR broadly (basin-coherent, unlike the NAO's dipole/tripole);
// -AMO cools it.
export const AMO = {
  baselinePeriodDays: 3200,     // ~9 years — even slower independent rhythm
  baselineAmplitude: 0.28,      // reduced further — AMO should read as a subtle, slow regime signal
  naoEmaHalfLifeDays: 260,      // very long smoothing — only genuinely sustained NAO regimes register
  naoForcingCoeff: 0.24,        // gentler pull from sustained NAO
  relaxHalfLifeDays: 420,       // strong inertia — AMO regimes persist well over a year once established
  tropicalSstCoeffC: 0.4,       // deg C per unit AMO index, basin-coherent (not just the MDR, but strongest there)
  tropicalWidth: 16,            // broad — AMO isn't a narrow band the way the NAO tripole terms are
  tropicalCenterLat: 15,
  genesisThresholdShift: 0.05,  // +AMO lowers the effective genesis bar (more storms); -AMO raises it (fewer)
  waveIntervalShiftFrac: 0.22,  // +AMO shortens the wave-spawn interval (more storms); -AMO lengthens it
};

// MDR/East Atlantic SST anomaly feedback: a genuinely basin-scale
// atmospheric response, not just local warmth. A warm MDR/East Atlantic
// (from reduced trades / -NAO / +AMO) measurably increases tropical
// instability and relative humidity and further suppresses shear — real
// meteorology, and the mechanism that lets a handful of favorable years
// compound into genuinely explosive seasons rather than just a slightly-
// warmer-than-average one. A cold MDR/East Atlantic (increased trades /
// +NAO) does the reverse: increased basin subsidence, drier air, more
// shear, suppressing the season. Deliberately lagged by one tick (reads
// last tick's basin-average anomaly) rather than restructuring the whole
// per-cell loop into two passes — a small real-world lag is physically
// defensible and far cheaper to compute.
export const MDR_FEEDBACK = {
  boxLatMin: 10, boxLatMax: 20, boxLonMin: -85, boxLonMax: -20,
  dryAirCoeffPerDegC: 0.15,   // warm anomaly -> less dry air (more RH), basin-wide
  shearCoeffPerDegC: 3.6,     // warm anomaly -> less shear, basin-wide
  latWeightMaxLat: 35,        // feedback strongest in the tropics/subtropics, fades by this latitude
};

export const ENVIRONMENT = {
  // Caribbean monsoon trough geometry/variability — lives here (not in
  // GENESIS) because Environment.monsoonTroughStrength/Geometry (which
  // read these) only imports ENVIRONMENT, not GENESIS. Was originally
  // placed in GENESIS by mistake, which silently broke the entire
  // monsoon trough system: every one of these resolved to undefined,
  // so dayNum*undefined (and everything downstream of it) was NaN, and
  // NaN lat/lon comparisons are always false — meaning genesis, GPI
  // boost, and rendering were all quietly no-ops the whole time despite
  // looking fully implemented.
  monsoonTroughBaseLat: 12, monsoonTroughBaseLon: -82,
  monsoonTroughBaseLatHalfExtent: 3, monsoonTroughBaseLonHalfExtent: 6,
  monsoonTroughMaxEastExtensionDeg: 9, monsoonTroughMaxNorthExtensionDeg: 2.5,
  monsoonTroughNoiseDriftDegPerDay: 2.2,
  monsoonTroughVariabilityAmp: 0.55,  // how much week-to-week noise can weaken/strengthen it beyond the seasonal envelope
  // SST climatology (deg C), before seasonal cycle is applied
  // SST climatology (deg C), before seasonal cycle is applied. Two
  // segments: equator->45N (the original, already-calibrated tropical/
  // subtropical curve) and 45N->70N (continuing the real cooling trend up
  // through the Gulf Stream extension, Iceland, and Greenland's coastal
  // waters) — kept as two explicit segments rather than one latFrac blend
  // across the whole 0-70N span, so extending the map north doesn't
  // silently warp the already-correct tropical/subtropical values.
  sstEquatorPeak: 29.6,
  sstEquatorOffSeason: 26.8,
  // Value AT the new subtropical breakpoint (see sstSubtropicalBreakLat
  // below) — close to the tropical peak, keeping the deep tropics/
  // subtropics essentially unchanged from before this fix.
  sstSubtropicalPeak: 28.8,
  sstSubtropicalOffSeason: 25.6,
  sstSubtropicalBreakLat: 28,   // where the steep extratropical-transition-zone drop starts
  // Lowered from 26.5/19.0 — the old two-segment curve was still
  // reading ~27.3C at 38N during peak season (comfortably within
  // MPI-table major-hurricane territory), which is what let a Cat5
  // maintain 870mb well past 38N. Real basin-average SST (away from the
  // Gulf Stream's narrow warm core specifically) drops much more by
  // here.
  sstPolewardPeak: 23.0,        // value AT 45N, peak season
  sstPolewardOffSeason: 16.5,   // value AT 45N, off season
  sstArcticPeak: 7.0,          // value AT 70N (Greenland coastal waters), peak season
  sstArcticOffSeason: 1.0,     // value AT 70N, off season (near/below freezing)
  sstClimatologyMidLat: 45,    // the lat0->45N / 45N->70N segment boundary
  sstClimatologyMaxLat: 70,    // reference latitude for the arctic endpoint (kept explicit, not grid-derived)
  sstWarmPoolBoost: 3.0,      // extra warmth over the Caribbean/Gulf lobe (peak Aug-Oct) -- raised to better match the real Western Hemisphere Warm Pool's spatial extent/magnitude shown in reference climatology
  warmPoolLon: -80,
  warmPoolWidth: 35,           // widened so the warm pool's influence tapers more gradually eastward instead of nearly vanishing by ~50 degrees out
  warmPoolLatCenter: 21,       // centers the boost between the Caribbean and the Gulf, so both get it
  warmPoolLatWidth: 15,
  sstHotPocketAmp: 0.9,        // localized >31C pockets within the warm pool, varies year to year
  sstHotPocketScaleDeg: 7,

  // Deep-layer shear climatology (kt), before seasonal cycle. Realistic
  // MDR shear isn't uniformly favorable even at the peak of the season —
  // noise amplitude is large enough that shorter favorable/hostile
  // stretches punctuate the mean, not just a flat "always green" baseline.
  shearBaseLowPeak: 10,
  shearBaseLowOffSeason: 17,
  // Lowered from 24/40 -- the old peak value alone put the baseline at
  // ~18kt by lat26 (before TUTT, ENSO, or any other term), leaving
  // almost no room for the subtropics/SW Atlantic ("Bermuda Triangle")
  // to ever actually dip below the 20kt genesis threshold, even during
  // otherwise-favorable synoptic moments. Real subtropical shear varies
  // enough to support genesis at times, not just structurally never.
  shearBaseHighPeak: 19,
  shearBaseHighOffSeason: 34,
  // Late-season (Oct-Dec) central/eastern MDR shear increase — see
  // environment.js for why this is a separate, asymmetric term rather
  // than relying on the general seasonal climatology above. Ramp starts
  // day 274 (Oct 1) and is fully in by day 334 (Nov 30); box roughly
  // covers the real Cabo Verde wave corridor.
  lateSeasonMdrShearStartDoy: 274,
  lateSeasonMdrShearRampDays: 60,
  lateSeasonMdrShearLonCenter: -27,
  lateSeasonMdrShearLonWidth: 15,
  lateSeasonMdrShearLatCenter: 13,
  lateSeasonMdrShearLatWidth: 7,
  lateSeasonMdrShearBoostKt: 17,
  midLatShearTaperStartLat: 28,  // ridge/MJO shear suppression starts fading out beyond here
  midLatShearTaperWidthDeg: 10,  // and is fully gone (jet's own shear dominates) by ~this much further poleward
  shearNoiseAmp: 16,
  shearNoiseScaleDeg: 11,
  shearNoiseDriftDegPerDay: 3,
  // Tropical steering noise — genuine day-to-day synoptic variability in
  // the trade-wind flow, tapered out toward the mid-latitudes (where the
  // westerlies/jet already provide plenty of real variability of their
  // own via troughs).
  // Two-layer steering: 500mb (mid-level, hurricanes/majors) is the
  // plain climatological field with no extra high-frequency noise;
  // 850mb (low-level, waves/weak TD-TS) carries the genuine day-to-day
  // trade-wind variance instead — real 850mb flow swings much more than
  // 500mb (surges past 30kt in the MDR, or slackens to near nothing).
  steerNoiseDriftDegPerDay: 3.4,
  steer850TaperMaxLat: 27,           // 850mb layer fades out toward the mid-latitudes, where storms are already hurricane-strength (mostly 500mb) by the time they get there
  steer850TradeMultiplier: 1.35,     // 850mb trade flow runs measurably stronger than the smoothed 500mb-equivalent base
  steer850NoiseAmpKt: 11,            // the actual "fast trades over 30kt, or very slow trades" variance
  steer850ReferenceMagnitudeKt: 15,  // baseline 850mb magnitude the MDR SST feedback treats as "neutral"
  steer850SstCoeffPerKt: 0.045,      // deg C of MDR SST shift per kt of 850mb magnitude deviation from the reference above
  shearMjoCckwCoeffKt: 7,   // unfavorable MJO/CCKW phase adds shear, favorable phase cuts it

  // Bermuda-Azores subtropical high: the dominant steering feature of the
  // basin. Storms track along its southern/western periphery, then recurve
  // north once they round its western edge or a trough erodes it.
  highLat: 30,
  // Background/ambient MSLP field — see environment.js for the
  // reasoning. Reference matches standard atmosphere; ridge/trough
  // coefficients tuned so a strong subtropical high reaches roughly
  // 1022-1025mb (real healthy-ridge territory) and a strong trough or
  // very warm Caribbean/Gulf/BoC water dips to roughly 1004-1008mb.
  bgPressureReferenceMb: 1013,
  bgPressureRidgeMbPerUnit: 11,
  bgPressureTroughMbPerUnit: 9,
  bgPressureSstBaselineC: 27,
  bgPressureSstMbPerDegC: 2.6,
  highLonPeak: -45,
  // The Icelandic Low — the real "other half" of the NAO seesaw (NAO is
  // literally defined as the Icelandic Low / Azores High pressure
  // difference). Wasn't worth modeling before the map only showed up to
  // 45N; now that the North Atlantic up to Iceland is actually visible,
  // this completes the mechanic physically, not just the high's own
  // strength scaling. +NAO deepens it (enhanced gradient, more zonal
  // jet); -NAO weakens it — the same direction the high already responds to.
  icelandicLowLat: 63,
  icelandicLowLon: -20,
  icelandicLowWidth: 13,
  icelandicLowBaseStrength: 0.55,
  icelandicLowNaoCoeff: 0.32,
  highLonOffSeason: -25,
  highStrengthPeak: 1.0,
  highStrengthOffSeason: 0.55,
  highRadiusDeg: 27,

  // Traveling mid-latitude troughs that dip in from the west and can pick
  // up a recurving storm ("the trough grabs the storm"). Strength and
  // position now wobble independently per trough (on top of the shared
  // NAO/pattern signal) so the mid-latitude pattern doesn't feel static.
  troughCount: 2,
  // Absolute latitude the traveling troughs oscillate around — kept
  // independent of GRID.lat1 on purpose. Grid extent is a display/land-
  // data concern (e.g. extending north to show Iceland/Greenland); trough
  // latitude is a real mid-latitude-belt physics constant and must not
  // silently shift just because the map got taller.
  // Real troughs affecting Atlantic hurricane steering emerge from a
  // wide range of latitudes, but not symmetrically — commonly from
  // Canada or the Northeast US, only rarely as far south/west as the US
  // Southwest during hurricane season. The sine term below (tied to
  // each trough's fixed phase) turned out to contribute nothing at all
  // with troughCount=2 evenly spaced 180 degrees apart — sin(0)=sin(180
  // degrees)=0 for both, so the *entire* actual spread was coming from
  // the noise term alone, much narrower than the formula's range
  // suggested on paper. Raised the base/noise amplitude and made the
  // noise asymmetric — pushed further when it nudges north (Canada/NE
  // common), damped when it nudges south (rare Southwest excursion).
  troughLatBase: 43,
  // Absolute longitude the traveling troughs' cycle is anchored to —
  // kept independent of GRID.lon0 for the same reason troughLatBase is
  // independent of GRID.lat1: grid extent is a display/land-data
  // concern, trough travel is a real physics calibration that shouldn't
  // silently shift just because the map's visible bounds change.
  troughLonRangeStart: -120,
  // Real West African coast reference point for the SAL east-west
  // gradient and traveling dry-air pulses — kept as an explicit absolute
  // longitude (not derived from GRID.lon1) for the same reason: this is
  // a real geographic anchor (SAL outbreaks originate near the coast),
  // not something that should silently move if the grid's display
  // bounds change.
  africanCoastLon: 0,
  troughDriftDegPerDay: 4.5,
  troughStrength: 0.85,
  troughRadiusDeg: 16,
  troughStrengthNoiseAmp: 0.35,   // fractional strength wobble per trough
  troughLatNoiseAmpDeg: 10,        // extra north-south wander per trough (raised — see troughLatBase note)
  troughLatNoiseSouthDampen: 0.55, // southward noise excursions are damped relative to northward ones -- the actual asymmetry (rare Southwest, common Canada/NE)
  troughNoiseDegPerDay: 0.9,

  // Subtropical/polar jet stream — purely a visual/200mb-overlay feature
  // (does NOT feed into storm steering or shear, which stay calibrated to
  // the Bermuda-high/trough system alone). Real jet position correlates
  // with the NAO, so it's tied to the same index: +NAO -> stronger, more
  // zonal, more poleward jet; -NAO -> weaker, more southward/meridional.
  jetLatBase: 40,
  jetWidthDeg: 6,
  jetSpeedKt: 65,
  jetNaoLatShiftDeg: 4,
  jetNaoSpeedCoeffKt: 14,
  jetStreakBoostKt: 32,     // reduced from 55 -- extra speed near a trough's exit region
  jetStreakRadiusDeg: 14,
  jetSteeringFraction: 0.28, // further reduced from 0.4 -- even at 0.4, a test storm crossed Newfoundland's longitude (-52) at only 36.6N, nowhere near the 47-51N needed; the eastward component was still overwhelming the northward trough-capture pull

  // Trough/cutoff-low "capture": once a storm gets within range of a
  // traveling trough, it gets pulled poleward and accelerated eastward
  // (the real mechanism behind early/sharp recurves and the forward-speed
  // increase that comes with them), on top of whatever the smooth
  // geostrophic gradient already contributes.
  troughCaptureRadiusDeg: 17,  // reduced from 24 -- that radius let even a trough sitting well north (33N+, its now-typical position) meaningfully tug on Caribbean-latitude storms far south of it, causing "wacky" tracks from troughs that were never realistically close enough to matter. A trough now has to be genuinely nearby (or have moved meaningfully south) to actually pick a storm up.
  // Single magnitude, not separate U/V coefficients — the pull's
  // direction now comes from the actual rotated geometry (see
  // _troughCapture in storm.js), not a fixed "mostly north, some east"
  // split that applied no matter where the trough actually was.
  troughCaptureMagKtPerStrength: 19,  // raised from 13 -- a storm needs to gain latitude fast enough relative to its eastward drift during the 30-45N transit to actually reach the Newfoundland/Atlantic Canada window before being carried too far east; confirmed via direct testing that 13 wasn't enough even after taming the jet's eastward contribution separately
  troughOutflowBoostRadiusDeg: 12,
  troughOutflowBoostMaxKt: 9,

  troughShearBoost: 16,
  // TUTT (Tropical Upper Tropospheric Trough): a real, semi-permanent
  // subtropical feature (not a transient traveling trough) that sits over
  // the central subtropical Atlantic through peak season and is a major
  // reason MDR/subtropical shear isn't uniformly low even at climatological
  // peak favorability.
  tuttLat: 20, tuttLon: -40, tuttWidth: 10,
  tuttShearBoost: 8, tuttPeakDayOfYear: 220, tuttSeasonWidth: 45, tuttFloor: 0.08,
  // Tropical Easterly Jet — real, strong, seasonal upper-level easterly
  // flow tied to the African/Asian monsoon circulation, centered over
  // the eastern tropical Atlantic/West Africa. Speed set well above
  // typical low-level trade speeds so the resulting shear vector over
  // the eastern MDR is genuinely easterly-dominated, matching real
  // climatology, rather than ending up dominated by the lower layer.
  tejLat: 10, tejLonCenter: -15, tejLonWidth: 22, tejLatWidth: 8,
  tejSpeedKt: 42, tejPeakDayOfYear: 220, tejSeasonWidth: 50,
  // Traveling upper-level anticyclones — see _updateUpperAnticyclones in
  // environment.js.
  anticycloneSpawnLat: 12,
  anticycloneSpawnLon: -10,       // just off the West African coast
  anticycloneLatJitterDeg: 5,
  anticycloneIntervalDaysPeak: 7,       // one roughly every week during monsoon peak
  anticycloneIntervalDaysOffSeason: 40, // much rarer off-season
  anticycloneDriftDegPerDay: 3.2,       // westward drift
  anticycloneMeanderDegPerDay: 0.9,     // meander amplitude (mean-reverting via sin, not a random walk that wanders unboundedly)
  anticycloneNoiseLatDegPerDay: 0.6,    // additional genuine randomness on top of the meander
  anticycloneMaxLifespanDays: 24,       // raised from 12 -- the old value times the drift rate only covered ~38 degrees of travel, which couldn't even reach the western MDR let alone the Caribbean (~75 degrees away); most will still decay/dissipate over the open MDR from the meander variance alone, but this actually allows the ones that don't to reach the Caribbean as intended
  anticycloneRadiusDeg: 9,
  anticycloneVentilationAidKt: 9,       // outflow/ventilation boost for a storm sitting right under one
  tuttEnsoCoeff: 0.3,  // per deg C of Nino 3.4 anomaly — El Nino strengthens/sustains the TUTT, La Nina weakens it
  // Upper-level lows: short-lived, localized shear pockets (episodic
  // passages of a cutoff low aloft) rather than smoothly-varying noise —
  // modeled as a coarse noise field with a threshold, so most of the time
  // a given spot sees nothing extra, but occasionally gets hit with a
  // sharp, real shear spike.
  ullNoiseScaleDeg: 13, ullThreshold: 0.42, ullMaxBoost: 20, ullDriftDegPerDay: 2.5,
  // Natural upper-level lows are predominantly a western Atlantic/
  // Caribbean/Gulf phenomenon climatologically — genuinely uncommon in
  // the central/eastern Atlantic. Restricts where a natural ULL core can
  // be detected at all, not just how it behaves once present.
  ullMaxLon: -48,
  // Wave breaking downstream of a recurving storm: a storm embedded in
  // (or near) the jet locally enhances shear around itself for a while
  // afterward, standing in for the real Rossby-wave-breaking response to
  // a recurving cyclone's outflow — genuinely stateful, decayed each tick.
  waveBreakingDecayHalfLifeDays: 2.5,
  waveBreakingDepositRadiusDeg: 7,
  waveBreakingMaxKt: 14,
  // Split into zonal (U) and meridional (V) scales — see the note at
  // the call site in environment.js for why a single shared scale
  // wasn't producing enough curvature around the subtropical ridge's
  // western periphery. V raised well above U specifically to fix that.
  steeringGeostrophicScaleU: 95,
  steeringGeostrophicScaleV: 200,
  // East-side-of-ridge scale, much closer to the original pre-boost
  // value — see the note at the geoV call site in environment.js for
  // why the boosted value can't be applied symmetrically.
  steeringGeostrophicScaleVEastSide: 85,
  // Ridge-weakness pulse (see the geoV call site in environment.js) —
  // occasional, genuine early-recurve opportunity for eastern/central
  // MDR systems. Amplitude sized to be a real, substantial northward
  // pulse when it fires (comparable to the west-side curvature itself),
  // not a token nudge — early recurves are a real but not-constant
  // occurrence, matching how this should feel.
  ridgeWeaknessDriftDegPerDay: 1.4,
  ridgeWeaknessMaxKt: 5.5,
  // Ridge-weakness "chaining": a real break the ridge takes real time to
  // rebuild from — once one storm has genuinely exploited a weakness
  // (see Environment.ridgeWeaknessEvents / _ridgeWeaknessNoiseValueAt), a
  // trailing storm passing near that same spot within this window gets an
  // extra decaying shot at the same opening, rather than the ridge always
  // having silently re-formed by the time a following storm arrives.
  ridgeWeaknessEventThreshold: 0.5,   // raw noise value (~[-1,1]) that counts as "genuinely exploited", not routine texture
  ridgeWeaknessChainDays: 3.5,
  ridgeWeaknessChainRadiusDeg: 6,
  // Storm-induced upper-level ridging: a real, and previously only
  // visual, feature of organized TC outflow — strong anticyclonic
  // divergence aloft genuinely raises 500mb heights around/downstream of
  // a storm, which in turn perturbs the geostrophic steering (and, via
  // the shared upperHeight field, the shear) nearby storms actually feel.
  // Radius formula matches the pre-existing (visual-only) outflow display
  // in environment.js so the two stay physically consistent with each
  // other.
  stormOutflowRadiusBaseDeg: 6,
  stormOutflowRadiusPerKt: 22,
  stormOutflowHeightPerKt: 0.0068,  // a 130kt major reaches roughly the same peak height contribution as a moderate ridge cell
  stormOutflowMaxHeight: 0.85,
  // Trade wind speed varies seasonally — genuinely faster early season,
  // relaxing through peak season (a real contributor to why peak-season
  // storms can slow down and intensify more when they do get a window),
  // partially recovering late season. Also raised overall versus a flat
  // constant — storm motion was running slow enough to meaningfully
  // inflate ACE by letting storms dwell too long over favorable water.
  tradeEasterlyEarlySeasonKt: 20,   // ~June
  tradeEasterlyPeakSeasonKt: 15,    // ~early September, the seasonal minimum
  tradeEasterlyLateSeasonKt: 17,    // ~November, partial recovery
  tradeSeasonTroughDay: 248,
  westerlyOnsetLat: 32,        // raised from 28 -- real mid-latitude flow doesn't become mostly westerly until closer to 40N, not 33N; this puts the 50%-westerly point at ~39N instead of ~35N
  westerlyRampWidthDeg: 14,    // fully westerly by roughly westerlyOnsetLat + this (~46N)
  midLatWesterlyKt: 22,        // realistic mid-latitude prevailing westerly steering speed
  // Western Caribbean/Bay of Campeche steering "dead zone" — real climo,
  // and the mechanism that lets a lingering storm there blow up.
  wCaribbeanDeadZoneLon: -85,
  wCaribbeanDeadZoneLat: 18,
  wCaribbeanDeadZoneWidthDeg: 9,
  wCaribbeanDeadZoneStrength: 0.55, // fraction of trade-wind speed removed at the zone's center
  betaDriftKt: 2.7,

  dryAirNoiseScaleDeg: 20,
  dryAirDriftDegPerDay: 5.5,   // now matches real trade-wind translation speed (was lagging behind the actual trades)
  dryAirContinentalStrength: 0.62,
  dryAirNoiseWeight: 0.35,     // reduced further — the noise was diluting the clean east-west flow signal, not just adding texture to it
  dryAirFavorableRelief: 0.2, // how much a favorable MJO/CCKW phase cuts dry-air intrusion (was 0.3, trimmed)
  dryAirEastWestSpanDeg: 85,   // how far west the basin-scale dry (east) -> moist (west) gradient extends — most of the basin, not just near Africa
  dryAirTroughInjectionMax: 0.3, // extra dry-air fraction injected near a trough (mid-lat lows entraining dry air southward)
  dryAirTroughInjectionRadiusDeg: 16,

  // Discrete, traveling SAL outbreak pulses — real Saharan Air Layer
  // events are episodic plumes that emerge off Africa and cross the
  // Atlantic over 1-2 weeks, weakening as they go, not a static haze.
  // Modeled as a small number of overlapping traveling pulses (a pure
  // function of day, like the MJO/CCKW waves) rather than one smooth field.
  salPulseIntervalDays: 9,
  salPulseSpeedDegPerDay: 4.3,
  salPulseLifetimeDays: 13,
  salPulseWidthDeg: 11,
  salPulseLatCenter: 15,
  salPulseLatWidth: 9,
  salPulseStrength: 0.55,

  // Saharan Air Layer: a real, seasonal, not-constant dry/dusty outbreak
  // pattern off West Africa — peaks around early-mid July, then
  // meaningfully declines through mid-August onward (matches NASA/NOAA
  // tropical Atlantic dust-cover climatology).
  salPeakDayOfYear: 185,
  salWidth: 32,
  salPeakStrength: 1.0,
  salFloor: 0.28,

  // Slow, non-tropical "pattern noise" perturbing the high's position and
  // strength day to day — stands in for transient ridging/troughing from
  // the mid-latitude flow that isn't captured by the smooth seasonal blend.
  // Measured directly (tools/high-survey.mjs) before widening these:
  // across 2 simulated seasons the high's latitude only ever ranged
  // 25.1-34.1N and pressure only 1022-1033mb (<1023mb just 1.9% of the
  // time) — real Azores-Bermuda high excursions go further both ways
  // (as far NE as ~38N/27W, as far south/weak as ~28N/44W in the low
  // 1020s, and occasionally past 1030mb) than that range covers.
  // Latitude previously had NO independent day-to-day wobble at all —
  // only the NAO's persistent-regime shift (naoHighLatShiftDeg) moved it
  // — which is what kept it from ever reaching the NE excursion example
  // regardless of how far NAO or the longitude noise moved separately.
  patternNoiseDegPerDay: 0.6,
  patternNoiseLonAmpDeg: 10,
  patternNoiseLatAmpDeg: 7,
  patternNoiseStrengthAmp: 0.34,
};

// Fujiwhara interaction between two live tropical cyclones, plus the
// related "a dominant storm's outflow shears/absorbs a nearby weaker one"
// mechanics. Kept as its own block (not folded into STORM) since these are
// inherently storm-pair effects, not single-storm physics.
export const FUJIWHARA = {
  // Real Fujiwhara interaction becomes noticeable within roughly 750-1400km
  // separation; ~8 degrees (~890km at these latitudes) is a reasonable
  // basin-scale stand-in given the grid's 1-degree resolution.
  interactionRadiusDeg: 8,
  // Max mutual-orbit contribution to motion (kt) at zero separation and
  // full combined intensity — scaled down by both proximity and combined
  // strength inside _fujiwharaInteraction, so this is a ceiling, not a
  // typical value.
  orbitMagKt: 22,
  // A neighbor has to be at least this many times stronger before its
  // outflow is treated as genuinely dominant/shearing (comparable-strength
  // pairs mostly just orbit each other, per real Fujiwhara cases).
  outflowDominanceRatio: 1.3,
  outflowBaseRadiusDeg: 3.5,
  outflowShearMaxKt: 9,
  // Absorption: real, but only at sustained very-close range against a
  // meaningfully stronger system — not a hair-trigger merge the instant
  // two circulations' outer wind fields touch.
  absorptionRadiusDeg: 2.2,
  absorptionDominanceRatio: 1.8,
  absorptionDays: 0.75,
  absorptionSizeBoost: 1.06, // modest, one-time size bump to the surviving storm
};

// Interactive per-storm track "wobble" — a mean-reverting random
// perturbation to motion, standing in for non-tropical/synoptic influences
// (frontal interactions, transient ridges, etc.) that real forecast tracks
// have to account for. Keeps every storm's path from being a deterministic
// function of its birth point.
export const TRACK_WOBBLE = {
  decayPerDay: 1.1,     // mean-reversion rate
  noiseKtPerSqrtDay: 5.5, // random-walk driving noise scale
  maxKt: 14,             // clamp so it perturbs, doesn't dominate, steering
};

// Subtropical / "cutoff low" genesis: occasionally a mid-latitude trough
// pinches off a cutoff low that, over warm enough water with tolerable
// shear, can acquire a warm core and become a subtropical/tropical
// cyclone — a real and fairly common Atlantic genesis pathway, especially
// in the shoulder months.
export const SUBTROPICAL = {
  chancePerTroughPerTick: 0.0016,  // doubled from 0.0008 -- that value was calibrated against a much less favorable environment (SST threshold, eligible latitude, and now shear have all been separately fixed to be more favorable since), so the effective production rate had likely fallen well below the original 1-4/season target
  chancePerUllPerTick: 0.0028,     // similarly doubled from 0.0015
  ensoGenesisCoeff: 0.35,  // per deg C of Nino 3.4 anomaly — El Nino favors the subtropical pathway over MDR/Caribbean genesis
  minSst: 20.0,          // lowered from 22.5 -- the SST climatology fix (cooling the 28-45N zone to stop storms holding major intensity that far north) also made this threshold fail too often near the northern end of the trough-eligible zone, which is where subtropical genesis mostly happens; subtropical systems draw some baroclinic energy too, so tolerating cooler water than a pure warm-core system needs is physically correct anyway
  maxShear: 26,
  minLat: 22,
  maxLat: 44,  // widened from 40 -- troughs now run more northern-biased (Canada/NE emergence, see troughLatBase) than when this was originally calibrated, so keeping this at the old value would have quietly shrunk cutoff-low/subtropical genesis exposure
  // The grid was widened west (past -100) purely for display/aspect-
  // ratio purposes, reaching genuinely into Eastern Pacific territory —
  // a separate basin with its own distinct climatology this sim doesn't
  // model. Genesis pathways that scan trough/ULL positions across the
  // whole grid need an explicit gate so nothing spawns west of the real
  // Atlantic/Caribbean/Gulf basin and gets miscounted as an Atlantic
  // storm.
  minGenesisLon: -98,
  // Longitude alone can't correctly separate the basins near Central
  // America — the Pacific coastline curves well east of the general
  // -98 boundary along its entire run from Panama up through southern
  // Mexico, not just near Panama. See EPAC_COAST_SEGMENTS in
  // simulation.js for the full piecewise coastline boundary.
};

export const GENESIS = {
  // Real tropical cyclogenesis is suppressed right next to an existing
  // circulation (subsidence/outflow from an already-organized system) —
  // this is a hard floor against genesis essentially on top of another
  // storm, on top of (not instead of) the gradual, physical suppression
  // a storm's own outflow now imposes on the shared shear field.
  minGenesisSeparationDeg: 3.5,
  waveIntervalDaysPeak: 5.6,
  waveIntervalDaysOffSeason: 15.0,
  // ITCZ proximity gives a modest baseline genesis boost (a genuinely
  // favorable convergence zone, even without a closed circulation of
  // its own), plus an additional stable-but-directional "aid or delay"
  // swing specifically for tropical waves interacting with it — real
  // ITCZ interaction can go either way for a wave's own organization.
  itczProximityDeg: 4,
  itczGpiBoost: 0.12,
  itczWaveInteractionSwing: 0.16,
  // ITCZ "roll-up" genesis: a standalone pathway distinct from wave-
  // triggered genesis — real East Atlantic ITCZ roll-ups can become
  // anything from a short-lived weak depression to a full major
  // hurricane, which just falls out of the existing ceiling/RI/outflow
  // variance once one forms, same as any other genesis pathway.
  itczRollupChancePerTick: 0.0032,
  itczRollupLonMin: -34, itczRollupLonMax: -14,
  // Caribbean monsoon trough — real, seasonal (see
  // Environment.monsoonTroughStrength/monsoonTroughGeometry), and
  // distinct from the ITCZ: broader, can sit well away from the
  // equator, and can produce genesis on its own or boost wave/CAG
  // genesis when co-located. Anchored on Central America/the
  // southwestern Caribbean — not spread evenly across "the Caribbean"
  // as a whole — but migrates, extending further east/north depending
  // on the day's larger pattern rather than sitting in one fixed box.
  // (Geometry/variability constants themselves live in ENVIRONMENT, not
  // here — see the note there for why.)
  monsoonTroughGpiBoost: 0.14,
  monsoonTroughRollupChancePerTick: 0.0026,  // reduced from 0.0034 -- see the CAG chancePerTick note; both Caribbean-region pathways were combining to overproduce
  // Absolute wave-source longitude — near the real West African coast
  // where easterly waves actually emerge. Kept explicit (not a fraction
  // of the grid's span) for the same reason as the other longitude
  // anchors above: this shouldn't silently drift if the grid's display
  // bounds change.
  waveSourceLon: -3,
  waveSpeedKt: 12,
  // How much a wave's actual motion blends the real local steering field
  // in on top of the baseline climatological westward drift — this is
  // what lets a ridge weakness (or a genuinely weak -NAO Azores-Bermuda
  // high) actually pull a wave off its purely-climatological path,
  // including poleward, well before it ever becomes a named storm.
  waveSteeringBlendWeight: 0.5,
  // Season-to-season activity variance: -ENSO (La Nina) and a warm MDR/
  // East-Atlantic SST anomaly (also covers "warm Canary Current" — same
  // region) both directly increase genesis frequency, on top of
  // whatever they're already doing to shear/SST individually. The
  // opposite (+ENSO/El Nino, cool MDR) meaningfully suppresses it.
  ensoWaveIntervalCoeff: 0.16,
  mdrAnomalyWaveIntervalCoeff: 0.11,
  // Explicit NAO-modulated recurve bias, on top of whatever the ridge's
  // own steering gradient already contributes — only engages once a
  // wave is far enough from the deep tropics (ramping in from
  // waveRecurveLatStart to +waveRecurveLatRamp) for recurvature to be
  // physically plausible at all.
  waveNaoRecurveCoeffKt: 5.5,
  // How much a wave's genesis potential is penalized by recent land
  // exposure (see genesisPotential's landDisruption parameter), and how
  // fast that exposure accumulates/decays as it crosses/clears land.
  landDisruptionGpiPenalty: 0.85,   // at full disruption (1.0), GPI is cut by this fraction
  landDisruptionAccumPerDay: 0.6,   // ~1.7 days of continuous land exposure to reach full disruption
  landDisruptionRecoveryPerDay: 0.25, // slower to recover than to disrupt -- real structural damage doesn't heal as fast as it happens
  waveRecurveLatStart: 14,
  waveRecurveLatRamp: 10,
  waveLatJitterDeg: 7.5, // retained for reference/back-compat; peak-season jitter now driven by wavePeakSeasonJitterDeg below
  waveBaseLat: 13, // now specifically the peak-season (Aug-Sep) mean latitude
  // Full seasonal wave-latitude structure: low riders early season,
  // wider spread (not just a higher mean) by peak season, letting both
  // higher-latitude emergence and low riders happen side by side.
  waveEarlySeasonBaseLat: 9,
  waveEarlySeasonJitterDeg: 4.5,
  wavePeakSeasonJitterDeg: 10.5,
  waveEarlySeasonRampStartDoy: 152, // ~Jun 1
  waveEarlySeasonRampEndDoy: 253,   // ~Sep 10, the climatological season peak (SEASON.peakDayOfYear)
  // Late-season spawn latitude shifts south as the eastern MDR shear
  // increase (see lateSeasonMdrShearBoostKt) makes higher-latitude
  // development progressively less likely — real late-season MDR
  // activity, when it happens at all, skews lower-latitude. Ramps in
  // starting Nov 1, not Oct 15 (waves are still essentially normal
  // through mid-October).
  waveLateSeasonLatShiftStartDoy: 305, // ~Nov 1
  waveLateSeasonLatShiftFullDoy: 349,  // ~Dec 15 — fully shifted by here
  waveLateSeasonBaseLat: 9,            // where the base latitude ends up once fully shifted
  gpiThreshold: 0.72,
  gpiCheckChancePerTick: 0.14,
  // Crossing the GPI threshold used to guarantee immediate genesis —
  // effectively "if a wave ever briefly touches favorable conditions
  // once, it becomes a storm," which was producing too many successful
  // waves. Now a genuine stochastic success gate on top of crossing the
  // threshold.
  genesisSuccessBaseChance: 0.15,   // chance right at the threshold
  genesisSuccessMarginCoeff: 3.0,   // how fast success chance climbs as GPI exceeds the threshold
  maxGenesisSuccessChance: 0.9,     // capped below certainty even at the most favorable conditions
  minSstForGenesis: 26.0,
  maxShearForGenesis: 20,
  // MDR (open-Atlantic easterly wave) genesis tails off later in the
  // season, but not as a single flat rate — real activity holds up
  // reasonably well through Oct 15-Nov 1 ("still often"), becomes
  // genuinely occasional Nov 1-15, and only turns properly rare Nov 15-
  // Dec 15. Explicit day markers matching that description rather than
  // one compounding-percentage curve, which was ramping to near-max
  // slowdown by Nov 1 — too fast for what "still spawn often" means.
  mdrLateSeasonCutoffDoy: 288,       // ~Oct 15 — still ~normal through here
  mdrLateSeasonNov1Doy: 305,         // ~Nov 1 — end of the "still often" window
  mdrLateSeasonNov15Doy: 319,        // ~Nov 15 — end of the "occasional" window
  mdrLateSeasonDec15Doy: 349,        // ~Dec 15 — "rarer" window ends here (held flat after)
  mdrLateSeasonMultAtNov1: 1.3,      // gentle — still often
  mdrLateSeasonMultAtNov15: 2.2,     // occasional
  mdrLateSeasonMultAtDec15: 2.8,     // rarer — finer Nov15-Dec15 tuning deferred to a dedicated genesis pass
};

export const STORM = {
  mpiCoeffKt: 132,
  mpiSstRef: 26.0,
  // Direct tie between basin-scale ENSO/MDR conditions and
  // intensification itself, not just genesis frequency (see
  // waves.js's ensoWaveIntervalCoeff/mdrAnomalyWaveIntervalCoeff) —
  // this is what actually makes a hyperactive season hyperactive: more
  // storms AND those storms running measurably stronger, not just more
  // numerous but otherwise-ordinary ones. Same sign convention as the
  // genesis-frequency modulation: -ENSO (La Nina) and a warm MDR/East-
  // Atlantic anomaly (also covers "warm Canary Current") both boost;
  // +ENSO/a cool MDR anomaly both suppress. Kept modest per-tick since
  // this compounds over a storm's entire lifetime through the
  // relaxation-toward-MPI approach, not applied just once.
  ensoIntensifyCoeff: 0.09,
  mdrAnomalyIntensifyCoeff: 0.07,
  intensifyRateMaxKtPerDay: 66,
  weakenOverLandKtPerDay: 65,
  weakenColdWaterKtPerDay: 40,
  // Real land/cold-water decay hits majors much harder than weak
  // storms — this is what was missing from the old flat-rate decay
  // (recurving/landfalling majors were coasting along far too slowly).
  // Below this intensity threshold, no bonus applies (weak storms keep
  // the old baseline rate); above it, decay scales up with how much
  // stronger the storm is.
  landDecayIntensityThresholdKt: 60,
  landDecayIntensityCoeffPerKt: 0.6,
  coldWaterIntensityCoeffPerKt: 0.4,
  // Wind-pressure gradient mechanic: how strongly a deviation in
  // ambient background pressure (env.bgPressureMb) shifts a storm's
  // target central pressure away from the plain mean wind-pressure
  // curve, per mb of deviation. Roughly calibrated against real
  // examples of ridging (higher wind for a given pressure — MDR/open
  // Atlantic) vs troughing/warm-water (lower wind for a given pressure
  // — Caribbean/Gulf/BoC); treated as an approximate, directionally-
  // calibrated model rather than an exact fit to any single case.
  // Wind-pressure gradient mechanic: how strongly a deviation in
  // ambient background pressure (env.bgPressureMb) shifts a storm's
  // target central pressure away from the plain mean wind-pressure
  // curve, per mb of deviation. Asymmetric — ridging examples showed
  // bigger deviations from the standard curve than troughing examples
  // did, since the standard curve itself already sits closer to a
  // weak-troughing baseline. Roughly calibrated against real examples
  // (ridging: 115/958, 150/928, 170/895; troughing: 105/950, 115/937,
  // 140/910) as an approximate, directionally-correct model, not an
  // exact fit to any single case. Both the gradient term and the total
  // combined shift (gradient + residual noise) are hard-clamped —
  // learned from finding, in testing, that the naive combination of
  // extreme ridging + a small storm + high residual noise could
  // otherwise push a 115kt storm's target pressure to ~1000mb, right
  // back into the exact "impossible pairing" territory fixed last round.
  bgGradientMbCoeffRidge: 2.0,
  bgGradientMbCoeffTrough: 0.5,
  smallStormGradientMbCoeff: 4,  // additional gradient sensitivity for a small/tight core (per unit of 1-sizeFactor)
  maxGradientShiftMb: 26,
  maxTotalPressureShiftMb: 28,
  // Hard real-world ceilings on how weak pressure can read for a given
  // wind — TD/TS systems never exceed 1020mb, Cat1 hurricanes never
  // exceed 1000mb, regardless of what the flat gradient-offset clamp
  // above would otherwise allow. See _updatePressure in storm.js.
  // Weak-end pressure ceiling anchors now live in storm.js
  // (maxWeakOffsetForWind) as a smooth piecewise-linear curve rather
  // than a discrete two-tier clamp — a case-study check found the
  // discrete version was still too loose at 55kt/80kt specifically.
  pressureLagHalfLifeDays: 0.6,  // how fast pressure catches up to its gradient-implied target while INTENSIFYING — short enough for real lag during RI, not instant snapping
  // Weakening needs a much faster catch-up than intensifying does — the
  // RI lag above is a deliberate, realistic feature (wind can genuinely
  // lead pressure during rapid intensification), but the same slow lag
  // applied to weakening was letting pressure stay unrealistically deep
  // long after wind had already crashed (e.g. post-landfall), producing
  // impossible pairings like a 30kt depression sitting at 970mb. A real
  // weakening tropical cyclone's pressure recovers close behind its wind
  // loss, not on the same multi-day timescale RI intensification does.
  pressureLagHalfLifeDaysWeakening: 0.22,
  weakenShearFactor: 2.5,  // raised from 2.1 -- measured only ~17% of dissipations happening over open water (vs land/absorption) in a real season; the mechanism itself works under forced sustained hostile shear, but storms weren't reliably accumulating enough sustained penalty naturally
  ventilationShearOffsetCoeff: 0.85, // per kt of trough/outflow ventilation aid — how much marginal shear it can offset
  shearToleranceKt: 18,
  dryAirWeakenFactor: 24,
  minIntensityKt: 22,  // raised from 15 -- must stay above REM.minIntensityToPersistKt (20kt) with a small buffer, otherwise a storm would transition into remnant phase already below the remnant-persistence floor and dissipate the very next tick, defeating the whole point of the remnant-low mechanic
  troughAidMaxKt: 5,
  // A weak, disorganized system that sits below this intensity for too
  // long in unfavorable conditions doesn't just linger indefinitely in
  // reality — its structure falls apart. Without this, a storm could
  // hover in a marginal 20-40kt state for two weeks straight, which real
  // tropical systems essentially never do (they either organize further
  // or fail within a few days).
  weakLingerThresholdKt: 45,
  weakLingerResetHysteresisKt: 12, // must clear threshold+this to reset the weak-days timer, preventing flip-flop resets
  weakLingerGraceDays: 4.5,     // raised from 2.5 -- was punishing storms still actively trying to organize (found via traced failures: many TDs were plateauing at 25-33kt for 2-10 days, this active-punishment window was often the actual reason they never broke through 34kt rather than genuinely giving up)
  weakLingerExtraDecayKtPerDay: 11,
  weakLingerRampDays: 3,        // how many additional days until the extra decay reaches full strength
};

// Sustained upper-level ventilation extends a storm's effective ceiling,
// not just its approach rate. Real max potential intensity is set by SST
// (the thermodynamic MPI formula above already reaches 145-178kt at
// 30-32C — well into Cat5), but this sim's per-storm random ceiling draw
// (see storm.js constructor) was the actual binding constraint stopping
// many RI storms in great environments from ever reaching it. A storm
// that sustains real trough-outflow support (not just a passing moment
// of it) earns a growing, decaying extension on top of its base ceiling.
export const OUTFLOW = {
  emaHalfLifeDays: 1.4,       // "sustained" — a brief good moment doesn't count much, hours of it does
  qualityShearThreshold: 14,  // shear must stay below this to count as genuinely well-ventilated
  extensionPerEmaUnit: 26,    // kt of ceiling extension per unit of sustained outflow EMA
  maxExtensionKt: 19,         // hard cap on how much the ceiling can be extended
  dualChannelBonus: 1.4,      // two simultaneous outflow channels (trough+ULL, or 2 ULLs) ventilate meaningfully better than either alone
  tripleChannelBonus: 1.85,   // three or more — genuinely exceptional ventilation, closer to what actually approaches/exceeds MPI
  easterlyShearToleranceKt: 8,       // some easterly shear component is normal; beyond this it signals a displaced anticyclone
  easterlyShearCeilingPenaltyPerKt: 1.6,  // how much ceiling headroom a displaced anticyclone costs, per kt of easterly shear beyond tolerance
};

// Rapid intensification: NHC defines RI as a 30kt+ increase in 24h. Real
// RI happens when shear, moisture, and SST are all simultaneously
// excellent — this isn't a separate mechanism from the normal approach-
// to-MPI relaxation, just a much higher ceiling on how fast that approach
// is allowed to happen when conditions are exceptional, matching how
// actual extreme RI events (Patricia 2015, Wilma 2005, Milton 2024) occur.
export const RI = {
  maxShearKt: 15,          // loosened to match the now-higher/noisier shear baseline
  minSst: 28.5,
  maxDryAir: 0.34,         // loosened to match the recalibrated RH baseline (~68-83% typical)
  minGapKt: 10,           // needs meaningful room below its ceiling/MPI
  minAgeDays: 1.75,        // real RI essentially never starts within hours of genesis — needs time to organize first
  organizationRampDays: 1.3, // how long until a storm can intensify at its full potential rate, RI or not — shortened from 2.2: real TDs typically reach TS within 24-48h given a reasonably favorable environment, and the old ramp was throttling that crucial early transition too hard, causing TDs to either die before ever reaching TS or linger there for days once they did survive
  organizationRampFloor: 0.5, // raised further from 0.38 -- direct testing showed even the previous value still let moderate (not extreme) dry air/shear prevent a fresh TD from ever reaching TS, just more slowly than before rather than actually breaking through
  boostMultiplier: 3.1,   // approach-rate multiplier when RI-favorable
  maxRateKtPerDay: 100,     // hard ceiling even during RI (supports 50mb+/day cases)
  historyTicks: 4,         // 4 ticks * 6h = 24h, for the "is this storm currently doing RI" badge
  badgeThresholdKt: 30,    // NHC's 30kt/24h definition
  shearEmaWeight: 0.32,    // smoothing factor for the shear EMA used in RI checks (persistence, not instantaneous noise)
};

// Eyewall replacement cycles: intense hurricanes periodically weaken for
// ~a day as a new outer eyewall forms and chokes off the old one, then
// often re-intensify if the environment is still favorable — a real,
// common feature of major hurricanes that a smooth intensity curve misses.
export const ERC = {
  triggerKt: 100,          // only major hurricanes are eligible
  minIntensityToContinueKt: 83, // Cat2 threshold — an ERC cannot continue in a storm that's weakened below this, regardless of phase
  chancePerTick: 0.06,      // base stochastic gate, checked once eligible — scaled up further below by intensity and storm size
  // Real ERCs vary hugely in duration — some resolve in under a day,
  // others drag on for several, especially when shear/dry air pile on
  // top of the eyewall replacement itself. Randomized per-event rather
  // than a fixed constant, and further stretched by environmental
  // stress (see storm.js). Roughly maps to: rapid ~6-12h, typical
  // ~12-24h, long ~24-36h, unusually prolonged 36-48h+ (the last mostly
  // reached via the environmental-stress extension below, not the base
  // range alone).
  weakenDaysMin: 0.25, weakenDaysMax: 2.0,
  weakenRateKtPerDay: 22,
  reformDaysMin: 0.8, reformDaysMax: 3.4,
  cooldownDays: 2.5,
  // A completed ERC leaves a genuinely larger storm behind (the new
  // outer eyewall becomes the primary wind field) — capped so repeated
  // ERCs across a long-lived storm's life don't compound into an
  // unbounded size, matching how real storms don't grow indefinitely
  // larger cycle after cycle.
  sizeFactorGainPerErc: 0.16,
  maxSizeFactorFromErc: 1.65,
  envStressMaxExtension: 1.8,  // up to +180% duration under severe shear/dry air
  envStressExtraWeakenKtPerDay: 14, // additional weakening on top of the base ERC rate under severe stress
  // Real intense hurricanes (Cat4-5) undergo ERCs considerably more
  // reliably than a storm just barely into major status — this scales
  // the effective onset chance up with how far above the major threshold
  // the storm actually is.
  intensityOnsetBonusPer10Kt: 0.35,
  // Storm structure (sizeFactor, from the constructor — small "pinhole
  // eye" cores vs. broad ones) affects both how quickly an ERC actually
  // gets going once conditions allow it, and how long it takes once it
  // does: a compact core's replacement cycle onsets fast and resolves
  // fast (rapid ERC); a broad core can hold one off longer, but once
  // underway, its ERC drags out longer too.
  smallCoreOnsetBonus: 0.9,   // per unit of (1 - sizeFactor) — smaller cores onset noticeably faster
  sizeDurationWeight: 0.65,   // how strongly storm size biases where in the duration range a given ERC lands
};

// Storm size (rough proxy for 34kt/64kt wind radii) and its correlation
// with the pressure-variance factor: compact, fast-deepening storms run
// deeper pressure for their wind and smaller wind fields; large, sprawling
// storms run shallower pressure for their wind and bigger wind fields —
// mirrors the real relationship between Holland B / RMW and structure.
export const SIZE = {
  baseR34Km: 90,
  ktToR34Km: 1.35,
  latToR34Km: 6.5,  // raised from 3.2 -- "noticeably larger at higher latitude" wasn't landing at the old coefficient
  // Real climatology has plenty of TS-strength systems that plateau
  // without ever reaching hurricane strength -- direct measurement
  // showed this transition specifically was over-producing hurricanes
  // relative to target season climatology (13 named/6 hurricanes/3
  // majors, 110 ACE over a 30-year normal).
  tsPlateauApproachMultiplier: 0.62,
  // The other half of "trades intensity for size" — same pressure
  // implies genuinely less wind at higher latitude (broader gradient),
  // not just a bigger wind field at the same peak wind. Ramps in past
  // latWindDiscountStartLat, floors out (never below latWindDiscountFloor)
  // rather than going to zero.
  latWindDiscountStartLat: 30,
  latWindDiscountPerDeg: 0.014,
  latWindDiscountFloor: 0.72,
  r64FractionOfR34: 0.34,
  // Small "pinhole eye" cores export mass/angular momentum far more
  // efficiently than broad ones — the real mechanism behind the most
  // explosive RI events — at the cost of holding that structure together
  // less long (see ERC's size coupling in constants.js/storm.js).
  smallCoreRiBonus: 0.6,
};

// Central American Gyre: a broad, low-level cyclonic gyre over Central
// America / the western Caribbean / Bay of Campeche that spins up its own
// tropical cyclones independent of MDR easterly waves, with a distinct
// bimodal seasonality (May-June and Oct-Nov, not the MDR's single Aug-Sep
// peak) and a tendency for the resulting storms to meander at low
// latitude until a trough or frontal boundary picks them up.
export const CAG = {
  peak1DayOfYear: 152,   // ~Jun 1 (May-Jun window — shorter-lived systems on average)
  peak1Width: 26,
  peak1Amplitude: 0.65,
  peak2DayOfYear: 288,   // ~Oct 15 — shifted/sharpened for a real "jump" right around Oct 1
  peak2Width: 19,
  peak2Amplitude: 1.35,  // the real "huge jump" — late-season Caribbean activity noticeably outweighs the May-Jun window
  chancePerTick: 0.0072,  // reduced from 0.0085 -- combined with the monsoon trough's own recent NaN-bug fix (which took it from effectively 0% to its full intended rate), the two Caribbean-region pathways together were overproducing relative to other basins
  latMin: 11, latMax: 20,
  lonMin: -95, lonMax: -80,
  minSst: 27.0,
  maxShear: 22,  // loosened from 18 -- the underlying shear climatology has gotten noisier/generally higher over several rounds of unrelated tuning (ENSO western-basin targeting, TUTT-ENSO coupling, general steering/shear noise), and the old threshold was quietly suppressing CAG genesis far more than intended as a result
  meanderWobbleMultiplier: 2.1,
  // Late-season (Oct+) Caribbean systems that do get going have real
  // potential to become powerful hurricanes while meandering in the
  // region — not guaranteed, and ENSO matters a lot (La Nina makes it
  // meaningfully more likely, El Nino suppresses it) — modulated on top
  // of ENSO's existing basin-wide shear effect.
  lateSeasonDayThreshold: 260,
  lateSeasonCeilingBiasKt: 16,
  lateSeasonEnsoCoeffKt: 6.5,   // -ENSO (La Nina) adds to the bias; +ENSO (El Nino) subtracts (rescaled for the Nino3.4-calibrated ENSO index)
  earlySeasonDayThreshold: 190,
  earlySeasonCeilingBiasKt: -18, // May-Jun systems skew toward shorter-lived/weaker outcomes
};
// Manually spawned systems (storms and environmental features) — a way
// to set up "what if" scenarios by hand rather than only watching what
// the simulation generates on its own.
// Extratropical transition: a tropical cyclone that moves poleward and
// interacts deeply with a trough/extratropical low loses its warm core
// and transforms into a post-tropical/extratropical system — it doesn't
// just dissipate. Real ET storms often expand significantly in wind-field
// size and can maintain (or even briefly regain) strong winds via
// baroclinic energy if a trough keeps supporting them (Sandy 2012 is the
// textbook case), rather than weakening steadily the way a storm losing
// steam over cool water does.
// Extratropical lows: genuinely separate surface-level entities from the
// upper-level troughs — real synoptic systems where a surface low forms
// near/ahead of an upper trough but is its own feature with its own
// lifecycle, and it's the surface low (not the bare upper trough) that a
// front trails from and that a transitioning tropical cyclone actually
// merges with. Spawned naturally when a trough is far enough poleward,
// with a real lifespan, decaying independently of the parent trough.
export const ETLOW = {
  spawnMinLat: 30,           // troughs need to be at least this far poleward to spawn a surface low
  spawnChancePerTick: 0.01,
  maxActive: 2,
  lifetimeDays: 8,
  strength: 0.45,            // weaker height-field presence than a full upper trough
  radiusDeg: 10,
  spawnOffsetLatDeg: 4,
  spawnOffsetLonDeg: 8,       // offset ahead (east) of the parent trough
};

export const ET = {
  latThreshold: 34,           // won't transition before reaching this latitude
  troughSupportRadiusDeg: 14, // "deep interaction" with a trough/low, for triggering + ongoing baroclinic support
  shearTriggerKt: 32,         // very high shear alone (baroclinic environment) can also trigger it
  sizeExpansionFactor: 1.75,  // real ET storms often roughly double in wind-field extent
  baroclinicSupportKtPerDay: 3.5,  // can maintain/slightly regain strength while well-supported by a trough
  unsupportedDecayKtPerDay: 4.5,   // steady weakening once baroclinic support fades
  maxDurationDays: 6.5,        // eventually fully absorbed/dissipates even with support
  absorptionRadiusDeg: 8,      // genuine merger distance — tighter than the "support" radius above, but reachable
  absorptionDays: 0.75,        // how long a storm needs to stay this close before being absorbed, not an instant snap
  // Even a well-supported (baroclinically fed) post-tropical system
  // can't indefinitely exceed what the underlying SST can support --
  // allowed a premium over the pure warm-core MPI ceiling (draws some
  // energy from the front/trough too), but any overage above that
  // forces real weakening proportional to how far over it is.
  sstCeilingPremiumFactor: 1.25,
  sstCeilingOverageDecayPerKt: 0.9,
};

// A tropical (or post-tropical) system that weakens below minimum
// intensity doesn't just vanish — real remnant lows persist, drift
// weakly, and sometimes reorganize back into a tropical cyclone under
// the same name if conditions turn favorable again (a real, if not
// hugely common, phenomenon). Represented on the map with the same
// marker style as a tropical wave, but carrying its name — a remnant
// low is a known, tracked system, not an anonymous disturbance.
export const REMNANT = {
  minSstForRegenesis: 26.2,
  maxShearForRegenesis: 21,
  maxDryAirForRegenesis: 0.42,
  // Below this, a remnant low is too weak to meaningfully track or
  // reorganize — dissipates outright regardless of how favorable
  // conditions otherwise look. At or above it, stays a genuine,
  // trackable system with real regenesis potential.
  minIntensityToPersistKt: 20,
  unfavorableDecayKtPerDay: 3.2,  // gradual weakening while remnant and conditions are unfavorable — what actually makes the 20kt floor reachable through real decay, not just at the moment of transition
  regenesisChancePerTick: 0.035,   // stochastic gate, only rolled when conditions above are all met
  fadeUnfavorableDaysThreshold: 2.75,  // sustained unfavorable conditions before fully fading for good
  unfavorableRecoveryDaysPerTick: 1.6, // how much a single favorable tick clears from the unfavorable-day counter
  steeringWeight: 0.4,          // weak, disorganized — only partially coupled to the steering flow
  meanderWobbleMultiplier: 2.4, // genuinely more erratic motion than an organized storm
  regenesisInitialKt: 30,       // what intensity it resumes at upon regenesis (fresh TD-ish, not back to its old peak)
};

export const SPAWN = {
  waveInitialLat: null, // waves just use the clicked position directly
  tsInitialKt: 40,
  hurricaneInitialKt: 70,
  // User-placed upper lows / ridges: same underlying Gaussian-bump shape
  // the simulation's own troughs/high use, but decaying over a fixed
  // lifetime rather than being permanent, so the map doesn't accumulate
  // clutter over a long session.
  featureLifetimeDays: 5,
  upperLowStrength: 0.9,
  upperLowRadiusDeg: 12,
  ridgeStrength: 0.85,
  ridgeRadiusDeg: 14,
};

export const SHEAR_TOOL = {
  brushRadiusDeg: 4,
  strengthPerClick: 8,
  maxAbs: 30,
};

// Wind-pressure relationship (simplified, Atlantic-basin-calibrated
// empirical curve — not a literal Dvorak/Knaff-Zehr implementation, but
// shaped to hit the right landmarks: ~1008mb at 25kt, ~1000mb at 34kt TS
// threshold, ~980mb at Cat1, ~945mb at Cat3, ~910mb at Cat5).
export const PRESSURE = {
  environmentalMb: 1013,
  coeff: 0.0689,   // calibrated so 34kt->~1000mb, 64kt->~980mb, 96kt->~950mb, 137kt->~910mb
  exponent: 1.486,
};

// Genesis outlook overlay (NHC Tropical Weather Outlook style): shows
// each live tropical wave's probability of developing within 48h and 7
// days, derived from the same genesis-potential-index math used for
// actual genesis, just presented probabilistically instead of as a single
// stochastic roll.
export const OUTLOOK = {
  lookaheadDays: 7,
  sampleStepDays: 0.5,
};

// Forecast cone / spaghetti model settings for a selected active storm.
export const FORECAST = {
  horizonDays: 5,
  ensembleMembers: 14,
  memberWobbleMultiplier: 2.2, // spaghetti members get extra wobble spread vs the "real" storm
  stepDays: 0.25,
};
