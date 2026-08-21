import { World } from '../js/simulation.js';

let allLats = [], allLons = [], allMbs = [];
for (let seed = 1; seed <= 5; seed++) {
  const world = new World(seed * 13);
  for (let i = 0; i < 1460; i++) {
    world.tick();
    const h = world.env.highCenter;
    allLats.push(h.lat); allLons.push(h.lon); allMbs.push(h.pressureMb);
  }
}
const stat = (a) => ({ min: Math.min(...a).toFixed(1), max: Math.max(...a).toFixed(1), mean: (a.reduce((x,y)=>x+y,0)/a.length).toFixed(1) });
console.log('lat', stat(allLats));
console.log('lon', stat(allLons));
console.log('mb', stat(allMbs));
const strong = allMbs.filter(m => m > 1030).length / allMbs.length;
const weak = allMbs.filter(m => m < 1023).length / allMbs.length;
const farNE = allLats.filter((la,i)=> la>36 && allLons[i]>-30).length;
console.log('frac >1030mb:', (strong*100).toFixed(1)+'%', 'frac <1023mb:', (weak*100).toFixed(1)+'%', 'ticks lat>36 & lon>-30:', farNE);
