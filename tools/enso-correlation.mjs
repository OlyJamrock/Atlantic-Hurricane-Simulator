import { World } from '../js/simulation.js';

const world = new World(99);
const YEARS = 12;
const TICKS = Math.round(365 / 0.25) * YEARS;
for (let i = 0; i < TICKS; i++) world.tick();

const byYear = new Map();
for (const storm of world.archive) {
  const year = Math.floor(storm.bornDay / 365);
  if (year === 0 || year >= YEARS) continue; // skip partial years
  if (!byYear.has(year)) byYear.set(year, { named: 0, hurr: 0, major: 0, ensoSum: 0, n: 0 });
  const b = byYear.get(year);
  if (storm.peakKt >= 34) b.named++;
  if (storm.peakKt >= 64) b.hurr++;
  if (storm.peakKt >= 96) b.major++;
}
// mean ENSO index during each year's genesis window (day 108-354 of that year)
for (const [year, b] of byYear) {
  let sum = 0, n = 0;
  for (let d = year * 365 + 108; d <= year * 365 + 354; d += 5) {
    sum += world.osc.ensoIndex(d);
    n++;
  }
  b.meanEnso = sum / n;
}

const rows = [...byYear.entries()].sort((a, b) => a[1].meanEnso - b[1].meanEnso);
console.log('year  meanENSO  named  hurr  major');
for (const [year, b] of rows) {
  console.log(`${String(year).padStart(4)}  ${b.meanEnso.toFixed(2).padStart(8)}  ${String(b.named).padStart(5)}  ${String(b.hurr).padStart(4)}  ${String(b.major).padStart(5)}`);
}

const ninaYears = rows.filter(([, b]) => b.meanEnso <= -0.5);
const ninoYears = rows.filter(([, b]) => b.meanEnso >= 0.5);
const avg = (arr, k) => arr.length ? arr.reduce((a, [, b]) => a + b[k], 0) / arr.length : NaN;
console.log('\nLa Nina-like seasons (enso<=-0.5):', ninaYears.length,
  'avg named', avg(ninaYears, 'named').toFixed(1), 'hurr', avg(ninaYears, 'hurr').toFixed(1), 'major', avg(ninaYears, 'major').toFixed(1));
console.log('El Nino-like seasons (enso>=+0.5):', ninoYears.length,
  'avg named', avg(ninoYears, 'named').toFixed(1), 'hurr', avg(ninoYears, 'hurr').toFixed(1), 'major', avg(ninoYears, 'major').toFixed(1));
