// history.js — "rewind" support. Storms already keep a full day-stamped
// track for their whole life, so reconstructing where an active or
// archived storm was on some past day is just interpolation — no replay
// needed. The environment is a pure function of day given a fixed seed,
// so a dedicated history Environment instance can jump to any past day on
// demand without touching (or being touched by) the live simulation.

import { SIZE as SZ } from './constants.js';

// Returns a lightweight storm-shaped snapshot at `day`, or null if the
// storm didn't exist yet / had already dissipated by that day. `track` on
// the returned object is sliced to only the points up to `day` (plus the
// interpolated point itself) so a rewind view never leaks the storm's
// future path.
export function stormSnapshotAtDay(storm, day) {
  const track = storm.track;
  if (!track.length) return null;
  const first = track[0], last = track[track.length - 1];
  if (day < first.day || day > last.day) return null;

  let i = 0;
  while (i < track.length - 1 && track[i + 1].day < day) i++;
  const a = track[i], b = track[Math.min(i + 1, track.length - 1)];
  const span = b.day - a.day || 1;
  const t = Math.max(0, Math.min(1, (day - a.day) / span));
  const lat = a.lat + (b.lat - a.lat) * t;
  const lon = a.lon + (b.lon - a.lon) * t;
  const kt = a.kt + (b.kt - a.kt) * t;
  const mb = (a.mb ?? 1013) + ((b.mb ?? 1013) - (a.mb ?? 1013)) * t;

  const slicedTrack = track.filter((p) => p.day <= day);
  slicedTrack.push({ lat, lon, kt, mb, day });

  const base = SZ.baseR34Km + kt * SZ.ktToR34Km + Math.abs(lat) * SZ.latToR34Km;
  const sizeFactor = storm.sizeFactor ?? 1;

  return {
    id: storm.id,
    name: storm.name,
    number: storm.number,
    displayName: storm.name || storm.number,
    subtropical: storm.subtropical,
    lat, lon,
    intensityKt: kt,
    pressureMb: Math.round(mb),
    peakKt: storm.peakKt,
    minPressureMb: storm.minPressureMb,
    bornDay: storm.bornDay,
    ageDays: day - storm.bornDay,
    isRapidIntensifying: false, // not reconstructed historically; avoid a misleading badge
    ercPhase: 'none',
    r34Km: base * sizeFactor,
    r64Km: kt >= 64 ? base * sizeFactor * SZ.r64FractionOfR34 : 0,
    track: slicedTrack,
    lastEnv: null,
  };
}

// Builds the full set of storm snapshots (active + archived) visible at a
// past day, for the renderer's `storms` list during a rewind view.
export function stormsAtDay(world, day) {
  const all = [...world.storms, ...world.archive];
  const out = [];
  for (const storm of all) {
    const snap = stormSnapshotAtDay(storm, day);
    if (snap) out.push(snap);
  }
  return out;
}

// Cumulative Accumulated Cyclone Energy over a calendar year, sampled
// daily, for the ACE chart. Reconstructed directly from each storm's
// recorded track (kt at each 6h point) rather than needing a running
// total maintained elsewhere.
export function computeSeasonAceSeries(world, year) {
  const yearStartDay = (year - 2026) * 365;
  const all = [...world.storms, ...world.archive];
  const dayBuckets = new Map();
  for (const storm of all) {
    if (Math.floor(storm.bornDay / 365) !== year - 2026) continue;
    const track = storm.track;
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1], b = track[i];
      if (b.kt >= 34 && !storm.subtropical) {
        const dt = b.day - a.day;
        const inc = Math.pow(b.kt, 2) * 1e-4 * (dt / 0.25);
        const bucket = Math.floor(b.day - yearStartDay);
        dayBuckets.set(bucket, (dayBuckets.get(bucket) || 0) + inc);
      }
    }
  }
  const series = [];
  let cum = 0;
  for (let d = 0; d <= 365; d++) {
    cum += dayBuckets.get(d) || 0;
    series.push({ day: d, cumAce: cum });
  }
  return series;
}
