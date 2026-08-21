import { World } from '../js/simulation.js';

const YEARS = 2;
const TICKS_PER_YEAR = Math.round(365 / 0.25);

function runSeeds(nSeeds) {
  const perSeasonStats = [];
  for (let s = 1; s <= nSeeds; s++) {
    const world = new World(s * 777 + 3);
    let yearStart = 0;
    let named = 0, hurr = 0, major = 0;
    const bucket = []; // per-year counts
    let counted = { named: 0, hurr: 0, major: 0 };
    let lastYear = 0;
    for (let t = 0; t < TICKS_PER_YEAR * YEARS; t++) {
      world.tick();
      const year = Math.floor(world.dayNum / 365);
      if (year !== lastYear) {
        bucket.push(counted);
        counted = { named: 0, hurr: 0, major: 0, enso: world.env.ensoIndex };
        lastYear = year;
      }
    }
    // tally from archive by birth year
    const byYear = {};
    for (const st of world.archive) {
      const y = Math.floor(st.bornDay / 365);
      byYear[y] = byYear[y] || { named: 0, hurr: 0, major: 0, ensoSum: 0, n: 0 };
      if (st.peakKt >= 34) byYear[y].named++;
      if (st.peakKt >= 64) byYear[y].hurr++;
      if (st.peakKt >= 96) byYear[y].major++;
    }
    for (const y of Object.keys(byYear)) {
      if (Number(y) === 0 || Number(y) >= YEARS) continue; // skip partial first/last year
      perSeasonStats.push(byYear[y]);
    }
  }
  return perSeasonStats;
}

const stats = runSeeds(2);
const avg = (k) => stats.reduce((a, b) => a + b[k], 0) / stats.length;
console.log('seasons sampled:', stats.length);
console.log('avg named:', avg('named').toFixed(1));
console.log('avg hurricanes:', avg('hurr').toFixed(1));
console.log('avg majors:', avg('major').toFixed(1));
