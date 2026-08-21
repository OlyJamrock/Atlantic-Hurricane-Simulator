import { World } from '../js/simulation.js';

let recurved = 0, total = 0, exitedNorth = 0, hitLand = 0;
for (let seed = 1; seed <= 6; seed++) {
  const world = new World(seed * 101);
  for (let i = 0; i < 1460; i++) world.tick();
  for (const s of world.archive) {
    if (s.peakKt < 50) continue;
    total++;
    const track = s.track;
    const lonTrend = track[track.length - 1].lon - track[Math.floor(track.length / 2)].lon;
    if (lonTrend > 3) recurved++; // net eastward motion in back half = recurved
    if (track[track.length - 1].lat > 40) exitedNorth++;
    if (s.landfall) hitLand++;
  }
}
console.log({ total, recurved, exitedNorth, hitLand });
