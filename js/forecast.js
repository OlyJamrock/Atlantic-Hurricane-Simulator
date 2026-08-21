// forecast.js — forward-projects a selected active storm using the
// current environment as a static snapshot (a "persistence + steering"
// forecast, like a simplified statistical model — it does not re-run
// Environment.update() for future days, since projecting the large-scale
// pattern itself forward is a much harder problem than this sim takes on).
// Multiple perturbed members (varying only in their random wobble draw)
// give the spaghetti spread; the cone is the envelope around them.

import { FORECAST as FC } from './constants.js';
import { Storm } from './storm.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Clones just enough of a live Storm's state to run it forward without
// touching the real object or the world's RNG stream.
function cloneStormState(storm) {
  const clone = new Storm({
    lat: storm.lat,
    lon: storm.lon,
    name: storm.name,
    bornDay: storm.bornDay,
    initialIntensityKt: storm.intensityKt,
    subtropical: storm.subtropical,
    rand: () => 0.5,
  });
  clone.ceilingKt = storm.ceilingKt;
  clone.ageDays = storm.ageDays;
  clone.wobbleU = storm.wobbleU;
  clone.wobbleV = storm.wobbleV;
  return clone;
}

export function computeForecast(storm, env, osc, dayNum, baseSeed = 1) {
  const dtDays = FC.stepDays;
  const steps = Math.round(FC.horizonDays / dtDays);
  const members = [];

  for (let m = 0; m < FC.ensembleMembers; m++) {
    const rand = mulberry32(baseSeed * 97 + m * 131071 + 17);
    const clone = cloneStormState(storm);
    const path = [{ lat: clone.lat, lon: clone.lon, kt: clone.intensityKt, day: dayNum }];
    let d = dayNum;
    for (let s = 0; s < steps; s++) {
      d += dtDays;
      clone.step(env, osc, dtDays, d, rand);
      // Extra ensemble spread beyond the base wobble, growing with lead
      // time — this is what actually fans the spaghetti lines out, since
      // the base wobble alone is too tame to show real divergence by day 5.
      const leadFrac = (s + 1) / steps;
      const extra = FC.memberWobbleMultiplier * leadFrac;
      clone.lat += (rand() - 0.5) * 0.06 * extra;
      clone.lon += (rand() - 0.5) * 0.06 * extra;
      path.push({ lat: clone.lat, lon: clone.lon, kt: clone.intensityKt, day: d });
      if (clone.dissipated) break;
    }
    members.push(path);
  }

  // Cone: at each forecast step, the envelope across members — a
  // simplified box-ish cone rather than NHC's true radius-based cone, but
  // it grows outward with lead time the same qualitative way.
  const cone = [];
  const maxLen = Math.max(...members.map((p) => p.length));
  for (let s = 0; s < maxLen; s++) {
    const pts = members.map((p) => p[Math.min(s, p.length - 1)]).filter(Boolean);
    if (!pts.length) continue;
    const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon), kts = pts.map((p) => p.kt);
    cone.push({
      day: pts[0].day,
      latMin: Math.min(...lats), latMax: Math.max(...lats),
      lonMin: Math.min(...lons), lonMax: Math.max(...lons),
      latMean: lats.reduce((a, b) => a + b, 0) / lats.length,
      lonMean: lons.reduce((a, b) => a + b, 0) / lons.length,
      ktMean: kts.reduce((a, b) => a + b, 0) / kts.length,
    });
  }

  return { members, cone };
}
