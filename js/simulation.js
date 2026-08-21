// simulation.js — top-level World: owns environment, oscillations, wave
// source, and the live storm list; advances everything by one tick.

import { TIME, GENESIS as GEN, SUBTROPICAL as SUB, CAG, AMO, SPAWN, RI } from './constants.js';
import { OscillationState } from './oscillations.js';
import { Environment } from './environment.js';
import { WaveSource, genesisPotential, TropicalWave } from './waves.js';
import { Storm } from './storm.js';
import { NameCycler, CycloneNumberer, EPAC_NAME_LISTS } from './names.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Whether a given lat/lon sits in genuine Eastern Pacific territory —
// either west of the general basin boundary, or along the Pacific side
// of the Central American coastline specifically — that coastline
// curves well east of the general boundary for its entire run from
// Panama up through southern Mexico, not just near Panama. A simple
// longitude cutoff (or a Panama-only exception) misses most of that
// stretch entirely, which was the actual cause of storms near the
// Central American Pacific coast getting Atlantic names/numbers.
// Piecewise segments approximate the real coastline; verified directly
// against known Caribbean and Pacific reference points on both sides
// (Jamaica, the Gulf of Honduras, Nicaragua's and Honduras's Caribbean
// coasts on one side; Panama's, Costa Rica's, Nicaragua's, El
// Salvador's, Guatemala's, and Mexico's Pacific coasts on the other)
// before trusting it.
const EPAC_COAST_SEGMENTS = [
  { latMin: 7, latMax: 9.5, lonMin: -84, lonMax: -77 },     // Panama / Costa Rica south
  { latMin: 9.5, latMax: 11, lonMin: -87, lonMax: -84 },    // Costa Rica / Nicaragua south
  { latMin: 11, latMax: 13.0, lonMin: -88, lonMax: -85.5 }, // Nicaragua
  { latMin: 13.0, latMax: 14.5, lonMin: -92, lonMax: -87.5 }, // El Salvador / Guatemala south
  { latMin: 14.5, latMax: 18, lonMin: -99, lonMax: -90 },   // Guatemala north / Mexico (Chiapas-Oaxaca-Guerrero)
];
// Real tropical cyclogenesis is suppressed near an existing circulation —
// subsidence/outflow from an already-organized system makes the immediate
// area genuinely hostile to a second system spinning up right next to it
// or directly astride its track, which is also why storms so rarely form
// shoulder-to-shoulder rather than with real spacing between them. This is
// on top of (not instead of) the physical shear a storm's own outflow now
// imposes on the shared environment (see environment.js) — that handles
// the broader, gradual suppression; this is a hard floor against genesis
// essentially on top of an existing system.
function tooCloseToExistingStorm(lat, lon, storms) {
  for (const storm of storms) {
    if (storm.dissipated) continue;
    const d = Math.hypot(storm.lat - lat, storm.lon - lon);
    if (d < GEN.minGenesisSeparationDeg) return true;
  }
  return false;
}

function isEasternPacificPosition(lat, lon) {
  if (lon < SUB.minGenesisLon) return true;
  for (const seg of EPAC_COAST_SEGMENTS) {
    if (lat >= seg.latMin && lat < seg.latMax && lon >= seg.lonMin && lon <= seg.lonMax) return true;
  }
  return false;
}

export class World {
  constructor(seed = 42) {
    this.seed = seed;
    this.rand = mulberry32(seed);
    this.osc = new OscillationState();
    this.env = new Environment(this.osc, seed);
    this.waveSource = new WaveSource(this.rand, this.osc);
    this.names = new NameCycler();
    this.numberer = new CycloneNumberer('L');
    // Eastern Pacific naming — used only for storms manually spawned
    // (via the sandbox spawn tool) west of the real Atlantic/Caribbean
    // basin boundary. Natural genesis is already gated out of that
    // territory entirely (see SUB.minGenesisLon), but the spawn tool
    // deliberately allows placing a storm anywhere on the wider display
    // grid, so a storm placed there should get correct NHC Eastern
    // Pacific naming/numbering instead of continuing the Atlantic list.
    this.epacNames = new NameCycler(EPAC_NAME_LISTS);
    this.epacNumberer = new CycloneNumberer('E');

    this.dayNum = 0;
    this.storms = [];       // active
    this.archive = [];      // dissipated, kept for season stats
    this.paused = false;
    this.speedMultiplier = 1;

    this.env.update(this.dayNum);
  }

  get activeStorms() { return this.storms; }

  tick() {
    if (this.paused) return;
    const dtDays = TIME.hoursPerTick / 24;
    this.dayNum += dtDays;
    this.osc.stepNao(dtDays, this.rand);
    this.osc.stepAmo(this.dayNum, dtDays);

    this.env.update(this.dayNum, this.storms, this.rand);

    this.waveSource.maybeSpawn(this.dayNum, this.env);
    this.waveSource.step(dtDays, this.env, this.dayNum);

    // Genesis check: for each live wave, stochastically test GPI at its position.
    for (const wave of this.waveSource.waves) {
      if (wave.spawned) continue;
      if (isEasternPacificPosition(wave.lat, wave.lon)) continue; // drifted into genuine Eastern Pacific territory (general boundary or the Panama/Costa Rica curve)
      if (this.rand() > GEN.gpiCheckChancePerTick) continue;
      const gpi = genesisPotential(this.env, this.osc, wave.lat, wave.lon, this.dayNum, wave.landDisruption);
      // +AMO effectively lowers the genesis bar (more storms get over the
      // line); -AMO raises it — on top of AMO's separate SST effect.
      const effectiveThreshold = GEN.gpiThreshold - this.osc.amoIndex * AMO.genesisThresholdShift;
      if (gpi >= effectiveThreshold) {
        // Crossing the threshold doesn't guarantee genesis on the spot —
        // real tropical cyclogenesis has meaningful internal-dynamics
        // uncertainty a GPI-style index alone can't capture; even
        // genuinely favorable-looking disturbances often fail to
        // organize. Success chance scales with how far GPI exceeds the
        // threshold (comfortably favorable conditions succeed more
        // reliably than marginal ones), capped below certainty even at
        // the best conditions.
        const margin = gpi - effectiveThreshold;
        const successChance = Math.min(GEN.maxGenesisSuccessChance,
          GEN.genesisSuccessBaseChance + margin * GEN.genesisSuccessMarginCoeff);
        if (this.rand() < successChance && !tooCloseToExistingStorm(wave.lat, wave.lon, this.storms)) {
          const storm = new Storm({
            lat: wave.lat,
            lon: wave.lon,
            number: this.numberer.next(Math.floor(this.dayNum / 365)),
            bornDay: this.dayNum,
            rand: this.rand,
          });
          this.storms.push(storm);
          wave.spawned = true;
        }
      }
    }

    // Subtropical / cutoff-low genesis: an independent pathway not tied to
    // tropical waves — a mid-latitude trough occasionally spins up a warm-
    // core system directly if it's sitting over warm-enough water with
    // tolerable shear. Real, if less common than wave-driven genesis.
    // El Nino years genuinely favor this pathway more — with the MDR/
    // Caribbean hostile, more of what activity does occur ends up forming
    // or peaking in the subtropics instead, where shear is comparatively
    // more tolerable.
    const ensoSubtropicalFactor = Math.max(0.4, 1 + this.env.ensoIndex * SUB.ensoGenesisCoeff);
    for (const center of this.env.troughCenters) {
      if (center.lat < SUB.minLat || center.lat > SUB.maxLat) continue;
      if (isEasternPacificPosition(center.lat, center.lon)) continue; // stay out of Eastern Pacific territory
      if (this.rand() > SUB.chancePerTroughPerTick * ensoSubtropicalFactor) continue;
      const s = this.env.stateAt(center.lat, center.lon);
      if (s.land > 0.3) continue;
      if (s.sst < SUB.minSst) continue;
      if (s.shear > SUB.maxShear) continue;
      if (tooCloseToExistingStorm(center.lat, center.lon, this.storms)) continue;
      const storm = new Storm({
        lat: center.lat,
        lon: center.lon,
        number: this.numberer.next(Math.floor(this.dayNum / 365)),
        bornDay: this.dayNum,
        subtropical: true,
        rand: this.rand,
      });
      this.storms.push(storm);
    }

    // Cutoff lows (natural ULLs) are, if anything, the more classic real-
    // world source of subtropical cyclogenesis — an isolated upper low
    // that's become cut off from the main westerly flow, sitting and
    // spinning over warm water. Checked as its own genesis pathway,
    // separate from (and with a higher per-feature chance than) the
    // traveling-trough pathway above.
    for (const ull of this.env.naturalUlls) {
      if (ull.lat < SUB.minLat || ull.lat > SUB.maxLat) continue;
      if (isEasternPacificPosition(ull.lat, ull.lon)) continue; // stay out of Eastern Pacific territory
      if (this.rand() > SUB.chancePerUllPerTick * ensoSubtropicalFactor) continue;
      const s = this.env.stateAt(ull.lat, ull.lon);
      if (s.land > 0.3) continue;
      if (s.sst < SUB.minSst) continue;
      if (tooCloseToExistingStorm(ull.lat, ull.lon, this.storms)) continue;
      const storm = new Storm({
        lat: ull.lat,
        lon: ull.lon,
        number: this.numberer.next(Math.floor(this.dayNum / 365)),
        bornDay: this.dayNum,
        subtropical: true,
        rand: this.rand,
      });
      this.storms.push(storm);
    }

    // Central American Gyre genesis: a broad monsoon-trough-like low over
    // Central America / the western Caribbean / Bay of Campeche, most
    // common in the May-June and Oct-Nov shoulder-season windows (a
    // distinct bimodal seasonality from the MDR's single Aug-Sep peak).
    // CAG-spawned storms tend to meander at low latitude — represented by
    // an inflated wobble that only calms down once a trough gets close
    // enough to actually pick the storm up (storm.js's trough-capture
    // mechanic already handles the "picked up by a trough" part).
    {
      const doy = this.dayNum % 365;
      const seasonality =
        CAG.peak1Amplitude * Math.exp(-0.5 * Math.pow((doy - CAG.peak1DayOfYear) / CAG.peak1Width, 2)) +
        CAG.peak2Amplitude * Math.exp(-0.5 * Math.pow((doy - CAG.peak2DayOfYear) / CAG.peak2Width, 2));
      if (this.rand() < CAG.chancePerTick * seasonality) {
        const lat = CAG.latMin + this.rand() * (CAG.latMax - CAG.latMin);
        const lon = CAG.lonMin + this.rand() * (CAG.lonMax - CAG.lonMin);
        const s = this.env.stateAt(lat, lon);
        if (s.land < 0.3 && s.sst >= CAG.minSst && s.shear <= CAG.maxShear && !tooCloseToExistingStorm(lat, lon, this.storms)) {
          // Early (May-Jun) vs late (Oct+) season biases the outcome —
          // real climatology: early Gulf/Caribbean systems skew short-
          // lived/weak, late-season Caribbean systems that get going have
          // real potential to meander and become powerful, especially in
          // La Nina years.
          let ceilingBiasKt = 0;
          if (doy < CAG.earlySeasonDayThreshold) {
            ceilingBiasKt = CAG.earlySeasonCeilingBiasKt;
          } else if (doy >= CAG.lateSeasonDayThreshold) {
            ceilingBiasKt = CAG.lateSeasonCeilingBiasKt - this.osc.ensoIndex(this.dayNum) * CAG.lateSeasonEnsoCoeffKt;
          }
          const storm = new Storm({
            lat, lon,
            number: this.numberer.next(Math.floor(this.dayNum / 365)),
            bornDay: this.dayNum,
            rand: this.rand,
            ceilingBiasKt,
          });
          storm.origin = 'CAG';
          storm.meandering = true;
          this.storms.push(storm);
        }
      }
    }

    // ITCZ roll-up genesis: a real, standalone East Atlantic pathway —
    // distinct from wave-triggered genesis, though it can also interact
    // with a nearby wave (see genesisPotential's ITCZ swing term).
    // Outcomes range from a full major hurricane to a short-lived weak
    // depression, which just falls out of the existing ceiling/RI/
    // outflow variance once the system forms, same as any other pathway.
    {
      const itczLat = this.env.itczLat(this.dayNum);
      // The roll-up chance wasn't gated by season at all — a real bug,
      // not just miscalibration: it could (and did) fire in the dead of
      // winter, which should be flatly impossible. ITCZ-driven TCG is
      // confined to hurricane season, same seasonal envelope used for
      // wave spawning (hard zero outside the season window, naturally
      // higher near its peak within it).
      const seasonal = this.osc.seasonalFactor(this.dayNum);
      if (seasonal > 0 && this.rand() < GEN.itczRollupChancePerTick * seasonal) {
        const lat = itczLat + (this.rand() - 0.5) * 2 * GEN.itczProximityDeg;
        const lon = GEN.itczRollupLonMin + this.rand() * (GEN.itczRollupLonMax - GEN.itczRollupLonMin);
        if (!isEasternPacificPosition(lat, lon)) {
          const s = this.env.stateAt(lat, lon);
          if (s.land < 0.3 && s.sst >= GEN.minSstForGenesis && s.shear <= GEN.maxShearForGenesis && !tooCloseToExistingStorm(lat, lon, this.storms)) {
            const storm = new Storm({
              lat, lon,
              number: this.numberer.next(Math.floor(this.dayNum / 365)),
              bornDay: this.dayNum,
              rand: this.rand,
            });
            storm.origin = 'ITCZ';
            this.storms.push(storm);
          }
        }
      }
    }

    // Caribbean monsoon trough genesis: real, seasonal, and distinct
    // from both the ITCZ and CAG — can produce genesis on its own, on
    // top of the boost it already gives wave/CAG genesis odds when
    // co-located (see genesisPotential and the CAG block above).
    {
      const mtStrength = this.env.monsoonTroughStrength(this.dayNum);
      if (this.rand() < GEN.monsoonTroughRollupChancePerTick * mtStrength) {
        const geo = this.env.monsoonTroughGeometry(this.dayNum);
        const lat = geo.latCenter + (this.rand() - 0.5) * 2 * geo.latHalfExtent;
        const lon = geo.lonCenter + (this.rand() - 0.5) * 2 * geo.lonHalfExtent;
        const s = this.env.stateAt(lat, lon);
        if (s.land < 0.3 && s.sst >= GEN.minSstForGenesis && s.shear <= GEN.maxShearForGenesis && !tooCloseToExistingStorm(lat, lon, this.storms)) {
          const storm = new Storm({
            lat, lon,
            number: this.numberer.next(Math.floor(this.dayNum / 365)),
            bornDay: this.dayNum,
            rand: this.rand,
          });
          storm.origin = 'MonsoonTrough';
          storm.meandering = true;
          this.storms.push(storm);
        }
      }
    }

    for (const storm of this.storms) {
      storm.step(this.env, this.osc, dtDays, this.dayNum, this.rand, this.storms);
      // Naming happens separately from numbering: a system keeps its "0XL"
      // designation for life unless/until it actually reaches 34kt, at
      // which point (and only then) it gets the next name off the list —
      // so the Nth named storm of the year and the Nth system of the year
      // are generally different numbers, exactly like real operational
      // practice.
      // Named at 33.5kt, not a hard 34 — the UI displays rounded
      // intensity (Math.round), so a storm sitting at 33.5-33.99kt was
      // showing "34kt" on screen while failing this check internally,
      // looking to anyone watching like TDs simply weren't getting
      // named at 34kt. Aligning the threshold with the display rounding
      // boundary means anything that visibly reads "34kt" gets named at
      // that exact moment, matching what's actually on screen.
      if (!storm.name && storm.intensityKt >= 33.5) {
        storm.name = this.names.next(Math.floor(this.dayNum / 365));
      }
    }

    const stillActive = [];
    for (const storm of this.storms) {
      if (storm.dissipated) this.archive.push(storm);
      else stillActive.push(storm);
    }
    this.storms = stillActive;
  }

  // Manually spawn a system for "what if" scenario-building — a
  // tropical wave (goes through the normal genesis-check pipeline, so it
  // may or may not actually develop, exactly like a real wave), or a
  // fully-formed tropical storm / hurricane placed directly.
  spawnStorm(type, lat, lon) {
    const yearIndex = Math.floor(this.dayNum / 365);
    if (type === 'wave') {
      this.waveSource.waves.push(new TropicalWave(lat, lon, this.dayNum));
      return;
    }
    const initialIntensityKt = type === 'hurricane' ? SPAWN.hurricaneInitialKt : SPAWN.tsInitialKt;
    // Manually spawned TS/hurricanes are placed as already-mature systems,
    // not fresh depressions — backdate bornDay/ageDays together so they
    // skip the "just formed" organization ramp consistently (a spawned
    // hurricane shouldn't need to wait 2+ days to be allowed to act like one).
    const backdateDays = RI.organizationRampDays + 0.5;
    // A storm placed west of the real Atlantic/Caribbean/Gulf basin is
    // genuinely Eastern Pacific territory (the display grid was widened
    // that direction purely for aspect-ratio purposes — see constants.js)
    // and should get correct NHC Eastern Pacific naming/numbering, not
    // continue the Atlantic list.
    const isEpac = isEasternPacificPosition(lat, lon);
    const numberer = isEpac ? this.epacNumberer : this.numberer;
    const namer = isEpac ? this.epacNames : this.names;
    const storm = new Storm({
      lat, lon,
      number: numberer.next(yearIndex),
      bornDay: this.dayNum - backdateDays,
      initialIntensityKt,
      initialAgeDays: backdateDays,
      rand: this.rand,
    });
    storm.basin = isEpac ? 'epac' : 'atlantic';
    if (initialIntensityKt >= 34) {
      storm.name = namer.next(yearIndex);
    }
    this.storms.push(storm);
  }
}
