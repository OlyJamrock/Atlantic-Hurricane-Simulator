import { World } from '../js/simulation.js';

const world = new World(11);
let maxKt = 0;
let genesisCount = 0;
let prevActive = 0;
let landfalls = 0;

for (let i = 0; i < 1460; i++) { // 1460 * 6h = 365 days, one season
  world.tick();
  if (world.storms.length > prevActive) genesisCount += (world.storms.length - prevActive);
  prevActive = world.storms.length;
  for (const s of world.storms) { maxKt = Math.max(maxKt, s.intensityKt); if (s.landfall) landfalls++; }
}

console.log('days simulated:', world.dayNum.toFixed(1));
console.log('genesis events (approx):', genesisCount);
console.log('archived (dissipated) storms:', world.archive.length);
console.log('active storms at end:', world.storms.length);
console.log('max intensity seen (kt):', maxKt.toFixed(1));

// Print a track sample from the most intense archived storm to sanity
// check that motion looks like real Atlantic tracks (westward, then
// recurving north/northeast) rather than random-walking.
const notable = [...world.archive].sort((a, b) => b.peakKt - a.peakKt)[0];
if (notable) {
  console.log('\nStrongest storm:', notable.name, 'peak', notable.peakKt.toFixed(0), 'kt, age', notable.ageDays.toFixed(1), 'days');
  const step = Math.max(1, Math.floor(notable.track.length / 12));
  for (let i = 0; i < notable.track.length; i += step) {
    const p = notable.track[i];
    console.log(`  day ${p.day.toFixed(1).padStart(6)}  lat ${p.lat.toFixed(1).padStart(5)}N  lon ${p.lon.toFixed(1).padStart(6)}  ${Math.round(p.kt)}kt`);
  }
}
