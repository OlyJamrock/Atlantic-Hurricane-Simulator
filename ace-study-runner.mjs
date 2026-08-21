import { World } from '../js/simulation.js';
import fs from 'fs';

const OUT_FILE = new URL('./study-100.json', import.meta.url);
const START_SEED = Number(process.argv[2] || 1);
const COUNT = Number(process.argv[3] || 6);

let results = [];
if (fs.existsSync(OUT_FILE)) {
  results = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
}

const TICKS_PER_YEAR = Math.round(365 / 0.25);

for (let i = 0; i < COUNT; i++) {
  const seed = START_SEED + i;
  const world = new World(seed * 51013 + 7);
  // ENSO is a pure function of simulated day (not of the storm-genesis
  // seed), so every run starting at day 0 would sample the exact same
  // ENSO phase — useless for a La Nina vs El Nino comparison. Fast-
  // forward each run's starting point to a different day, spread across
  // several ENSO cycles, so the 50 seasons actually sample a real range
  // of ENSO states.
  const dayOffset = (seed * 337) % 3400;
  world.dayNum = dayOffset;

  let ensoSum = 0, ensoN = 0, mdrSum = 0;
  for (let t = 0; t < TICKS_PER_YEAR; t++) {
    world.tick();
    ensoSum += world.env.ensoIndex;
    ensoN++;
    mdrSum += world.env.mdrEastAtlAnomaly;
  }
  const meanEnso = ensoSum / ensoN;
  const meanMdr = mdrSum / ensoN;
  let ace = 0, named = 0, hurr = 0, major = 0, c45 = 0, subtropical = 0;
  let strongestKt = 0, strongestName = '', strongestMb = 0;
  for (const s of world.archive) {
    ace += s.ace || 0;
    if (s.peakKt >= 34) named++;
    if (s.peakKt >= 64) hurr++;
    if (s.peakKt >= 96) major++;
    if (s.peakKt >= 113) c45++;
    if (s.subtropical) subtropical++;
    if (s.peakKt > strongestKt) { strongestKt = s.peakKt; strongestName = s.displayName; strongestMb = s.minPressureMb; }
  }
  // include any still-active storms' partial ACE too, for completeness
  for (const s of world.storms) {
    ace += s.ace || 0;
    if (s.peakKt >= 34) named++;
    if (s.peakKt >= 64) hurr++;
    if (s.peakKt >= 96) major++;
    if (s.peakKt >= 113) c45++;
    if (s.subtropical) subtropical++;
    if (s.peakKt > strongestKt) { strongestKt = s.peakKt; strongestName = s.displayName; strongestMb = s.minPressureMb; }
  }
  results.push({
    seed, meanEnso: Number(meanEnso.toFixed(3)), meanMdr: Number(meanMdr.toFixed(3)),
    ace: Number(ace.toFixed(2)), named, hurr, major, c45, subtropical,
    strongestKt: Math.round(strongestKt), strongestName, strongestMb,
  });
  console.log(`seed ${seed}: ACE=${ace.toFixed(1)} named=${named} hurr=${hurr} major=${major} c45=${c45} sub=${subtropical} ENSO=${meanEnso.toFixed(2)} strongest=${strongestName} ${Math.round(strongestKt)}kt/${strongestMb}mb`);
}

fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
console.log(`\nTotal seasons completed so far: ${results.length}`);
