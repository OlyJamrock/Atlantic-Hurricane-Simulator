import { World } from '../js/simulation.js';

function runSeasons(nSeeds, yearsPerSeed) {
  const stats = [];
  for (let s = 1; s <= nSeeds; s++) {
    const world = new World(s * 613 + 17);
    for (let t = 0; t < Math.round(365 / 0.25) * yearsPerSeed; t++) world.tick();
    const byYear = {};
    for (const storm of world.archive) {
      const y = Math.floor(storm.bornDay / 365);
      byYear[y] = byYear[y] || { named: 0, hurr: 0, major: 0, c45: 0 };
      if (storm.peakKt >= 34) byYear[y].named++;
      if (storm.peakKt >= 64) byYear[y].hurr++;
      if (storm.peakKt >= 96) byYear[y].major++;
      if (storm.peakKt >= 113) byYear[y].c45++;
    }
    for (const y of Object.keys(byYear)) {
      if (Number(y) === 0 || Number(y) >= yearsPerSeed) continue; // skip partial first/last year
      stats.push(byYear[y]);
    }
  }
  return stats;
}

const stats = runSeasons(2, 2);
const avg = (k) => stats.reduce((a, b) => a + b[k], 0) / stats.length;
console.log('seasons sampled:', stats.length);
console.log('avg named:', avg('named').toFixed(1));
console.log('avg hurricanes:', avg('hurr').toFixed(1));
console.log('avg majors (C3+):', avg('major').toFixed(1));
console.log('avg C4/C5:', avg('c45').toFixed(2));
console.log('C4/C5 as fraction of majors:', (avg('c45')/avg('major')*100).toFixed(0) + '%');
