import { World } from './simulation.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { TIME } from './constants.js';
import { Environment } from './environment.js';
import { stormsAtDay } from './history.js';

const canvas = document.getElementById('mapCanvas');
const world = new World(Date.now() % 100000);
const renderer = new Renderer(canvas);
const ui = new UI(world, renderer);

// A second Environment instance, same seed, used only to compute
// historical field snapshots on demand during a "time travel" rewind —
// the live simulation's world.env is never touched by this.
const historyEnv = new Environment(world.osc, world.seed);

function resize() {
  renderer.resize();
}
window.addEventListener('resize', resize);
resize();

let lastTime = performance.now();
let tickAccumulator = 0;
let spinClock = 0;

// --- Rewind / time-travel wiring ---
const rewindToggleBtn = document.getElementById('rewindToggleBtn');
const rewindSlider = document.getElementById('rewindSlider');
const rewindReadout = document.getElementById('rewindReadout');
const rewindLiveBtn = document.getElementById('rewindLiveBtn');
let rewindActive = false;
let rewindDay = null;
let wasPausedBeforeRewind = false;
let lastRewindEnvDay = null;

function formatDay(day) {
  const y = 2026 + Math.floor(day / 365);
  const doy = Math.floor(day % 365);
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const cumDays = [0,31,59,90,120,151,181,212,243,273,304,334,365];
  let m = 0;
  while (m < 11 && doy >= cumDays[m + 1]) m++;
  const dom = doy - cumDays[m] + 1;
  const hourZ = Math.round((day - Math.floor(day)) * 24);
  return `${monthNames[m]} ${dom}, ${y} · ${hourZ}Z`;
}

function enterRewind() {
  if (rewindActive) return;
  rewindActive = true;
  wasPausedBeforeRewind = world.paused;
  world.paused = true;
  // 6-hour ticks (0.25 day steps) so specific synoptic frames (0/6/12/18Z)
  // can be scrubbed to directly, not just whole days.
  rewindSlider.step = '1';
  rewindSlider.max = String(Math.max(1, Math.floor(world.dayNum * 4)));
  rewindSlider.value = rewindSlider.max;
  rewindDay = Number(rewindSlider.value) / 4;
  rewindSlider.style.display = '';
  rewindReadout.style.display = '';
  rewindLiveBtn.style.display = '';
  rewindToggleBtn.textContent = '⏮ Scrubbing…';
  rewindReadout.textContent = formatDay(rewindDay);
}

function exitRewind() {
  rewindActive = false;
  rewindDay = null;
  world.paused = wasPausedBeforeRewind;
  rewindSlider.style.display = 'none';
  rewindReadout.style.display = 'none';
  rewindLiveBtn.style.display = 'none';
  rewindToggleBtn.textContent = '⏮ Time travel';
}

rewindToggleBtn.addEventListener('click', () => {
  if (rewindActive) exitRewind(); else enterRewind();
});
rewindLiveBtn.addEventListener('click', exitRewind);
rewindSlider.addEventListener('input', () => {
  rewindDay = Number(rewindSlider.value) / 4;
  rewindReadout.textContent = formatDay(rewindDay);
});

function loop(now) {
  const dtSeconds = Math.min(0.25, (now - lastTime) / 1000);
  lastTime = now;

  if (!world.paused && !rewindActive) {
    const ticksPerSecond = TIME.ticksPerSecond * world.speedMultiplier;
    tickAccumulator += dtSeconds * ticksPerSecond;
    let guard = 0;
    while (tickAccumulator >= 1 && guard < 500) {
      world.tick();
      tickAccumulator -= 1;
      guard++;
    }
  }

  spinClock += dtSeconds * (world.paused ? 0 : 0.35);

  // ui.update() must run before renderer.render() — it's what recomputes
  // the forecast-cone cache, storm archive, etc. that render() reads this
  // same frame. Doing it after left the forecast cone permanently a frame
  // stale (and null on first toggle, since nothing had populated it yet).
  ui.update();

  if (rewindActive && rewindDay != null) {
    // Recompute the historical field snapshot only when the scrub
    // position actually changes (not every frame) — env.update() isn't
    // free, and the slider only moves on user input anyway.
    if (lastRewindEnvDay !== rewindDay) {
      historyEnv.update(rewindDay);
      lastRewindEnvDay = rewindDay;
    }
    const displayCtx = {
      env: historyEnv,
      storms: stormsAtDay(world, rewindDay),
      archive: [],
      waveSource: { waves: [] },
      dayNum: rewindDay,
      osc: world.osc,
    };
    renderer.render(displayCtx, ui.selectedId, spinClock, ui.selectedArchiveId, null, 1);
  } else {
    const interpFrac = world.paused ? 1 : tickAccumulator;
    renderer.render(world, ui.selectedId, spinClock, ui.selectedArchiveId, ui.currentForecast, interpFrac, ui.viewingSeasonYear);
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
