import { World } from '../js/simulation.js';
import { GENESIS as GEN } from '../js/constants.js';

let absorptions = 0, minGenesisSeparationSeen = Infinity, seasons = 0;

for (let seed = 1; seed <= 4; seed++) {
  seasons++;
  const world = new World(seed * 37);
  for (let i = 0; i < 1460; i++) {
    world.tick();
  }
  for (const s of world.archive) {
    if (s.absorbed) absorptions++;
  }
}

// Separately: replay a couple seasons checking separation at genesis time.
const world2 = new World(999);
for (let i = 0; i < 1460 * 2; i++) {
  const beforeIds = new Set(world2.storms.map((s) => s.number));
  world2.tick();
  for (const s of world2.storms) {
    if (!beforeIds.has(s.number)) {
      // newly born this tick -- check distance to every OTHER active storm at birth
      let minD = Infinity;
      for (const other of world2.storms) {
        if (other === s || other.dissipated) continue;
        const d = Math.hypot(other.lat - s.lat, other.lon - s.lon);
        if (d < minD) minD = d;
      }
      if (minD < minGenesisSeparationSeen) minGenesisSeparationSeen = minD;
    }
  }
}

console.log('seasons simulated:', seasons);
console.log('total absorption events (4 seasons):', absorptions);
console.log('min genesis separation observed (2 seasons):', minGenesisSeparationSeen.toFixed(2), 'deg  (floor =', GEN.minGenesisSeparationDeg, ')');
