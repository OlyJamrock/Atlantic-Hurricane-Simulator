import { World } from '../js/simulation.js';

const world = new World(15);
let maxMbDropPerDay = 0;
let maxKtPerDay = 0;
const history = new Map(); // id -> {day, mb, kt}

for (let i = 0; i < 1460 * 3; i++) {
  world.tick();
  for (const s of world.storms) {
    const h = history.get(s.id) || [];
    h.push({ day: world.dayNum, mb: s.pressureMb, kt: s.intensityKt });
    while (h.length > 5) h.shift(); // ~24h at 6h ticks
    history.set(s.id, h);
    if (h.length === 5) {
      const dropMb = h[0].mb - h[4].mb;
      const gainKt = h[4].kt - h[0].kt;
      if (dropMb > maxMbDropPerDay) maxMbDropPerDay = dropMb;
      if (gainKt > maxKtPerDay) maxKtPerDay = gainKt;
    }
  }
}
console.log('max 24h pressure drop seen (3 seasons):', maxMbDropPerDay.toFixed(1), 'mb');
console.log('max 24h wind gain seen:', maxKtPerDay.toFixed(1), 'kt');
