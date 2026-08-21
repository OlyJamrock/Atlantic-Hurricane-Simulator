// ui.js — DOM wiring. Keeps main.js focused on the animation loop.

import { classify, windToPressureMb } from './scale.js';
import { SHEAR_TOOL } from './constants.js';
import { calendarYearOf } from './names.js';
import { computeForecast } from './forecast.js';
import { computeSeasonAceSeries } from './history.js';

// Speed slider maps a 0-100 UI position to a 0.2x-30x multiplier on a log
// scale, so both the slow end (0.2x) and fast end (30x) are reachable with
// good resolution in between rather than bunching near one extreme.
const SPEED_MIN = 1 / 16, SPEED_MAX = 30;

function formatSpeed(speed) {
  if (speed < 1) {
    // Show clean fractions (1/2, 1/4, 1/8, 1/16) the way the person
    // actually asked for a "1/16" option, rather than an awkward 0.06.
    const recip = Math.round(1 / speed);
    if (Math.abs(1 / recip - speed) < 0.01) return `1/${recip}×`;
    return `${speed.toFixed(2)}×`;
  }
  return `${speed.toFixed(1)}×`;
}
function sliderToSpeed(v) {
  const t = v / 100;
  return SPEED_MIN * Math.pow(SPEED_MAX / SPEED_MIN, t);
}

export class UI {
  constructor(world, renderer) {
    this.world = world;
    this.renderer = renderer;
    this.selectedId = null;
    this.selectedArchiveId = null;
    this.activeTool = 'none';
    this._painting = false;
    this._panning = false;
    this._panLast = null;
    this._forecastCache = null; // { stormId, day, data }
    this._forecastCacheAll = {}; // stormId -> { day, data }, used when forecastAllStorms is on
    this.forecastAllStorms = false;
    this._lastListRebuildTime = 0;

    this.dayReadout = document.getElementById('dayReadout');
    this.mjoBar = document.getElementById('mjoBar');
    this.cckwBar = document.getElementById('cckwBar');
    this.ensoReadout = document.getElementById('ensoReadout');
    this.naoReadout = document.getElementById('naoReadout');
    this.amoReadout = document.getElementById('amoReadout');
    this.highReadout = document.getElementById('highReadout');
    this.stormListEl = document.getElementById('stormList');
    this.stormCountEl = document.getElementById('stormCount');
    this.archiveListEl = document.getElementById('archiveList');
    this.archiveCountEl = document.getElementById('archiveCount');
    this.detailBody = document.getElementById('detailBody');
    this.playPauseBtn = document.getElementById('playPause');
    this.legendEl = document.getElementById('legend');
    this.speedSlider = document.getElementById('speedSlider');
    this.speedReadout = document.getElementById('speedReadout');
    this.aceCanvas = document.getElementById('aceCanvas');
    this.aceReadout = document.getElementById('aceReadout');
    this.windHistoryCanvas = document.getElementById('windHistoryCanvas');
    this.conditionsReadout = document.getElementById('conditionsReadout');
    this.windHistoryPanel = document.getElementById('windHistoryPanel');
    this.seasonSummaryPanel = document.getElementById('seasonSummaryPanel');
    this.seasonSummaryCanvas = document.getElementById('seasonSummaryCanvas');
    this.seasonSummaryYearLabel = document.getElementById('seasonSummaryYearLabel');
    this.showSeasonSummary = false;
    this.showWindHistory = false;
    this.seasonSummaryYear = null;
    this.viewingSeasonYear = null;
    this.archiveDisplayYear = null;
    this._aceCache = null; // { year, day, series }

    this._wireControls();
    this._buildLegend();
  }

  get currentForecast() {
    if (this.forecastAllStorms) {
      return Object.values(this._forecastCacheAll).map((c) => c.data);
    }
    return this._forecastCache ? [this._forecastCache.data] : [];
  }

  _wireControls() {
    const togglePlayPause = () => {
      this.world.paused = !this.world.paused;
      this.playPauseBtn.textContent = this.world.paused ? 'Resume' : 'Pause';
    };
    this.playPauseBtn.addEventListener('click', togglePlayPause);

    // Spacebar toggles play/pause — but not while the person is typing in
    // a text input, or spacebar would fight with normal page scrolling
    // when focus is on a non-interactive element (its default browser
    // behavior scrolls the page).
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      togglePlayPause();
    });

    this.world.speedMultiplier = sliderToSpeed(Number(this.speedSlider.value));
    this.speedSlider.addEventListener('input', () => {
      const speed = sliderToSpeed(Number(this.speedSlider.value));
      this.world.speedMultiplier = speed;
      this.speedReadout.textContent = formatSpeed(speed);
    });
    this.speedReadout.textContent = formatSpeed(this.world.speedMultiplier);

    document.querySelectorAll('#overlayToggle button').forEach((btn) => {
      btn.addEventListener('click', () => {
        // Clicking the already-active overlay a second time turns
        // everything off — just the bare ocean/land, no data field —
        // rather than forcing some overlay to always be shown.
        const alreadyActive = btn.classList.contains('active');
        document.querySelectorAll('#overlayToggle button').forEach((b) => b.classList.remove('active'));
        if (alreadyActive) {
          this.renderer.overlay = 'none';
        } else {
          btn.classList.add('active');
          this.renderer.overlay = btn.dataset.overlay;
        }
        this._buildLegend();
      });
    });

    document.querySelectorAll('#toolToggle button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        if (tool === 'tracks') {
          this.renderer.showPastTracks = !this.renderer.showPastTracks;
          btn.classList.toggle('active', this.renderer.showPastTracks);
          return;
        }
        if (tool === 'outlook') {
          this.renderer.showOutlook = !this.renderer.showOutlook;
          btn.classList.toggle('active', this.renderer.showOutlook);
          return;
        }
        if (tool === 'swath') {
          this.renderer.showSwath = !this.renderer.showSwath;
          btn.classList.toggle('active', this.renderer.showSwath);
          return;
        }
        if (tool === 'fronts') {
          this.renderer.showFronts = !this.renderer.showFronts;
          btn.classList.toggle('active', this.renderer.showFronts);
          return;
        }
        if (tool === 'itcz') {
          this.renderer.showItcz = !this.renderer.showItcz;
          btn.classList.toggle('active', this.renderer.showItcz);
          return;
        }
        if (tool === 'monsoonTrough') {
          this.renderer.showMonsoonTrough = !this.renderer.showMonsoonTrough;
          btn.classList.toggle('active', this.renderer.showMonsoonTrough);
          return;
        }
        if (tool === 'mapWind') {
          this.renderer.showMapWind = !this.renderer.showMapWind;
          btn.classList.toggle('active', this.renderer.showMapWind);
          return;
        }
        if (tool === 'mapPressure') {
          this.renderer.showMapPressure = !this.renderer.showMapPressure;
          btn.classList.toggle('active', this.renderer.showMapPressure);
          return;
        }
        if (tool === 'seasonSummary') {
          this.showSeasonSummary = !this.showSeasonSummary;
          btn.classList.toggle('active', this.showSeasonSummary);
          this.seasonSummaryPanel.style.display = this.showSeasonSummary ? '' : 'none';
          if (this.showSeasonSummary) this._forceUpdate();
          return;
        }
        if (tool === 'windHistory') {
          this.showWindHistory = !this.showWindHistory;
          btn.classList.toggle('active', this.showWindHistory);
          this._forceUpdate();
          return;
        }
        if (tool === 'forecast') {
          this.renderer.showForecastCone = !this.renderer.showForecastCone;
          btn.classList.toggle('active', this.renderer.showForecastCone);
          if (!this.renderer.showForecastCone && !this.renderer.showForecastSpaghetti) this._forecastCache = null;
          this._buildLegend();
          return;
        }
        if (tool === 'spaghetti') {
          this.renderer.showForecastSpaghetti = !this.renderer.showForecastSpaghetti;
          btn.classList.toggle('active', this.renderer.showForecastSpaghetti);
          if (!this.renderer.showForecastCone && !this.renderer.showForecastSpaghetti) this._forecastCache = null;
          this._buildLegend();
          return;
        }
        if (tool === 'forecastAll') {
          this.forecastAllStorms = !this.forecastAllStorms;
          btn.classList.toggle('active', this.forecastAllStorms);
          // Switching modes invalidates whichever cache isn't being used
          // anymore, so a stale forecast doesn't linger on screen.
          this._forecastCache = null;
          this._forecastCacheAll = {};
          return;
        }
        if (tool === 'clear') {
          this.world.env.clearShearPaint();
          return;
        }
        this.activeTool = this.activeTool === tool ? 'none' : tool;
        document.querySelectorAll('#toolToggle button[data-tool]').forEach((b) => {
          if (['tracks', 'outlook', 'forecast', 'forecastAll', 'spaghetti', 'swath', 'seasonSummary', 'windHistory', 'fronts', 'itcz', 'monsoonTrough', 'mapWind', 'mapPressure'].includes(b.dataset.tool)) return;
          b.classList.toggle('active', b.dataset.tool === this.activeTool);
        });
        if (this.activeTool === 'none') {
          document.querySelector('#toolToggle button[data-tool="none"]').classList.add('active');
        }
        if (this.activeTool !== 'conditions') this.conditionsReadout.style.display = 'none';
      });
    });

    document.getElementById('zoomInBtn').addEventListener('click', () => {
      this.renderer.zoomAt(this.renderer.cssW / 2, this.renderer.cssH / 2, 0.7);
    });
    document.getElementById('zoomOutBtn').addEventListener('click', () => {
      this.renderer.zoomAt(this.renderer.cssW / 2, this.renderer.cssH / 2, 1 / 0.7);
    });
    document.getElementById('zoomResetBtn').addEventListener('click', () => {
      this.renderer.resetView();
    });

    const collapseBtn = document.getElementById('panelCollapseBtn');
    const controlsWrap = document.getElementById('mapControlsWrap');
    collapseBtn.addEventListener('click', () => {
      const collapsed = controlsWrap.classList.toggle('collapsed');
      collapseBtn.textContent = collapsed ? '▸' : '▾';
      collapseBtn.title = collapsed ? 'Expand map controls' : 'Collapse map controls';
    });

    // Spawn tools: clicking one arms it (exclusive with the pan/paint
    // tools above — they share `activeTool`), then the next map click
    // places the system/feature and disarms back to Pan automatically,
    // so you don't have to remember to turn it off after one placement.
    document.querySelectorAll('#spawnBar button[data-spawn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const spawnType = 'spawn:' + btn.dataset.spawn;
        this.activeTool = this.activeTool === spawnType ? 'none' : spawnType;
        document.querySelectorAll('#spawnBar button[data-spawn]').forEach((b) => {
          b.classList.toggle('active', ('spawn:' + b.dataset.spawn) === this.activeTool);
        });
        document.querySelectorAll('#toolToggle button[data-tool]').forEach((b) => {
          if (['tracks', 'outlook', 'forecast', 'forecastAll', 'spaghetti', 'swath', 'seasonSummary', 'windHistory', 'fronts', 'itcz', 'monsoonTrough', 'mapWind', 'mapPressure'].includes(b.dataset.tool)) return;
          b.classList.toggle('active', b.dataset.tool === this.activeTool);
        });
        const spawnStatusLabel = document.getElementById('spawnStatusLabel');
        spawnStatusLabel.textContent = this.activeTool.startsWith('spawn:') ? 'click map to place' : '';
      });
    });

    document.getElementById('windHistoryMinBtn').addEventListener('click', () => {
      const panel = this.windHistoryPanel;
      const min = panel.classList.toggle('minimized');
      document.getElementById('windHistoryMinBtn').textContent = min ? '□' : '–';
    });
    document.querySelectorAll('.panel-min-btn[data-panel]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const panel = document.getElementById(btn.dataset.panel);
        const min = panel.classList.toggle('minimized');
        btn.textContent = min ? '□' : '–';
      });
    });
    document.getElementById('spawnMinBtn').addEventListener('click', () => {
      const panel = document.getElementById('spawnBar');
      const min = panel.classList.toggle('minimized');
      document.getElementById('spawnMinBtn').textContent = min ? '□' : '–';
    });
    document.getElementById('seasonSummaryMinBtn').addEventListener('click', () => {
      const panel = this.seasonSummaryPanel;
      const min = panel.classList.toggle('minimized');
      document.getElementById('seasonSummaryMinBtn').textContent = min ? '□' : '–';
    });
    document.getElementById('seasonSummaryPrevBtn').addEventListener('click', () => {
      this._navSeasonSummary(-1);
    });
    document.getElementById('seasonSummaryNextBtn').addEventListener('click', () => {
      this._navSeasonSummary(1);
    });
    this.seasonSummaryCanvas.addEventListener('click', (e) => {
      const rect = this.seasonSummaryCanvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return; // panel not laid out yet — nothing to hit-test against
      const scaleX = this.seasonSummaryCanvas.width / rect.width;
      const scaleY = this.seasonSummaryCanvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX, y = (e.clientY - rect.top) * scaleY;
      const rows = this._seasonSummaryRows || [];
      for (const row of rows) {
        if (x >= row.x1 - 4 && x <= row.x2 + 60 && y >= row.y && y <= row.y + row.h) {
          if (this.world.storms.includes(row.storm)) {
            this.selectedId = row.storm.id;
            this.selectedArchiveId = null;
          } else {
            this.selectedArchiveId = row.storm.id;
            this.selectedId = null;
          }
          this._forceUpdate();
          break;
        }
      }
    });

    const canvas = this.renderer.canvas;
    const posFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { x, y } = posFromEvent(e);
      const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      this.renderer.zoomAt(x, y, factor);
    }, { passive: false });

    canvas.addEventListener('mousedown', (e) => {
      const { x, y } = posFromEvent(e);
      if (this.activeTool === 'weaken' || this.activeTool === 'strengthen') {
        this._painting = true;
        this._paintAt(x, y);
      } else if (this.activeTool.startsWith('spawn:')) {
        this._spawnAt(this.activeTool.slice(6), x, y);
      } else {
        this._panning = true;
        this._panLast = { x, y };
        this._panMoved = false;
      }
    });
    canvas.addEventListener('mousemove', (e) => {
      const { x, y } = posFromEvent(e);
      if (this._painting) {
        this._paintAt(x, y);
      } else if (this._panning && this._panLast) {
        const dx = x - this._panLast.x, dy = y - this._panLast.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          this._panMoved = true;
          this.renderer.panByCss(dx, dy);
          this._panLast = { x, y };
        }
      } else if (this.activeTool === 'weaken' || this.activeTool === 'strengthen') {
        this.renderer.shearBrush = {
          lat: this.renderer.yToLat(y),
          lon: this.renderer.xToLon(x),
          radiusDeg: SHEAR_TOOL.brushRadiusDeg,
          mode: this.activeTool,
        };
      } else if (this.activeTool === 'conditions') {
        this._showConditionsAt(x, y);
      } else {
        this.renderer.shearBrush = null;
      }
    });
    canvas.addEventListener('mouseup', (e) => {
      const { x, y } = posFromEvent(e);
      if (this._panning && !this._panMoved) this._selectAt(x, y);
      this._panning = false;
      this._panLast = null;
    });
    canvas.addEventListener('mouseleave', () => {
      this._painting = false;
      this._panning = false;
      this.renderer.shearBrush = null;
      if (this.activeTool === 'conditions') this.conditionsReadout.style.display = 'none';
    });
    window.addEventListener('mouseup', () => { this._painting = false; });
  }

  // Bypasses the list-rebuild throttle (see update()) — use this after a
  // deliberate user action (nav click, row click) that should be
  // reflected immediately rather than waiting up to 300ms.
  _formatFormationDate(bornDay) {
    const doy = Math.floor(bornDay % 365);
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const cumDays = [0,31,59,90,120,151,181,212,243,273,304,334,365];
    let m = 0;
    while (m < 11 && doy >= cumDays[m + 1]) m++;
    const dom = doy - cumDays[m] + 1;
    const year = calendarYearOf(bornDay);
    const hourZ = Math.round((bornDay - Math.floor(bornDay)) * 24);
    return `${monthNames[m]} ${dom}, ${year} · ${hourZ}Z`;
  }

  _forceUpdate() {
    this._lastListRebuildTime = 0;
    this.update();
  }

  _selectAt(x, y) {
    let best = null, bestD = 18;
    for (const storm of this.world.storms) {
      const sx = this.renderer.lonToX(storm.lon), sy = this.renderer.latToY(storm.lat);
      const d = Math.hypot(sx - x, sy - y);
      if (d < bestD) { bestD = d; best = storm; }
    }
    this.selectedId = best ? best.id : null;
    this.selectedArchiveId = null;
    this._forecastCache = null;
  }

  _showConditionsAt(x, y) {
    const lat = this.renderer.yToLat(y);
    const lon = this.renderer.xToLon(x);
    const env = this.world.env;
    const s = env.stateAt(lat, lon);
    if (s.land > 0.5) {
      this.conditionsReadout.style.display = '';
      this.conditionsReadout.innerHTML = `<span class="k">${lat.toFixed(1)}°N ${Math.abs(lon).toFixed(1)}°W</span><br><span class="k">Land</span>`;
      return;
    }
    const anomaly = s.sst - s.sstNormal;
    this.conditionsReadout.style.display = '';
    this.conditionsReadout.innerHTML = `
      <span class="k">Pos</span>${lat.toFixed(1)}°N ${Math.abs(lon).toFixed(1)}°W<br>
      <span class="k">SST</span>${s.sst.toFixed(1)}°C<br>
      <span class="k">SST Δ</span>${anomaly >= 0 ? '+' : ''}${anomaly.toFixed(1)}°C<br>
      <span class="k">Shear</span>${s.shear.toFixed(0)} kt<br>
      <span class="k">RH</span>${Math.round((1 - s.dryAir) * 100)}%
    `;
  }

  _spawnAt(spawnType, x, y) {
    const lat = this.renderer.yToLat(y);
    const lon = this.renderer.xToLon(x);
    if (spawnType === 'wave' || spawnType === 'ts' || spawnType === 'hurricane') {
      this.world.spawnStorm(spawnType, lat, lon);
    } else if (spawnType === 'low' || spawnType === 'high') {
      this.world.env.spawnFeature(spawnType, lat, lon, this.world.dayNum);
    } else if (spawnType === 'etlow') {
      this.world.env.spawnUserExtratropicalLow(lat, lon, this.world.dayNum);
    } else if (spawnType === 'troughUp' || spawnType === 'troughDown') {
      this.world.env.adjustNearestTrough(lat, lon, spawnType === 'troughUp' ? 0.35 : -0.35);
    }
    // Placement is a one-shot action — disarm back to Pan afterward
    // rather than requiring the user to remember to turn the tool off.
    this.activeTool = 'none';
    document.querySelectorAll('#spawnBar button[data-spawn]').forEach((b) => b.classList.remove('active'));
    document.querySelector('#toolToggle button[data-tool="none"]').classList.add('active');
    document.getElementById('spawnStatusLabel').textContent = '';
    this._forceUpdate();
  }

  _paintAt(x, y) {
    const lat = this.renderer.yToLat(y);
    const lon = this.renderer.xToLon(x);
    const sign = this.activeTool === 'weaken' ? -1 : 1;
    this.world.env.paintShear(lat, lon, SHEAR_TOOL.brushRadiusDeg, sign * SHEAR_TOOL.strengthPerClick * 0.15, SHEAR_TOOL.maxAbs);
    this.renderer.shearBrush = { lat, lon, radiusDeg: SHEAR_TOOL.brushRadiusDeg, mode: this.activeTool };
  }

  _buildLegend() {
    const overlay = this.renderer.overlay;
    const items = {
      sst: [['<24°C', '#0a2038'], ['27°C', '#0c4a54'], ['30.5°C+', '#d6792c']],
      mdrsst: [['<24°C', '#0a2038'], ['27°C', '#0c4a54'], ['30.5°C+', '#d6792c'], ['dashed box = MDR/E.Atl feedback region', 'transparent']],
      none: [['no overlay — click again to re-enable', 'transparent']],
      mslp: [['<950mb', '#5a28be'], ['1000mb', '#46aa78'], ['1013mb', '#e6dc82'], ['1025mb+', '#f5ebdc'], ['lines = isobars, every 4mb', 'transparent']],
      sstAnomaly: [['-2°C', '#5c288f'], ['normal', '#ffffff'], ['+2°C', '#dc3737']],
      shear: [['<15kt fav.', '#5adc6e'], ['15-20kt neutral', '#e6dc3c'], ['20-25kt', '#ff9628'], ['35kt+ unfav.', '#ff4646']],
      dryair: [['moist', '#0c2a2e'], ['dry', '#d6b278']],
      humidity: [['dry (hostile)', '#785a32'], ['moist (favorable)', '#1e8296']],
      steering: [['steering flow vectors', 'transparent']],
      velpot: [['sinking air', 'rgb(190,110,40)'], ['neutral', 'rgb(245,238,224)'], ['rising air', 'rgb(20,90,100)']],
      '200mb': [['15kt', '#2facba'], ['45kt', '#ffdd52'], ['90kt+', '#aa00ff']],
      '500mb': [['-dam (trough)', '#5c288f'], ['normal', '#ffffff'], ['+dam (ridge)', '#dc3737']],
    }[overlay] || [];
    let html = items
      .map(([label, color]) => `<span><i style="background:${color}"></i>${label}</span>`)
      .join('');

    // MPI gets a proper sophisticated legend — exact kt AND mb at each
    // category threshold, not just a color-to-label swatch — matching a
    // real "potential maximum wind" product's colorbar.
    if (overlay === 'mpi') {
      const thresholds = [
        [34, 'rgb(150,200,130)', 'TS'], [64, 'rgb(255,200,60)', 'H1'], [84, 'rgb(255,130,30)', 'H2'],
        [97, 'rgb(230,30,40)', 'H3'], [114, 'rgb(230,30,150)', 'H4'], [135, 'rgb(180,60,230)', 'H4+'],
        [150, 'rgb(70,60,220)', 'H5'], [165, 'rgb(15,15,110)', 'H5+'],
      ];
      html = thresholds
        .map(([kt, color, cat]) => {
          const mb = Math.round(windToPressureMb(kt));
          return `<span><i style="background:${color}"></i>${cat} ${kt}kt/${mb}mb</span>`;
        })
        .join('');
    }

    if ((this.renderer.showForecastCone || this.renderer.showForecastSpaghetti)) {
      const fcItems = [['TS', '#4fd1c5'], ['Cat 1-2', '#ffb347'], ['Cat 3', '#ff8c42'], ['Cat 4-5', '#ff3ea5']];
      html += '<span style="margin-left:10px;color:var(--text-dim)">forecast:</span>' +
        fcItems.map(([label, color]) => `<span><i style="background:${color}"></i>${label}</span>`).join('');
    }
    this.legendEl.innerHTML = html;
  }

  _drawAceChart() {
    const year = calendarYearOf(this.world.dayNum);
    const dayBucket = Math.floor(this.world.dayNum);
    if (!this._aceCache || this._aceCache.year !== year || this._aceCache.day !== dayBucket) {
      this._aceCache = { year, day: dayBucket, series: computeSeasonAceSeries(this.world, year) };
    }
    const series = this._aceCache.series;
    const total = series[series.length - 1].cumAce;
    const currentIdx = Math.min(365, Math.floor(this.world.dayNum - (year - 2026) * 365));
    const currentAce = series[Math.max(0, currentIdx)].cumAce;
    this.aceReadout.textContent = `${currentAce.toFixed(0)}`;

    const canvas = this.aceCanvas;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const maxAce = Math.max(180, ...series.map((p) => p.cumAce));
    const pad = 4;
    const xOf = (day) => pad + (day / 365) * (w - pad * 2);
    const yOf = (ace) => h - pad - (ace / maxAce) * (h - pad * 2);

    // Reference lines: NOAA's approximate ACE-based season categories
    // (below-normal / near-normal / above-normal-hyperactive boundaries).
    ctx.strokeStyle = 'rgba(216,230,238,0.15)';
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1;
    for (const ref of [66, 123, 159]) {
      if (ref > maxAce) continue;
      ctx.beginPath();
      ctx.moveTo(pad, yOf(ref)); ctx.lineTo(w - pad, yOf(ref));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.strokeStyle = '#ffb347';
    ctx.lineWidth = 1.5;
    series.forEach((p, i) => {
      const x = xOf(p.day), y = yOf(p.cumAce);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // current-day marker
    ctx.beginPath();
    ctx.fillStyle = '#5ee1e6';
    ctx.arc(xOf(currentIdx), yOf(currentAce), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawWindHistory(storm) {
    // Visibility is controlled entirely by the explicit toggle button now
    // (see the 'windHistory' tool handler) — selecting a storm still
    // refreshes the chart's content so it stays current, but no longer
    // forces the panel open on every click, which was the actual
    // complaint (clicking a storm shouldn't yank a panel open you didn't
    // ask for).
    this.windHistoryPanel.style.display = this.showWindHistory ? '' : 'none';
    if (!this.showWindHistory || !storm || !storm.track || storm.track.length < 2) {
      return;
    }
    const canvas = this.windHistoryCanvas;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const track = storm.track;
    const day0 = track[0].day, day1 = track[track.length - 1].day;
    const span = Math.max(0.5, day1 - day0);
    const maxKt = Math.max(80, ...track.map((p) => p.kt));
    const pad = 4;
    const xOf = (day) => pad + ((day - day0) / span) * (w - pad * 2);
    const yOf = (kt) => h - pad - (kt / maxKt) * (h - pad * 2);

    // category threshold lines
    ctx.strokeStyle = 'rgba(216,230,238,0.12)';
    ctx.lineWidth = 1;
    for (const ref of [34, 64, 96]) {
      if (ref > maxKt) continue;
      ctx.beginPath();
      ctx.moveTo(pad, yOf(ref)); ctx.lineTo(w - pad, yOf(ref));
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(232,237,242,0.7)';
    ctx.lineWidth = 1.5;
    track.forEach((p, i) => {
      const x = xOf(p.day), y = yOf(p.kt);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    for (const p of track) {
      const cls = classify(p.kt);
      ctx.beginPath();
      ctx.fillStyle = cls.color;
      ctx.arc(xOf(p.day), yOf(p.kt), 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _navSeasonSummary(direction) {
    const years = this._allArchiveYears();
    if (!years.length) return;
    let idx = years.indexOf(this.seasonSummaryYear);
    if (idx === -1) idx = years.length - 1;
    idx = Math.max(0, Math.min(years.length - 1, idx + direction));
    this.seasonSummaryYear = years[idx];
    this._forceUpdate();
  }

  _allArchiveYears() {
    const years = new Set();
    for (const storm of this.world.archive) years.add(calendarYearOf(storm.bornDay));
    for (const storm of this.world.storms) years.add(calendarYearOf(storm.bornDay));
    return [...years].sort((a, b) => a - b);
  }

  // NHC/media-style season timeline: one horizontal bar per storm,
  // spanning its formation-to-dissipation days, colored by peak category,
  // with month gridlines — matches the reference layout directly.
  _drawSeasonSummary() {
    const years = this._allArchiveYears();
    if (this.seasonSummaryYear == null || !years.includes(this.seasonSummaryYear)) {
      this.seasonSummaryYear = years[years.length - 1] ?? calendarYearOf(this.world.dayNum);
    }
    const year = this.seasonSummaryYear;
    // Hyperactive season classification: >=150 ACE (roughly 165% of the
    // 30-year-normal target of 110) — a real, named category, not just
    // "a busy year." ACE-weighted, not storm-count-related, so a season
    // with modest counts but a couple of long-lived majors can qualify
    // just as much as a season with many storms.
    const seasonAceSeries = computeSeasonAceSeries(this.world, year);
    const seasonTotalAce = seasonAceSeries.length ? seasonAceSeries[seasonAceSeries.length - 1].cumAce : 0;
    const isHyperactive = seasonTotalAce >= 150;
    this.seasonSummaryYearLabel.textContent = String(year) + (isHyperactive ? '  ⚡ HYPERACTIVE' : '');
    this.seasonSummaryYearLabel.style.color = isHyperactive ? 'var(--rose)' : '';

    const yearStartDay = (year - 2026) * 365;
    const all = [...this.world.archive, ...this.world.storms]
      .filter((s) => calendarYearOf(s.bornDay) === year)
      .sort((a, b) => a.bornDay - b.bornDay);

    // Single continuous Jan-Dec timeline, one row per storm — this is
    // what Wikipedia's actual season charts look like (a shared axis, not
    // several side-by-side mini-charts). The "doesn't grow too long"
    // problem is solved by the panel scrolling vertically (see the
    // floating-panel-body max-height/overflow-y CSS), not by splitting
    // into columns, which was the wrong fix — it solved the height
    // problem but broke the format this was supposed to match.
    const ROW_H = 24;
    const leftPad = 8, rightPad = 8, topPad = 24, bottomPad = 20;
    const W = 560;

    const canvas = this.seasonSummaryCanvas;
    const newW = W;
    const newH = topPad + bottomPad + Math.max(1, all.length) * ROW_H;
    if (canvas.width !== newW) canvas.width = newW;
    if (canvas.height !== newH) canvas.height = newH;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const plotW = w - leftPad - rightPad;
    const xOf = (day) => leftPad + ((day - yearStartDay) / 365) * plotW;
    const cumDays = [0,31,59,90,120,151,181,212,243,273,304,334,365];
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // Month gridlines/labels along the top, once, spanning the full height.
    ctx.strokeStyle = 'rgba(216,230,238,0.12)';
    ctx.fillStyle = 'rgba(216,230,238,0.55)';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    for (let m = 0; m < 12; m++) {
      const x = xOf(yearStartDay + cumDays[m]);
      ctx.beginPath();
      ctx.moveTo(x, topPad); ctx.lineTo(x, h);
      ctx.stroke();
      const xMid = xOf(yearStartDay + (cumDays[m] + cumDays[m + 1]) / 2);
      ctx.fillText(monthNames[m], xMid, 15);
    }

    if (!all.length) {
      ctx.fillStyle = 'rgba(216,230,238,0.5)';
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('No systems yet this season.', leftPad, topPad + 16);
      return;
    }

    this._seasonSummaryRows = [];
    all.forEach((storm, i) => {
      const y = topPad + i * ROW_H;
      const startDay = storm.bornDay;
      const endDay = storm.track && storm.track.length ? storm.track[storm.track.length - 1].day : storm.bornDay;
      const x1 = xOf(startDay), x2 = Math.max(x1 + 3, xOf(endDay));
      const cls = classify(storm.peakKt);
      const barH = ROW_H * 0.6;
      ctx.fillStyle = cls.color;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x1, y + (ROW_H - barH) / 2, x2 - x1, barH, 3);
      else ctx.rect(x1, y + (ROW_H - barH) / 2, x2 - x1, barH);
      ctx.fill();
      if (storm.id === this.selectedArchiveId || storm.id === this.selectedId) {
        ctx.strokeStyle = '#e8edf2';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      const label = `${storm.displayName} (${cls.short})`;
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      if (ctx.measureText(label).width < x2 - x1 - 6) {
        ctx.fillStyle = '#0a1420';
        ctx.fillText(label, x1 + 4, y + ROW_H / 2 + 3);
      } else {
        ctx.fillStyle = '#e8edf2';
        ctx.fillText(label, x2 + 4, y + ROW_H / 2 + 3);
      }
      this._seasonSummaryRows.push({ x1, x2, y, h: ROW_H, storm });
    });
  }

  update() {
    const doy = Math.floor(this.world.dayNum % 365);
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const cumDays = [0,31,59,90,120,151,181,212,243,273,304,334,365];
    let mIdx = 0;
    while (mIdx < 11 && doy >= cumDays[mIdx + 1]) mIdx++;
    const dom = doy - cumDays[mIdx] + 1;
    const year = calendarYearOf(this.world.dayNum);
    const hourZ = Math.round((this.world.dayNum - Math.floor(this.world.dayNum)) * 24);
    this.dayReadout.textContent = `${monthNames[mIdx]} ${dom}, ${year} · ${hourZ}Z`;

    const midLon = -50;
    const mjo = this.world.osc.mjoFavorability(midLon, this.world.dayNum);
    const cckw = this.world.osc.cckwFavorability(midLon, this.world.dayNum);
    this.mjoBar.style.left = `${((mjo + 1) / 2) * 82}%`;
    this.cckwBar.style.left = `${((cckw + 1) / 2) * 82}%`;

    const enso = this.world.env.ensoIndex ?? 0;
    // Standard ONI-style categorization (Nino 3.4 region), now that the
    // index is directly scaled to represent that same deg-C anomaly:
    // Neutral -0.5..+0.5, Weak 0.5-1.0, Moderate 1.0-1.5, Strong 1.5+.
    const ensoMag = Math.abs(enso);
    const ensoStrength = ensoMag < 0.5 ? '' : ensoMag < 1.0 ? 'Weak ' : ensoMag < 1.5 ? 'Moderate ' : 'Strong ';
    const ensoTag = ensoMag < 0.5 ? 'Neutral' : enso < 0 ? `${ensoStrength}La Niña` : `${ensoStrength}El Niño`;
    this.ensoReadout.textContent = `${enso >= 0 ? '+' : ''}${enso.toFixed(2)}°C (${ensoTag})`;

    const nao = this.world.env.naoIndex ?? 0;
    const naoTag = nao <= -0.5 ? '−NAO (favors recurve)' : nao >= 0.5 ? '+NAO (blocks recurve)' : 'Neutral';
    this.naoReadout.textContent = `${nao >= 0 ? '+' : ''}${nao.toFixed(2)} (${naoTag})`;

    const amo = this.world.osc.amoIndex ?? 0;
    const amoTag = amo <= -0.3 ? '−AMO (fewer storms)' : amo >= 0.3 ? '+AMO (more storms)' : 'Neutral';
    this.amoReadout.textContent = `${amo >= 0 ? '+' : ''}${amo.toFixed(2)} (${amoTag})`;

    const high = this.world.env.highCenter;
    if (high) this.highReadout.textContent = `${high.pressureMb}mb @ ${high.lat.toFixed(0)}°N ${Math.abs(high.lon).toFixed(0)}°W`;

    this._drawAceChart();
    if (this.showSeasonSummary) {
      try {
        this._drawSeasonSummary();
      } catch (err) {
        console.error('Season summary draw failed:', err);
      }
    }

    this.stormCountEl.textContent = String(this.world.storms.length);

    // Rebuilding these lists' DOM every animation frame (60fps) destroys
    // and recreates every clickable row/button constantly — a mousedown-
    // to-mouseup click spans several of those rebuilds, and if the
    // element a click started on no longer exists by mouseup, the
    // browser's click synthesis can silently fail. Throttling the actual
    // DOM rebuild (data underneath doesn't meaningfully change faster
    // than a few times a second anyway) keeps rows stable long enough for
    // clicks to register reliably.
    const now = performance.now();
    const shouldRebuildLists = now - this._lastListRebuildTime > 300;
    if (shouldRebuildLists) this._lastListRebuildTime = now;

    if (shouldRebuildLists) {
      this.stormListEl.innerHTML = '';
      if (this.world.storms.length === 0) {
        this.stormListEl.innerHTML = '<div class="empty">No active systems — watching for waves…</div>';
      }
      for (const storm of [...this.world.storms].sort((a, b) => b.intensityKt - a.intensityKt)) {
        const cls = classify(storm.intensityKt, storm.phase === 'extratropical');
        const badgeLabel = storm.phase === 'remnant'
          ? `REMNANT LOW · ${storm.pressureMb}mb`
          : `${cls.short} · ${Math.round(storm.intensityKt)}kt · ${storm.pressureMb}mb · ${Math.round(storm.forwardSpeedKt || 0)}kt fwd`;
        const badgeColor = storm.phase === 'remnant' ? 'rgba(216, 230, 238, 0.6)' : cls.color;
        const li = document.createElement('li');
        li.className = storm.id === this.selectedId ? 'selected' : '';
        li.innerHTML = `
          <span>${storm.displayName}</span>
          <span class="badge" style="background:${badgeColor}">${badgeLabel}</span>
        `;
        li.addEventListener('click', () => {
          this.selectedId = storm.id;
          this.selectedArchiveId = null;
          this._forecastCache = null;
          this._forceUpdate();
        });
        this.stormListEl.appendChild(li);
      }
    }

    // --- Storm archive, grouped by real calendar year (most recent first) ---
    this.archiveCountEl.textContent = String(this.world.archive.length);
    const byYear = new Map();
    for (const storm of this.world.archive) {
      const year = calendarYearOf(storm.bornDay);
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(storm);
    }
    const years = [...byYear.keys()].sort((a, b) => a - b);
    if (shouldRebuildLists) {
    this.archiveListEl.innerHTML = '';
    if (years.length === 0) {
      this.archiveListEl.innerHTML = '<div class="archive-empty">No dissipated systems yet this run.</div>';
    } else {
      // Flip through one season at a time instead of one long scrolling
      // list of every year stacked — defaults to the most recent season
      // with data, but stays put once the user has picked one (even as
      // the live sim keeps adding new years) unless they navigate again.
      if (this.archiveDisplayYear == null || !years.includes(this.archiveDisplayYear)) {
        this.archiveDisplayYear = years[years.length - 1];
      }
      const yr = this.archiveDisplayYear;
      const idx = years.indexOf(yr);

      const nav = document.createElement('div');
      nav.className = 'archive-year-header';
      const prevBtn = document.createElement('button');
      prevBtn.textContent = '◀';
      prevBtn.disabled = idx <= 0;
      prevBtn.addEventListener('click', () => { this.archiveDisplayYear = years[idx - 1]; this._forceUpdate(); });
      const label = document.createElement('span');
      const stormsThisYear = byYear.get(yr).sort((a, b) => a.bornDay - b.bornDay);
      const named = stormsThisYear.filter((s) => s.peakKt >= 34).length;
      const hurr = stormsThisYear.filter((s) => s.peakKt >= 64).length;
      const major = stormsThisYear.filter((s) => s.peakKt >= 96).length;
      const seasonAce = stormsThisYear.reduce((sum, s) => sum + (s.ace || 0), 0);
      label.textContent = `${yr} — ${named} named, ${hurr} hurr, ${major} major, ACE ${seasonAce.toFixed(0)}`;
      const nextBtn = document.createElement('button');
      nextBtn.textContent = '▶';
      nextBtn.disabled = idx >= years.length - 1;
      nextBtn.addEventListener('click', () => { this.archiveDisplayYear = years[idx + 1]; this._forceUpdate(); });
      nav.appendChild(prevBtn); nav.appendChild(label); nav.appendChild(nextBtn);
      this.archiveListEl.appendChild(nav);

      const viewRow = document.createElement('div');
      viewRow.className = 'archive-year-header';
      const viewLabel = document.createElement('span');
      viewLabel.textContent = 'Show this season on map';
      const viewBtn = document.createElement('button');
      const isViewing = this.viewingSeasonYear === yr;
      viewBtn.textContent = isViewing ? 'Hide on map' : 'View on map';
      viewBtn.className = isViewing ? 'active' : '';
      viewBtn.addEventListener('click', () => {
        this.viewingSeasonYear = this.viewingSeasonYear === yr ? null : yr;
        this._forceUpdate();
      });
      viewRow.appendChild(viewLabel); viewRow.appendChild(viewBtn);
      this.archiveListEl.appendChild(viewRow);

      for (const storm of stormsThisYear) {
        const cls = classify(storm.peakKt);
        const row = document.createElement('div');
        row.className = 'archive-row' + (storm.id === this.selectedArchiveId ? ' selected' : '');
        row.innerHTML = `
          <span>${storm.displayName}${storm.subtropical ? ' (subtr.)' : ''}${storm.origin === 'CAG' ? ' (CAG)' : ''}</span>
          <span class="badge" style="background:${cls.color}">${cls.short} · ${Math.round(storm.peakKt)}kt · ${storm.minPressureMb}mb</span>
        `;
        row.addEventListener('click', () => {
          this.selectedArchiveId = storm.id;
          this.selectedId = null;
          this._forceUpdate();
        });
        this.archiveListEl.appendChild(row);
      }
    }
    } // end shouldRebuildLists

    const selected = this.world.storms.find((s) => s.id === this.selectedId);
    const selectedArchived = this.selectedArchiveId
      ? this.world.archive.find((s) => s.id === this.selectedArchiveId)
      : null;
    const shown = selected || selectedArchived;

    // Forecast cone/spaghetti: recompute at most once per simulated day
    // (cheap enough, avoids redoing an ensemble of forward integrations
    // every animation frame). Either for just the selected storm, or for
    // every active storm at once if forecastAllStorms is on. Remnant
    // lows are excluded entirely — they're weak, disorganized, and
    // meandering by definition, so a forecast cone/spaghetti spread
    // doesn't mean anything meaningful for one.
    if (this.renderer.showForecastCone || this.renderer.showForecastSpaghetti) {
      const dayBucket = Math.floor(this.world.dayNum * 4); // every 6h tick
      if (this.forecastAllStorms) {
        for (const s of this.world.storms) {
          if (s.phase === 'remnant') continue;
          const cached = this._forecastCacheAll[s.id];
          if (!cached || cached.day !== dayBucket) {
            this._forecastCacheAll[s.id] = {
              day: dayBucket,
              data: computeForecast(s, this.world.env, this.world.osc, this.world.dayNum, s.id * 733 + dayBucket),
            };
          }
        }
        // Drop entries for storms that dissipated/archived/went remnant since the last check.
        const liveIds = new Set(this.world.storms.filter((s) => s.phase !== 'remnant').map((s) => String(s.id)));
        for (const id of Object.keys(this._forecastCacheAll)) {
          if (!liveIds.has(id)) delete this._forecastCacheAll[id];
        }
      } else if (selected && selected.phase !== 'remnant') {
        if (!this._forecastCache || this._forecastCache.stormId !== selected.id || this._forecastCache.day !== dayBucket) {
          this._forecastCache = {
            stormId: selected.id,
            day: dayBucket,
            data: computeForecast(selected, this.world.env, this.world.osc, this.world.dayNum, selected.id * 733 + dayBucket),
          };
        }
      } else if (selected && selected.phase === 'remnant' && this._forecastCache && this._forecastCache.stormId === selected.id) {
        // The selected storm degenerated into a remnant low since the
        // cache was last built — clear it so stale pre-remnant forecast
        // data doesn't keep displaying.
        this._forecastCache = null;
      }
    }

    if (!shown) {
      this.detailBody.className = 'detail-body muted';
      this.detailBody.textContent = 'Click a system to inspect it.';
      this._drawWindHistory(null);
    } else {
      const cls = classify(shown.intensityKt, shown.phase === 'extratropical');
      const env = shown.lastEnv || {};
      const statusLine = selectedArchived
        ? `${cls.label} (dissipated, peak ${Math.round(shown.peakKt)}kt)`
        : shown.phase === 'remnant'
          ? `Remnant Low (peak ${Math.round(shown.peakKt)}kt) — meandering, may regenerate`
          : cls.label;
      this.detailBody.className = 'detail-body';
      const formationLabel = this._formatFormationDate(shown.bornDay);
      const originLabel = shown.origin === 'CAG' ? 'Central American Gyre'
        : shown.subtropical ? 'Subtropical/cutoff low' : 'Tropical wave (MDR)';
      const isArchivedDissipated = !!selectedArchived;
      const lastTrackDay = shown.track && shown.track.length ? shown.track[shown.track.length - 1].day : shown.bornDay;
      const dissipationRow = isArchivedDissipated
        ? `<div class="detail-row"><span class="k">Dissipated</span><span class="v">${this._formatFormationDate(lastTrackDay)}</span></div>`
        : `<div class="detail-row"><span class="k">Dissipated</span><span class="v">Still active</span></div>`;
      this.detailBody.innerHTML = `
        <div class="detail-row"><span class="k">Name</span><span class="v">${shown.displayName}${shown.subtropical ? ' (subtropical)' : ''}</span></div>
        <div class="detail-row"><span class="k">Status</span><span class="v" style="color:${cls.color}">${statusLine}</span></div>
        <div class="detail-row"><span class="k">Formed</span><span class="v">${formationLabel}</span></div>
        ${dissipationRow}
        <div class="detail-row"><span class="k">Origin</span><span class="v">${originLabel}</span></div>
        <div class="detail-row"><span class="k">Wind</span><span class="v">${Math.round(shown.intensityKt)} kt</span></div>
        <div class="detail-row"><span class="k">Pressure</span><span class="v">${shown.pressureMb} mb</span></div>
        <div class="detail-row"><span class="k">Forward speed</span><span class="v">${Math.round(shown.forwardSpeedKt || 0)} kt</span></div>
        <div class="detail-row"><span class="k">ACE</span><span class="v">${(shown.ace || 0).toFixed(2)}</span></div>
        <div class="detail-row"><span class="k">Peak</span><span class="v">${Math.round(shown.peakKt)} kt / ${shown.minPressureMb} mb</span></div>
        <div class="detail-row"><span class="k">Age</span><span class="v">${shown.ageDays.toFixed(1)} d</span></div>
        <div class="detail-row"><span class="k">Position</span><span class="v">${shown.lat.toFixed(1)}°N ${shown.lon.toFixed(1)}°</span></div>
        <div class="detail-row"><span class="k">SST</span><span class="v">${(env.sst ?? 0).toFixed(1)}°C</span></div>
        <div class="detail-row"><span class="k">Shear</span><span class="v">${(env.shear ?? 0).toFixed(0)} kt</span></div>
        <div class="detail-row"><span class="k">Dry air</span><span class="v">${Math.round((env.dryAir ?? 0) * 100)}%</span></div>
        <div class="detail-row"><span class="k">200mb pattern</span><span class="v">${(env.upperHeight ?? 0) < 0 ? 'Trough' : 'Ridge'}</span></div>
      `;
      this._drawWindHistory(shown);
    }
  }
}
