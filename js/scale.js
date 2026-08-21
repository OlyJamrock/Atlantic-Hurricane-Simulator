// scale.js — intensity classification (Saffir-Simpson-alike), colors, and
// the shared wind-pressure relationship used for both storms and
// non-tropical pressure centers (the Azores/Bermuda high, troughs).

import { PRESSURE } from './constants.js';

export function classify(windKt, isExtratropical = false) {
  const base = classifyBase(windKt);
  if (!isExtratropical) return base;
  // Post-tropical/extratropical: real best-track practice keeps the
  // color tied to wind intensity (a post-tropical major still shows as
  // red/pink) but marks the system as no longer tropical — it's not
  // counted in ACE (see storm.js) and shouldn't be read as an active
  // tropical threat the way an equally-strong tropical system would be.
  return { label: `Post-Tropical (${base.label})`, short: `EX-${base.short}`, color: base.color };
}

function classifyBase(windKt) {
  if (windKt < 25) return { label: 'Disturbance', short: 'DB', color: '#5b7a8c' };
  // Aligned with the naming threshold in simulation.js (33.5, not a
  // hard 34) — both need to agree with the UI's rounded display, or a
  // storm could be "named" while still labeled Tropical Depression,
  // which reads as a contradiction.
  if (windKt < 33.5) return { label: 'Tropical Depression', short: 'TD', color: '#6fb1c9' };
  if (windKt < 64) return { label: 'Tropical Storm', short: 'TS', color: '#4fd1c5' };
  if (windKt < 83) return { label: 'Category 1', short: 'C1', color: '#ffd166' };
  if (windKt < 96) return { label: 'Category 2', short: 'C2', color: '#ffb347' };
  if (windKt < 113) return { label: 'Category 3', short: 'C3', color: '#ff8c42' };
  if (windKt < 137) return { label: 'Category 4', short: 'C4', color: '#ff5d5d' };
  return { label: 'Category 5', short: 'C5', color: '#ff3ea5' };
}

// Wind-pressure relationship: piecewise-linear over anchor points
// calibrated against real Atlantic hurricane climatology by Saffir-
// Simpson threshold. Real-world scatter around this mean curve for a
// given wind speed is on the order of +/-10mb typically, rarely more —
// NOT the kind of spread that would let a 115kt Cat4 sit at 970mb,
// which is a physical impossibility this curve (paired with the tight
// additive offset in windToPressureMb below) is specifically built to
// prevent.
const PRESSURE_ANCHORS = [
  [0, 1013], [25, 1006], [34, 1000], [50, 993], [64, 983], [75, 974],
  [83, 967], [96, 957], [100, 954], [110, 944], [113, 940], [120, 932],
  [130, 922], [137, 912], [140, 908], [150, 895], [160, 882],
  [172.5, 865], [182.5, 848], [195, 825],
];

function meanPressureForWind(windKt) {
  const v = Math.max(0, windKt);
  if (v >= PRESSURE_ANCHORS[PRESSURE_ANCHORS.length - 1][0]) {
    return PRESSURE_ANCHORS[PRESSURE_ANCHORS.length - 1][1];
  }
  for (let i = 0; i < PRESSURE_ANCHORS.length - 1; i++) {
    const [v0, p0] = PRESSURE_ANCHORS[i], [v1, p1] = PRESSURE_ANCHORS[i + 1];
    if (v >= v0 && v <= v1) return p0 + ((p1 - p0) * (v - v0)) / (v1 - v0);
  }
  return PRESSURE_ANCHORS[0][1];
}

// Inverse of the above — given a target pressure, what wind speed does
// the mean curve say corresponds to it. Needed now that MPI is pressure-
// based: the actual ceiling on wind is "whatever wind keeps this storm's
// pressure at or above the SST's thermodynamic pressure floor," not a
// wind value looked up directly — see storm.js's _mpiKtFromPressure.
// Pressure decreases monotonically as wind increases, so this is a
// straightforward reverse piecewise-linear lookup, extrapolated beyond
// the table's most extreme entry using that segment's own slope (the
// same way the forward direction already extrapolates for very warm SST).
export function windFromPressureMb(targetMb) {
  const anchors = PRESSURE_ANCHORS;
  if (targetMb >= anchors[0][1]) return anchors[0][0];
  const lastIdx = anchors.length - 1;
  if (targetMb <= anchors[lastIdx][1]) {
    const [v0, p0] = anchors[lastIdx - 1], [v1, p1] = anchors[lastIdx];
    const slopeP = (p1 - p0) / (v1 - v0); // negative: mb per kt
    return v1 + (targetMb - p1) / slopeP;
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    const [v0, p0] = anchors[i], [v1, p1] = anchors[i + 1];
    if (targetMb <= p0 && targetMb >= p1) {
      return v0 + ((v1 - v0) * (p0 - targetMb)) / (p0 - p1);
    }
  }
  return anchors[lastIdx][0];
}

// `offsetMb` is a tight, additive deviation from the mean curve (drawn
// once per storm — see storm.js's pressureDeficitOffsetMb) standing in
// for background environmental pressure, size (Holland B), and forward-
// speed effects this model doesn't resolve directly. This is
// deliberately NOT a multiplicative scaling of the whole pressure
// deficit — that was the actual bug behind storms like a 115kt Cat4
// sitting at 970mb: scaling the deficit itself means a "shallow"
// variance factor barely drops pressure at all regardless of wind
// speed, which has no real-world analog. A real storm's pressure can
// deviate from the mean curve by some number of mb, not by "half the
// expected total drop."
export function windToPressureMb(windKt, offsetMb = 0) {
  const mean = meanPressureForWind(windKt);
  return Math.round(mean + offsetMb);
}

