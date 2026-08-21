import { World } from '../js/simulation.js';

const world = new World(21);
let riEvents = 0;
let maxRateSeen = 0;
let ercEvents = 0;
let prevErcPhase = new Map();

for (let i = 0; i < 1460; i++) {
  world.tick();
  for (const s of world.storms) {
    if (s.isRapidIntensifying) riEvents++;
    const prev = prevErcPhase.get(s.id) || 'none';
    if (prev !== 'weakening' && s.ercPhase === 'weakening') ercEvents++;
    prevErcPhase.set(s.id, s.ercPhase);
  }
}
console.log('RI-flagged ticks (storms with 30kt+/24h at some point):', riEvents);
console.log('ERC weakening-phase entries:', ercEvents);

// find the single fastest 24h deepening across the run
const world2 = new World(21);
let fastest = 0;
let fastestStorm = null;
for (let i = 0; i < 1460; i++) {
  world2.tick();
  for (const s of world2.storms) {
    if (s.intensityHistory.length > 4) {
      const delta = s.intensityHistory[s.intensityHistory.length-1].kt - s.intensityHistory[0].kt;
      if (delta > fastest) { fastest = delta; fastestStorm = s.name; }
    }
  }
}
console.log('fastest 24h deepening seen:', fastest.toFixed(1), 'kt (', fastestStorm, ')');
