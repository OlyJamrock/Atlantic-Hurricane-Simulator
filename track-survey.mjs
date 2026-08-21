import { World } from '../js/simulation.js';

const world = new World(23);
for (let i = 0; i < 1460; i++) world.tick();

const sorted = [...world.archive].sort((a, b) => b.peakKt - a.peakKt).slice(0, 6);
for (const storm of sorted) {
  console.log(`\n${storm.name}  peak ${storm.peakKt.toFixed(0)}kt  age ${storm.ageDays.toFixed(1)}d  landfall=${storm.landfall}`);
  const step = Math.max(1, Math.floor(storm.track.length / 8));
  for (let i = 0; i < storm.track.length; i += step) {
    const p = storm.track[i];
    console.log(`  lat ${p.lat.toFixed(1).padStart(5)}N  lon ${p.lon.toFixed(1).padStart(6)}  ${Math.round(p.kt)}kt`);
  }
}
