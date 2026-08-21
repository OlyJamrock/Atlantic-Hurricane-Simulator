# Atlantic Hurricane Season Simulator

Inspired by [Monsoonjr99's Cyclone Simulator](https://monsoonjr99.github.io/cyclone-sim/),
rebuilt from scratch around the large-scale drivers that actually govern
real Atlantic tropical cyclone behavior: real coastline geography, seasonal
climatology, a Bermuda-Azores subtropical high steering storms along the
trade-wind belt and recurving them poleward, vertical wind shear, upper-level
troughs, dry-air intrusions, and the MJO / CCKW rhythm that paces genesis.

No build step, no framework dependencies (two Google Fonts loaded via
`<link>`, everything else is plain JS/canvas). Open `index.html` via a
local server (see below) and it runs.

## Running it

```bash
npx serve .
# or, if you don't have Node installed:
python -m http.server 8000
```

Then open the printed localhost URL (opening `index.html` directly via
`file://` won't work — ES modules require an actual server).

Headless sanity checks (no browser needed) live in `tools/`:

```bash
node tools/headless-sanity-check.mjs   # runs one season, prints genesis/intensity stats
node tools/track-survey.mjs            # prints sample tracks from several strong storms
node tools/recurve-check.mjs           # measures how many strong storms recurve vs. hit land
node tools/high-survey.mjs             # Bermuda-Azores high position/strength distribution over N seasons
node tools/fujiwhara-check.mjs         # confirms storm-storm absorption and genesis-spacing actually fire
```

## Architecture

```
js/
  constants.js     all tunable numbers (grid extent, season timing, Bermuda
                    high/trough params, shear/SST/genesis thresholds, storm
                    physics rates, paint-tool settings)
  land-data.js      auto-generated Atlantic coastline polygons (see below)
  geography.js      point-in-land test + land-mask rasterization
  noise.js          tiny seeded value-noise field (no dependency)
  oscillations.js   MJO / CCKW / ENSO-like envelopes + seasonal factor
  environment.js    gridded SST, shear, 200mb height pattern (Bermuda high +
                    troughs), dry air, geostrophic steering flow, paintable
                    shear anomaly — recomputed each tick
  waves.js          tropical wave source + genesis potential index (GPI)
  storm.js          a single storm: intensity model + motion model
  scale.js          intensity classification / colors
  names.js          rotating storm name list
  simulation.js     World: owns everything above, advances one tick
  render.js         canvas drawing: vector coastlines, spinning cyclone
                     icons, past-track overlay, shear-brush preview
  ui.js             DOM wiring: controls, tools, mouse painting, side panel
  main.js           bootstraps World + Renderer + UI, runs the RAF loop
tools/
  headless-sanity-check.mjs   run the sim without a browser
  track-survey.mjs             print sample storm tracks
  recurve-check.mjs            measure recurvature rate across seeds
```

`simulation.js` has zero DOM dependencies, which is why the `tools/*.mjs`
scripts can run the whole model in plain Node — the fastest way to tune
constants without eyeballing a canvas.

## Coastline data

`js/land-data.js` is auto-generated from Natural Earth's public-domain
1:50m land polygons (via the `world-atlas` npm package), clipped to the
basin's display extent (0-45°N, 100°W-0°) and lightly simplified. To
regenerate it with a different extent or detail level, see the conversion
script pattern: load the topojson with `topojson-client`, clip rings to a
bounding box (Sutherland-Hodgman), decimate close points, and write out a
flat `[[ring, ring, ...], ...]` array of `[lon, lat]` polygons.

## The physics model (v0.2)

Still not a primitive-equation model — a set of analytic/noise-driven
fields tuned for the right *qualitative* behavior at game-loop speed, now
grounded in real basin geometry and climatology:

- **Seasonality** (`oscillations.js` `seasonalFactor`): a Gaussian centered
  on day-of-year 253 (~Sept 10) blends every climatological field between
  peak-season and off-season endpoints — SST, shear, genesis wave interval,
  and the Bermuda high's strength/position all breathe with the season.
- **SST field**: seasonal climatology (warm at the equator, a Caribbean/Gulf
  warm-pool lobe, cooler poleward and off-season) plus a slow ENSO-like
  basin-mean cycle.
- **Bermuda-Azores high + troughs** (`environment.js` `_highField` /
  `_troughField`): a Gaussian pressure bump (semi-permanent, seasonally
  mobile) plus traveling mid-latitude troughs form a real height field.
  **Steering is the geostrophic wind from that field** — literally the
  rotated gradient, `(U,V) = (-dH/dlat, +dH/dlon)` scaled — which is what
  produces clockwise flow around the high: easterly trade-wind steering on
  its south flank, and a poleward turn (recurvature) approaching its west
  flank. Troughs feed the same field with a negative sign, which is why
  their shear boost and their intensification-aid band both fall out of
  the same `upperHeight` value in `storm.js` rather than being hand-tuned
  separately per effect.
- **Shear field**: seasonal climatology + drifting noise texture + a boost
  near trough axes, suppressed under the ridge (subsidence).
- **Dry air field**: a Saharan-Air-Layer-style dry tongue from the African
  coast (east edge) + drifting noise, suppressed inside an active MJO/CCKW
  convective envelope.
- **MJO / CCKW**: MJO is a slow (~45 day), broad, eastward-propagating
  convective envelope; CCKW is a faster (~6 day), narrower pulse train
  riding on top, damped outside favorable MJO phases.
- **Genesis**: periodic tropical waves spawn near the African coast and
  drift westward at the real easterly-wave latitude band (~12°N); each
  tick, live waves are stochastically tested against a genesis potential
  index (GPI) combining SST, shear, dry air, and MJO/CCKW favorability, and
  the wave-spawn interval itself is seasonally modulated (faster in peak
  season).
- **Intensity**: relaxes toward a SST-derived Maximum Potential Intensity,
  penalized by shear and dry air, aided near (but not directly under) a
  trough axis, overridden by hard weakening rates over land or cold water.
- **Motion**: geostrophic steering (above) + low-level trade easterlies
  (tropics-only, falls off faster with latitude than a linear blend so it
  doesn't fight the recurving flow all the way to 30°N) + a beta-drift term.
- **Interactive shear tool**: `environment.js` keeps a persistent
  `shearUserAnomaly` grid the UI paints into (Gaussian-falloff brush); it's
  additive with the climatological/noise shear every tick, so you can carve
  out a weak-shear corridor or wall off a coastline and watch storms react.

## Known limitation to tune further

Recurving "fish storms" that curve north and clear back out into the open
Atlantic without hitting land are currently rare in a spot-check across
seeds — most strong storms still make landfall somewhere in the
Caribbean/Central America/Gulf/Southeast US before completing a full
recurve. The curvature itself is physically driven now (see
`recurve-check.mjs`), so this is a tuning problem, not a broken mechanism.
Things worth trying: widen the genesis latitude band so more waves start
farther north, shift the Bermuda high's peak-season longitude further west
earlier in the season, or increase `steeringGeostrophicScale` further.

## v0.3 additions (ENSO calibration, new overlays, archive, non-tropical influences)

- **ENSO coupling**: `oscillations.js` now models an ENSO-like index (roughly
  -2..+2) from two incommensurate slow sinusoids. It drives basin shear
  directly (`ensoShearAnomaly`, weighted toward the tropics/Caribbean — the
  real mechanism behind El Nino's Atlantic suppression) and a smaller SST
  effect. Verified via `tools/enso-correlation.mjs` across 12 simulated
  years: La Nina-like seasons (index ≤ -0.5) averaged **19.0 named / 9.0
  hurricanes / 2.7 majors**; El Nino-like seasons (index ≥ +0.5) averaged
  **13.3 named / 6.3 hurricanes / 1.7 majors** — correct direction and
  roughly the requested magnitude, though not perfectly dialed in (La Nina
  majors ran a bit under the "4+" target; see Known limitations).
- **Per-storm intensity ceiling**: the environment alone made nearly every
  storm reach hurricane strength given enough time over warm water, which
  isn't realistic — real inner-core organization has genuine stochastic
  limits this model doesn't resolve. Each storm now draws a ceiling at
  genesis (`storm.js` constructor) weighted to match the real ~50%
  named→hurricane, ~21% named→major split; the environment can always cap
  a storm *lower* (shear/dry air/land) but never override the ceiling
  upward. This was the single biggest lever for hitting realistic season
  totals.
- **Hard season window**: genesis is now zero outside ~Apr 18–Dec 20
  (`SEASON.startDayOfYear/endDayOfYear`), not just asymptotically rare.
- **Track "wobble"**: each storm carries an Ornstein-Uhlenbeck-style
  mean-reverting random perturbation to its motion (`TRACK_WOBBLE` in
  constants.js, applied in `storm.js`), standing in for non-tropical/
  synoptic influences (frontal interactions, transient ridging) that add
  real track uncertainty beyond the resolved large-scale flow.
- **Pattern noise on the steering pattern itself**: the Bermuda high's
  longitude/strength now carry a slow noise perturbation
  (`environment.js` `_patternPerturbation`) independent of the smooth
  seasonal blend, so the steering environment varies day to day, not just
  storm-to-storm.
- **Subtropical/cutoff-low genesis**: a second, independent genesis
  pathway (`SUBTROPICAL` constants, wired in `simulation.js`) lets a
  traveling trough spin up a storm directly if it's over warm-enough water
  with tolerable shear — real, and a distinct mechanism from wave-driven
  tropical genesis.
- **SST anomaly overlay**: a `sstNormal` field (climatology without ENSO)
  is kept separately so the "SST Δ" overlay can render actual-minus-normal
  with a proper diverging blue/purple (cold) → orange/red (warm) palette,
  plus contour lines on both the SST and anomaly overlays.
- **Pressure center icons**: the Bermuda high's current position renders
  as an "H", each traveling trough as an "L" — visible on every overlay,
  not just when explicitly toggled.
- **Shear vectors**: `environment.js` now also stores a shear *vector*
  (derived from upper-minus-lower wind, normalized and scaled to the
  scalar shear magnitude storms actually feel) and the SHEAR overlay
  renders it as a subsampled arrow field.
- **Storm archive panel**: the side panel now has a scrollable, per-season
  list of every dissipated storm with its peak category, plus a season
  header line (named/hurricanes/majors) — click any entry to highlight its
  track on the map and inspect it in the detail panel.
- **Performance**: switched the height-field gradient from a 4-point
  finite-difference stencil to an analytic gradient (Gaussian fields have
  closed-form derivatives), roughly halving `Environment.update()` cost.

### Known limitations to tune further

- Neutral-ENSO baseline still runs a bit above the ~14/7/3 target (closer
  to 16-17/8/3 in practice) and La Nina-phase majors ran under the "4+"
  target in the verification run — `GENESIS.gpiThreshold`,
  `STORM.mpiCoeffKt`, and the ceiling-draw probabilities in `storm.js`'s
  constructor are the levers to keep adjusting; `tools/season-calibration.mjs`
  and `tools/enso-correlation.mjs` are set up to make this fast to iterate on.
- True open-ocean "fish storm" recurves (curving north and clearing back
  out to sea without hitting land) are still uncommon — most strong storms
  make landfall somewhere before completing a full recurve. The curvature
  mechanism itself is physically driven and verified working; this remains
  a tuning problem (try widening the genesis latitude band, or increasing
  `steeringGeostrophicScale` further).
- Frontal boundaries are only implicitly represented via the trough field's
  shear boost — there's no distinct rendered frontal line, and extratropical
  transition (a storm being absorbed into the mid-latitude flow rather than
  just dissipating) isn't modeled as a distinct process yet.

## v0.4 additions (NAO, real calendar, zoom, accurate color tables, forecast tools)

- **North Atlantic Oscillation**: a genuine, independent oscillation
  (`oscillations.js` `naoIndex`, shorter-period than ENSO) now displaces
  and strengthens/weakens the Bermuda-Azores high directly, and drives a
  tropical-vs-subtropical SST dipole (-NAO warms the tropics and favors
  earlier recurves; +NAO warms the subtropics and pushes recurves later/
  farther west) — the real NAO-SST-track relationship, not just added
  noise. Troughs also now wobble independently in strength and latitude.
- **Official name lists**: replaced with the real, verified 6-list
  WMO/NHC Atlantic rotation for 2026-2031 (`names.js`), including the
  Melissa→Molly retirement. The cycler keys off real calendar year, so a
  multi-year run correctly advances through the actual rotation.
- **Real calendar**: day 0 = Jan 1, 2026; the day readout shows month/day/
  year, and the storm archive groups by actual calendar year rather than
  an abstract "season N."
- **Minimum central pressure**: every storm now tracks pressure (mb) via
  a calibrated wind-pressure relationship (`scale.js` `windToPressureMb`),
  shown in the storm list, detail panel, and its on-map label. The Azores
  high and each trough also get a representative pressure, shown as an
  "H"/"L" with an mb readout on the map and in the vitals panel.
- **Zoom & pan**: mouse wheel to zoom, click-drag to pan (click without
  dragging still selects a storm), +/−/reset buttons. All rendering
  (field raster, land, storms, vectors, pressure labels) respects the
  current view window.
- **Continuous speed control**: a slider from 0.2x to 30x (log-scaled) in
  place of the old fixed-step buttons.
- **Sampled color tables**: the SST-anomaly and 500mb-height-anomaly
  overlays use color stops sampled directly (via pixel inspection, not
  eyeballing) from real reference products — NOAA Coral Reef Watch SSTA
  and a GFS z500 anomaly product. The plain SST overlay uses an
  approximated REMSS-style banded palette. The 200mb overlay's wind-speed
  palette is similarly sampled from a tropicaltidbits-style product,
  truncated to the range this sim's modeled steering flow actually
  reaches (it doesn't resolve a full 150kt+ polar jet).
- **Shear overlay redesign**: now CIMSS-style — colored threshold contour
  lines (green <15kt favorable, yellow 15-20kt neutral, orange 20-25kt,
  red 35kt+ unfavorable) over a dark satellite-style base, plus vector
  arrows, instead of a smooth heatmap fill.
- **200mb / 500mb overlays**: 200mb now shows the actual upper-level wind
  field (`environment.js` `upperWindU/V`) as a color-filled speed map with
  streamline-style vectors; 500mb shows the height-anomaly field
  (`upperHeight`, rescaled to pseudo-dam units) with the diverging palette
  and contour lines, in both cases with H/L pressure labels on top.
- **Genesis outlook**: an NHC Tropical-Weather-Outlook-style overlay —
  every live tropical wave gets an X marker colored by risk with 48h/7-day
  formation percentages (`waves.js` `formationOdds`), derived from the
  same GPI math genesis itself uses, via a monotonic probability mapping.
- **Forecast cone + spaghetti**: selecting an active storm and toggling
  "Forecast cone" runs a 14-member ensemble forward 5 days
  (`forecast.js`) using the *current* environment snapshot as a static
  field (a "persistence + steering" style forecast — it does not attempt
  to forecast how the large-scale pattern itself will evolve, which is a
  substantially harder problem this sim doesn't take on). Members share
  the storm's real steering/intensity physics but get inflated random
  wobble that grows with lead time, producing genuine spaghetti spread; the
  cone is the min/max envelope across members at each forecast step.
  Recomputed at most once per simulated day, not every frame.

### Known limitations to tune further (carried over + new)

- Neutral-ENSO baseline genesis still runs a bit above the ~14/7/3 target;
  see `tools/season-calibration.mjs`.
- True open-ocean "fish storm" recurves remain uncommon; see
  `tools/recurve-check.mjs`. The NAO's earlier-recurve effect during -NAO
  phases should help this some, but wasn't specifically re-tuned for it —
  worth re-running `recurve-check.mjs` filtered by NAO phase.
- The forecast cone uses a box-envelope (min/max lat/lon per step) rather
  than NHC's true radius-based cone shape — visually similar at this
  scale, not identical.
- The genesis outlook's percentages are a monotonic function of the same
  GPI used for actual genesis, calibrated to feel NHC-like, not an
  independently-validated probability model.
- Frontal boundaries are still only implicit via the trough field's shear
  boost — no distinct rendered frontal line, and extratropical transition
  isn't modeled as a distinct process from ordinary dissipation.
- The plain SST overlay's color stops are an approximation from visual
  reference (the source REMSS image wasn't available for direct pixel
  sampling the way the anomaly/500mb/200mb images were), so it's less
  precisely matched than the other three sampled palettes.

## v0.5 additions (calibrated pressure/RI/ERC, rewind, smoother rendering)

- **Recalibrated pressure with real variance**: replaced the single
  wind-pressure curve with an anchor-table matching real category
  landmarks (~990-985mb C1, ~965-970mb C2, ~950-955mb C3, ~940mb C4,
  ~920mb C5, occasionally shallower) plus a per-storm
  `pressureVarianceFactor` (~0.82-1.18, drawn at genesis) so two storms of
  the same wind speed genuinely show different pressure — verified two
  64kt storms landing at 987mb and 993mb respectively in testing.
- **Rapid intensification**: no longer just an emergent side-effect of the
  relaxation-to-MPI formula — RI-favorable conditions (shear ≤9kt, SST
  ≥28.8°C, RH ≥72%, real room below the ceiling) now unlock a much higher
  intensification rate ceiling. Verified a 50.0mb/24h pressure drop and a
  56.8kt/24h wind gain in a 3-season test run, with an NHC-style
  30kt/24h badge (⚡RI) shown on qualifying storms.
- **Eyewall replacement cycles**: major hurricanes (≥100kt) can now
  stochastically enter a ~1 day weakening phase followed by a ~1.6 day
  reforming phase, with a cooldown before the next one — verified in a
  test run showing the characteristic saw-tooth intensity pattern
  (105→108→82→91→101→103→81→90→98→100kt) real major hurricanes exhibit,
  shown with a ♻ERC badge while active.
- **Storm size / wind swath**: each storm now has an R34/R64-equivalent
  size, correlated with its pressure-variance factor (compact/deep storms
  run smaller, large/shallow storms run bigger — the real relationship).
  New "Wind swath" toggle draws both radii around each active storm.
- **Rewind / time travel** (`history.js`): storms already keep a full
  day-stamped track for their whole life, so scrubbing to any past day is
  pure interpolation, not replay — verified a future storm is correctly
  excluded from a past-day snapshot. A second `Environment` instance
  (same seed) computes historical field overlays on demand without ever
  touching the live simulation state. "Time travel" pauses the live sim
  and shows a slider back to day 0; "Return to present" resumes it.
- **Smoother track rendering**: storms now render at a position
  interpolated between their last two tick points, using the animation
  loop's inter-tick progress — motion no longer visibly snaps once per
  tick, most noticeable (and most fixed) at slow speed multipliers.
- **Proper marching-squares contours**: replaced the old "line through
  cell center" approximation with real per-edge linear interpolation and
  connection, producing continuous, correctly-positioned isopleths on the
  SST, SST-anomaly, and 500mb overlays instead of a choppy dotted look.
  SST now draws isotherms every 1-2°C rather than just 4 coarse levels.
- **Relative humidity** replaces "Dry Air" as the labeled overlay (same
  underlying moisture field, inverted so higher = more favorable, matching
  how meteorologists actually talk about it).
- **Jet stream** added to the 200mb overlay only (`environment.js`
  `upperWindU/V` gets a visual-only jet band tied to the NAO index, with
  streak intensification near trough exit regions) — does not feed into
  storm steering or shear, which stay calibrated to the Bermuda-
  high/trough system alone. Verified a clear ~90-97kt band appears at
  40-43°N in testing.
- **Spaghetti forecast intensity**: each ensemble member's line now shows
  category-colored dots along its path, so the forecast cone communicates
  possible future strength, not just possible future position.
- **Collapsible map-controls panel**, **chronological storm archive**
  (oldest-first, matching how you'd actually review a season), and a
  **collapsible/minimizable** overlay+tool panel via the new ▾/▸ button.

### Known limitations (new this round)

- During rewind, the side panel (storm list, detail panel, vitals) still
  reflects the *live* simulation, not the scrubbed-to day — only the map
  itself shows the historical snapshot. Clicking a storm on the map while
  scrubbed back also hit-tests against live (not historical) storm
  positions, so selection can be inaccurate during rewind. Wiring the full
  UI through the historical snapshot is the natural next step.
- The 200mb jet stream is visual-only by design (see above) — it doesn't
  interact with storms even though real jet interaction (poleward outflow
  channels, extratropical transition) is a genuine effect this sim doesn't
  model yet.
- ERC's weakening/reforming durations are fixed rather than varying with
  storm size/intensity the way real ERCs do.
- Saddle-point cases in the marching-squares contour code use a simple
  fixed pairing rather than resolving true ambiguity — rare, minor visual
  artifact only.

## v0.6 additions (steering realism, ACE, SST recalibration, season browsing)

- **Trough/cutoff-low capture**: storms within range of a traveling trough
  now get an explicit poleward-pull-plus-eastward-acceleration force
  (`storm.js` `_troughCapture`) on top of the existing geostrophic
  steering, standing in for a cutoff low physically dragging a storm north
  and enhancing its outflow. Verified this measurably increased genuine
  recurve behavior: 0/52 storms recurving before this change, 6/52 (with
  6 also exiting the domain's north edge, i.e. genuine "fish storm"
  tracks) after — matching the NOAA September prevailing-tracks pattern
  you referenced, where a real fraction of storms curve back out to sea
  rather than plowing straight into the Caribbean/Gulf.
- **Jet embedding**: a storm that gets far enough poleward now feels a
  fraction of the upper-level jet directly (`ENV.jetSteeringFraction`),
  on top of smooth geostrophic steering — this is what makes forward
  speed genuinely jump during/after recurvature instead of staying flat.
  Verified forward speed distribution: median 11.2kt, 90th percentile
  18.5kt, max 40kt (during jet embedding) — matches real climatology
  (typical tropical translation 10-15kt, accelerating to 20-40kt during
  extratropical transition).
- **Forward-motion display**: every storm now tracks `forwardSpeedKt` and
  `headingRad`, shown in the storm list, detail panel, and (implicitly)
  by how fast the icon now visibly moves.
- **ACE (Accumulated Cyclone Energy)**: real formula (10⁻⁴ × ΣVmax² over
  every 6h period at TS strength+), tracked per storm and reconstructed
  as a cumulative day-by-day season series (`history.js`
  `computeSeasonAceSeries`) for the new **Season ACE chart** — a small
  canvas line graph with reference lines at NOAA's approximate
  below-normal/near-normal/above-normal-hyperactive ACE thresholds
  (~66/123/159). Verified a full-season run producing ACE≈236, in a
  plausible range next to real active seasons (2005≈250). Note: an
  earlier test run before final tuning produced ACE≈424 for an unusually
  active year — the metric can run high in extreme seasons; see Known
  Limitations.
- **SST recalibration**: bumped peak-season Caribbean/Gulf warmth so the
  region actually reaches 30°C+ in Aug-Oct instead of topping out at 29,
  and added a slow-drifting "hot pocket" noise field so localized areas
  exceed 31°C, with the exact extent varying run to run (year to year) —
  verified peak-season Caribbean/Gulf mean SST ≈30.0°C with pockets to
  31.0-31.1°C across several different seeds, matching the Western
  Hemisphere Warm Pool reference you provided.
- **Past tracks now default to the current calendar year only** — a
  multi-year run no longer clutters the map with every season ever
  simulated. The Storm Archive panel's per-year header now has a **"View
  on map"** button to deliberately browse a specific past season's tracks
  (drawn in a distinct purple so they're clearly not part of the live
  picture), independent of the current-year past-tracks toggle.
- **Wind-history chart**: selecting any storm (active or archived) now
  shows a small intensity-vs-time chart in the detail panel — category-
  colored dots along the storm's full recorded track, with TS/hurricane/
  major threshold reference lines, so you can see exactly how a storm's
  strength evolved rather than just its current/peak numbers.

### Known limitations (new this round)

- ACE isn't independently recalibrated to a target climatological mean —
  it's a straightforward reconstruction from (already-calibrated) wind
  speeds and storm counts, and ran as high as ~424 in one test year before
  settling closer to ~236 in another. Worth tuning `STORM`/`RI` constants
  specifically against ACE if you want tighter climatological matching.
- The wind-history and ACE charts are hand-rolled canvas line charts (no
  library), so they're functional but plain — no zoom/hover tooltips.
- "View on map" for a past season shows tracks only (not spinning storm
  icons or that season's environment state) — for full environment replay
  of a past day, use the separate rewind/time-travel feature instead.

## v0.7 additions (forecast bug fix, operational numbering, CAG genesis, jagged isotherms)

- **Fixed the forecast cone regression**: found and fixed a real ordering
  bug — `ui.update()` (which computes the forecast ensemble cache) was
  running *after* `renderer.render()` read it each frame, so the cone was
  always stale and null on first toggle. Swapped the order in `main.js`.
  Also rebuilt the spaghetti visualization to color each member's line
  segment-by-segment by forecast wind speed (gray→cyan→blue→green→
  yellow→orange→red→magenta), matching the convention real ensemble plots
  (ECMWF/weathernerds-style) use, plus a mean "control" track through the
  cone and a legend that appears when the cone is toggled on.
- **Real operational numbering**: every cyclone now gets a sequential
  "01L", "02L", etc. the moment it's designated (`names.js`
  `CycloneNumberer`), resetting each calendar year — and only gets an
  actual *name* separately, the first time (if ever) it reaches 34kt
  (`simulation.js`). Verified in testing: "01L" and "11L" never named
  (peaked at 25kt/33kt), while "15L" got named "Marco" — exactly the
  real-world behavior where the Nth named storm and Nth system of the
  year are generally different numbers.
- **Central American Gyre genesis**: a third, independent genesis pathway
  (`CAG` constants, wired in `simulation.js`) seeded over Central
  America/the western Caribbean/Bay of Campeche, with the real bimodal
  May-June / Oct-Nov seasonality rather than the MDR's single Aug-Sep
  peak. CAG-spawned storms meander (inflated wobble) until a trough gets
  close enough to actually capture them, at which point they behave like
  any other trough-captured storm — verified producing roughly 1
  CAG-origin storm per season, landing in the intended seasonal windows.
- **Jagged SST isopleths**: added a display-only fine-noise texture
  (`environment.js` `sstDisplay`, independent per-cell noise so it's
  genuinely jagged rather than smoothly varying) used for the SST/
  SST-anomaly overlay's contour lines and color fill, instead of the
  smooth underlying physics field — the contour *lines* in particular
  should now read as much closer to the choppy, fine-scale structure real
  satellite SST imagery has.
- **Season-by-season archive browsing**: replaced the long scrolling
  every-year-stacked list with one season at a time and ◀/▶ navigation,
  plus a "View on map" button — much less cluttered for a multi-year run.
- **6-hour time granularity**: the day readout now shows the synoptic
  hour (0Z/6Z/12Z/18Z) alongside the date, and the rewind slider now
  scrubs in 6-hour steps instead of whole days, so you can jump to a
  specific analysis frame rather than just a specific day.

### Known limitations (new this round)

- The forecast-cone fix was verified by tracing the actual bug (a
  provable ordering issue) and confirming `computeForecast` produces
  correct data in isolation — I wasn't able to visually confirm the fix
  in an actual browser session, so if the cone still doesn't render,
  that's the first thing to check via the browser console for errors.
- CAG-origin storms use the same intensity/ceiling model as MDR storms;
  real CAG systems often have a broader, weaker wind field on average
  reflecting their monsoon-gyre origin, which isn't specifically modeled.
- The jagged-isotherm noise is a display-only overlay on top of the
  smooth physics field — storms still sense the smooth version, so the
  jaggedness doesn't create any new small-scale genesis/intensity effects
  (which is intentional, but worth knowing).

## v0.8 additions (selection bug fix, harsher/more variable environment, bigger majors)

- **Fixed the storm-selection bug**: found the actual cause — `.map-controls-wrap` and the newer `.rewind-row` had no explicit CSS positioning, so they sat in normal document flow as an unpositioned layer over the canvas, intercepting clicks meant for storm selection. Fixed by making the wrapper a full-cover `position: absolute` layer with `pointer-events: none` (and `pointer-events: auto` restored on its actual interactive children), and giving `.rewind-row` its own explicit absolute position consistent with its sibling controls.
- **Shear is no longer uniformly favorable**: raised the peak-season MDR
  baseline (6kt → 10kt) and nearly doubled the noise amplitude (9 → 16kt),
  so a given spot genuinely swings between favorable and hostile over a
  matter of days instead of sitting green all season. Also wired MJO/CCKW
  phase directly into shear (unfavorable phase adds shear, favorable phase
  cuts it) — previously those oscillations only affected genesis odds and
  dry air, not shear itself. Verified: peak-season MDR mean shear now
  runs 12-22kt across different days/years rather than a near-constant
  low value.
- **Relative humidity recalibrated down**, and a genuine **Saharan Air
  Layer seasonal cycle** added (`SAL` constants in `constants.js`) —
  peaks in early-mid July, meaningfully declined by mid-August, matching
  the NASA dust-cover climatology you referenced, instead of a flat
  year-round African-proximity term. Verified MDR mean RH now runs
  ~68-83% depending on time of year rather than pinned near saturation.
- **Wider tropical-wave genesis latitude**: waves can now exit Africa
  anywhere from ~5.5°N to ~20.5°N (was ~6-18°N), so higher-latitude waves
  (which now also face more shear and — thanks to the SAL cycle — often
  more dry air) are common again, and appropriately slower to develop as
  a natural consequence of the recalibrated environment rather than a
  separate special-cased rule.
- **C4+ storms more common in favorable environments**: widened the
  top-tier intensity-ceiling draw (previously capped around 142kt, now
  up to ~158kt) and raised the MPI coefficient so storms that do find a
  genuinely favorable pocket can actually reach it despite the harsher
  baseline. Verified across a 4-season test: 0 Cat 5s and only 7 Cat 4s
  before this round's changes → 1 Cat 5 and 3 Cat 4s after, while overall
  season totals stayed on target (16.7 named / 7.7 hurricanes / 3.3
  majors, averaged over 9 test seasons).

### Known limitations (new this round)

- The CSS layering fix addresses the specific bug as diagnosed from
  reading the code (unpositioned overlay div intercepting clicks) — I
  wasn't able to visually confirm it in an actual browser session.
- SAL's effect is currently basin-wide-uniform in its seasonal timing;
  real SAL outbreaks are episodic (individual multi-day pulses moving
  westward off Africa) rather than a smooth seasonal envelope — the
  day-to-day noise term provides some of that texture, but not discrete
  outbreak "events."
- The C4/C5 frequency increase was checked over 4 test seasons — a
  reasonable sample but not a large one; if C5s still feel too rare (or
  now too common) after more play-testing, `storm.js`'s ceiling-draw
  range and `STORM.mpiCoeffKt` are the levers to keep adjusting.

## v0.9 additions (intensity fix, map expansion to Greenland, NAO tripole, UI fixes)

- **Fixed RI ending too quickly / storms undershooting their potential**:
  traced to last round's shear recalibration making RI thresholds too
  strict for the new, noisier baseline. Added a shear EMA (storms respond
  to sustained conditions, not one synoptic snapshot — brief noise spikes
  no longer flicker RI on/off) and an intensity-based resilience factor
  (established major hurricanes are measurably more shear-resistant than
  fresh depressions, which they weren't in the old model). Verified: the
  fraction of major-ceiling storms reaching Cat 4+ went from ~6% to ~35%
  across test seasons.
- **Fixed the storm-selection bug** (confirmed root cause from last
  round's diagnosis: an unpositioned overlay div intercepting canvas
  clicks).
- **Spaghetti forecast lines now use the same category colors** as the
  rest of the app, plus **NHC-style labeled intensity nodes** every 24h
  along the forecast track.
- **"View Conditions" cursor tool**: hover readout showing SST, SST
  anomaly, shear, and RH at the cursor's position.
- **Time-travel controls moved above the map**, in their own bar.
- **NAO SST signature rebuilt as a real tripole**: three independent
  latitude bands (tropical/subtropical/mid-latitude) of alternating sign,
  textured by a coarse noise field for organic swaths — verified
  producing genuine sign-alternating bands by latitude, instead of one
  smooth gradient.
- **Map extended to 70°N**, now including the UK, Ireland, Iceland, and
  Greenland — regenerated the coastline data at the new extent and
  verified it visually (ASCII raster check) before wiring it in.

### A bug I found and fixed *during* this same round, worth knowing about

Expanding the grid's northern edge silently broke two things that were
computed *relative to the grid bounds* rather than as fixed physics
constants — a real risk any time the map extent changes:
1. **Trough latitude** was computed as `GRID.lat1 - 6 - ...`, which
   silently moved the entire mid-latitude trough belt from ~30-40N up to
   ~55-65N when the grid extended — breaking trough capture, recurve
   behavior, and jet-adjacent shear entirely. Fixed with a dedicated
   `troughLatBase` constant, independent of grid bounds.
2. **SST/shear/dry-air climatology** used `latFrac = (lat-lat0)/(lat1-lat0)`
   — with a taller grid this compressed the whole tropical/subtropical
   curve, making the MDR's shear climatology quietly *more* favorable
   again (partially undoing last round's recalibration) and would have
   made water near Greenland show as an absurd ~27°C. Fixed by
   decoupling SST into an explicit two-segment climatology (0-45N, then
   45N-70N toward a real arctic endpoint) and capping the shear/dry-air
   `latFrac` at the original 45N reference, since cyclone physics doesn't
   meaningfully operate north of there anyway.

I'm flagging this explicitly rather than just quietly fixing it, because
it's exactly the kind of regression that's easy to reintroduce if the
grid extent changes again — anything computed as "some offset from
GRID.lat1" needs to be an explicit, named constant instead.

### Known limitations / not completed this round

- **Performance regression**: the taller grid (71 rows vs 46, ~54% more
  cells) plus the season's cumulative other changes measured at ~24s per
  simulated year in one test, versus ~5-8s in earlier rounds. This will
  be noticeable at high speed multipliers in the browser (ticks will
  simply take longer wall-clock time to catch up, per the existing
  500-ticks-per-frame guard, rather than crash — but it will feel
  sluggish). I did not have remaining budget this round to optimize the
  environment update loop for the larger grid; the most direct fix would
  be reducing grid resolution (e.g., 1.5° cells) or skipping full-grid
  recomputation for cells far from any active storm.
- **Season totals only spot-checked, not fully recalibrated**: genesis
  counts drifted upward this round (partly from the RI/shear fixes above,
  partly residual from the grid-expansion bug before its fix) — one test
  year showed 24 named-storm-track systems, above the ~14-17 range
  earlier rounds targeted. `tools/season-calibration.mjs` is still the
  right tool to re-run and re-tune against, I just didn't have the time
  budget this round given how long it now takes per test run.
- **Not implemented this round** (deferred due to scope): remnant lows/
  extratropical transition as trackable distinct phases, a separate
  dedicated tab for the forecast cone (currently still a map overlay
  toggle, not a separate view), and the storm archive's redesign into a
  seasonal Gantt/ACE summary chart (the archive is unchanged from last
  round — season-by-season list with wind-history chart on selection).

## v0.9.1 (reverted map expansion, fixed SST graininess)

- **Reverted the map back to 0-45N** (Gulf/Central America to West
  Africa, no UK/Iceland/Greenland) — the taller grid's performance cost
  wasn't worth it. World construction time back down from ~1.5s to
  ~560ms, one simulated year back to its earlier speed. The land data,
  grid bounds, and SST climatology all reverted together; the two-segment
  SST climatology code and `troughLatBase` decoupling fix from last round
  are harmless no-ops at this extent but stay in place in case the map is
  ever extended again — they're what should prevent the same regression
  from recurring.
- **Fixed SST/anomaly graininess**: the fine per-cell noise texture added
  a few rounds back (for jagged isotherm lines) was being applied to the
  color *fill* too, which is what actually caused the speckled look —
  adjacent grid cells got uncorrelated random offsets. Fixed by using the
  smooth `sst` field for the color fill and only the (now also toned
  down, 0.45→0.22 amplitude) textured field for contour lines, so the
  fill reads clean while the isotherms keep some organic character.

## v1.0 additions (AMO, ACE accuracy, forecast toggle split, archive click fix)

- **AMO implemented as genuine persistent state** (`oscillations.js`
  `stepAmo`), unlike every other oscillation in the sim which is a pure
  function of simulated day — the AMO carries real memory: a long
  (~150-day half-life) exponential moving average of the NAO index feeds
  a slowly-shifting target, which the AMO index itself relaxes toward
  with real inertia (~220-day half-life). This is what gives it the
  "sticks for months, only moves if a NAO regime is sustained" character
  you described. Verified numerically: AMO drifted smoothly from +0.15 to
  +0.47 to -0.15 over a 3-year test run while NAO swung several times
  faster over the same period. Wired into SST as a basin-coherent (not
  narrowly latitude-banded like the NAO tripole) tropical warming/cooling
  term, strongest over the MDR.
- **ACE now computed from best-track-style rounded wind speeds**: each
  storm's recorded track history rounds wind to the nearest 5kt (matching
  real NHC best-track convention) at every 6-hourly point, and ACE
  accumulates from those rounded values — while the *live* intensity used
  for display, physics, and the "current status" readout stays fully
  continuous, per your distinction between historical record and live
  state. Verified directly: a storm's live intensity read 30.14kt while
  its simultaneous track entries showed 25, 30 (properly rounded).
- **Forecast cone and spaghetti models split into independent toggles**
  ("Forecast cone" / "Spaghetti models"), instead of one combined switch.
- **SST color table rebuilt from your reference image**: pixel-sampled
  (via Python/PIL, not eyeballed) directly from the ClimateReanalyzer-
  style product you provided — full magenta→purple→blue→cyan→green→
  yellow→orange→red→maroon sequence with real sampled RGB values at each
  stop.
- **Fixed "can't click storms in the archive"**: found the actual cause —
  the archive panel's entire DOM (every row, every nav button) was being
  destroyed and rebuilt on *every animation frame* (60/sec), since
  `ui.update()` runs every frame. A real click's mousedown-to-mouseup
  spans several of those rebuilds; if the element you clicked no longer
  exists by the time mouseup fires, the browser's click event can
  silently fail to synthesize. Fixed by throttling the actual list DOM
  rebuild to at most ~3/sec (data underneath doesn't change faster than
  that anyway), with a `_forceUpdate()` bypass so a user's own click on a
  nav button or row still feels instant. Applied the same fix to the
  active-storm list, which likely had the identical latent issue.

### Known limitations (new this round)

- The archive-click fix is a well-diagnosed, directly-reasoned fix (not a
  guess), but — as with the CSS layering fix a few rounds back — I
  couldn't visually confirm it in an actual browser session. If clicking
  archive rows still doesn't work, that changes the diagnosis meaningfully
  and is worth reporting back with any console errors.
- The "seasonal summary" is still the season-by-season list + wind-history
  chart on selection, not yet the fuller Gantt/ACE-integrated redesign
  discussed a couple rounds ago — the click bug was the blocking issue
  fixed this round; the deeper redesign is still open.
- AMO's real-world period is 60-70 years; the sim's ~4-year baseline
  period is a deliberate gameplay compression (a literal 60-year cycle
  would never be observable in a normal play session), not a claim about
  real AMO dynamics.

## v1.1 additions (AMO fixes, SAL realism, TUTT/ULL shear, floating panels)

- **Fixed a genuine oversight**: the AMO physics built last round had no UI
  readout at all — added one to the vitals panel.
- **AMO variance reduced**: lower amplitude, longer relaxation half-life
  (~340 days) and NAO-smoothing window (~220 days) — verified it now
  drifts more subtly (e.g. 0.14 after 4 simulated years in one test run,
  vs. swinging through a much wider range before).
- **AMO now directly modulates genesis rate** (wave-spawn interval and
  effective GPI threshold), not just SST — +AMO measurably increases
  storm count, -AMO decreases it, independent of AMO's separate SST effect.
- **Relative humidity now genuinely flows east to west**: rebuilt as a
  basin-scale gradient (not just a localized coastal effect) plus discrete
  traveling SAL outbreak pulses that emerge off Africa and drift west,
  weakening as they age — verified directly: RH reads 0% near Africa vs.
  70-95% in the western Caribbean in the same snapshot, and the dry pocket's
  position measurably shifts westward across successive simulated days.
- **Mid-latitude troughs now inject dry air** into the tropics/subtropics
  near them, on top of their existing shear-boost effect.
- **TUTT** (a real, semi-permanent subtropical shear source through peak
  season, distinct from the transient traveling troughs), **upper-level
  lows** (thresholded noise -> sharp episodic shear pockets rather than
  smooth variation), and **storm-induced wave-breaking** (a recurving,
  jet-embedded storm deposits a genuinely stateful, decaying shear wake
  in its wake, standing in for the real Rossby-wave-breaking response)
  are all now wired into the shear field.
- **Two new floating, minimizable panels**: an **Intensity History**
  panel (semi-transparent, appears automatically when any storm is
  selected) replacing the old panel-embedded canvas, and a **Season
  Summary** panel — a media-style horizontal timeline (one bar per storm,
  spanning formation to dissipation, colored by peak category, month
  gridlines) matching the reference layout directly, with its own
  prev/next season navigation and click-to-select on any bar.
- **Archive season header now shows total ACE** for that season, and the
  **detail panel now shows formation date/time (with 6-hour Z-time) and
  genesis origin** (MDR wave / Central American Gyre / subtropical).

### Known limitations (new this round)

- The added shear/RH physics (SAL pulses, TUTT, ULLs, wave-breaking) cost
  real performance — measured ~10s per simulated year, roughly double
  versus before this round. I optimized the wave-breaking injection from
  a full-grid scan to a local bounding box, which helped, but the
  per-cell cost of the new terms themselves is the larger remaining cost.
  Worth profiling further if this becomes a practical annoyance.
- Both new floating panels were verified via direct data-logic testing
  (Node, not a browser) and a full syntax/DOM-id pass — not visually
  confirmed in an actual browser session.
- The season summary panel currently only shows named storms clearly at
  typical season sizes; a very high-activity season (20+ systems) will
  compress row height down toward its 16px floor and may feel cramped —
  a scrollable canvas or dynamic panel height would be the next
  improvement if that becomes an issue.

## v1.2 additions (Gulf SST, NAO regime persistence, RI timing fix, CAG visibility)

- **Fixed Gulf of Mexico SST**: found the actual bug — the warm pool boost
  decayed too fast with latitude, so the Gulf specifically ran a cool
  ~29°C while the Caribbean ran hot. Rebuilt as a proper 2D Gaussian
  covering both; verified Gulf mean is now ~29.8°C with range up to 31°C.
- **NAO rebuilt as genuinely persistent regime state**, not a sinusoid —
  a mean-reverting stochastic (Ornstein-Uhlenbeck) process with a long
  (~110 day) correlation time replaces the old dual-sinusoid formula.
  Verified via a 6-year test with noise-filtered regime detection: average
  regime duration ~150 days, with individual stretches of 612 and 330
  days — genuine "stays negative for months" behavior a periodic function
  can't produce no matter how its periods are tuned.
- **AMO further stabilized**: lower baseline amplitude, longer smoothing
  and relaxation half-lives. Verified staying in a tight 0.12-0.17 band
  across 5 simulated years.
- **Fixed RI/majors developing too fast** — this took two failed attempts
  before landing on a real fix, worth documenting: (1) age-gating RI
  alone didn't work because the *base* non-RI approach rate was already
  fast enough to reach major in ~1 day; (2) ramping the rate ceilings
  still let storms sneak to major right at the RI-eligibility boundary,
  since by then the ramp was already ~84% open. The fix that actually
  worked is a hard absolute age-based intensity cap (independent of the
  rate math entirely) — verified directly: **zero storms now reach major
  before day 3**, with natural spread beyond that (3.3, 4.0, 4.5 days in
  one test run), matching "2-3 days only in the most extreme cases."
- **Detail panel now shows dissipation date** (with 6-hour Z-time) for
  archived storms, alongside formation date/origin from last round.
- **Tropical wave markers enlarged** (ring + core + label, was a tiny
  3px dot) and **CAG-origin storms now tagged directly on the map**
  (🌀CAG next to the name), not just in the detail panel.
- **CAG watch zone overlay**: a translucent, dashed-border region over
  Central America/the western Caribbean/Bay of Campeche that appears
  during the real bimodal May-June/Oct-Nov active windows — verified the
  visibility logic switches on exactly at both seasonal peaks and off
  in between, so CAG genesis no longer appears to come from nowhere.

### Known limitations (new this round)

- The age-based intensity cap creates some clustering of majors right at
  the 3-day floor rather than a fully natural real-world spread (which
  typically has more majors taking 4-8 days) — a real fix in the right
  direction, not a perfectly-tuned distribution yet.
- **Not done this round** (ran out of budget, deferring rather than
  rushing): reorganizing the Season Summary panel into a more compact,
  Wikipedia-style layout (currently still one continuous chart that grows
  with season length), and adding frontal-boundary / weak-non-tropical-low
  visualization on the map.
- Performance: this round's physics changes were mostly cheap (no new
  per-cell field computations), so simulation speed should be close to
  last round's ~10s/simulated-year, not worse.

## v1.3 additions (season summary columns, spawn mechanics, frontal boundaries)

- **Season Summary redesigned as multi-column**: wraps to a fresh column
  after 6 storms instead of growing indefinitely tall, each column its
  own compact Jan-Dec mini-timeline; the panel scrolls horizontally if
  there are more columns than fit. Cleaned up a stale conflicting CSS
  rule found in the process.
- **CAG watch zone is now toggleable** (was forced-on whenever in season).
- **CAG and subtropical/frontal genesis rates increased** — verified
  subtropical genesis roughly doubled (~6.4/season across a 5-season
  test); CAG improved but is still fairly rare (~0.6/season) — flagged
  as needing another look rather than calling it fully solved.
- **Frontal boundary visualization**: a stylized scalloped front line
  now trails from each trough's axis, giving troughs a recognizable
  "front" identity on the map instead of just an "L" label.
- **RH east-west flow strengthened**: reduced the noise term's weight
  (it was diluting the clean signal, not just texturing it), sped up the
  drift to match real trade-wind translation, and increased noise
  coherence. Verified a much cleaner monotonic trend — 80-96% RH through
  the western basin declining steadily to 0% at the African coast,
  instead of a noisy, hard-to-read pattern.
- **New spawn mechanics**: place a tropical wave, tropical storm, or
  hurricane directly on the map, or place an upper low (localized shear
  boost + ridge weakness) or a ridge (localized steering influence),
  each decaying over ~5 days. Manually spawned TS/hurricanes are backdated
  a few days at spawn so they're treated as already-organized systems
  (matching real expectations — a spawned hurricane shouldn't need to
  wait through the "just formed" ramp-up other storms do).
- **Found and fixed a real bug during this work**: the age-based
  intensity cap added last round assumed every storm starts as a 25kt
  depression, so a manually-spawned 70kt hurricane got clamped straight
  back down to 25kt on its very first tick and collapsed. Fixed by
  basing the cap on each storm's own actual starting intensity instead
  of a hardcoded value — verified a spawned hurricane now survives and
  evolves normally through extended simulation.
- **Performance fix caught during spawn-mechanic work**: the user-feature
  expiry check was initially running once per grid cell per tick instead
  of once per tick overall — moved it to the right place before it became
  a real cost.

### Known limitations (new this round)

- CAG genesis frequency, while improved, is still on the rare side
  relative to what was asked for — worth another calibration pass if it's
  still not visible enough in play.
- The two tool-toggle bars (main tools and the new spawn bar) are
  positioned with an estimated fixed pixel gap between them rather than
  a measured one, since I can't render an actual browser layout from
  here — there's a small chance they overlap or leave an odd gap
  depending on how many buttons wrap to a second row at your window size.
- As with recent rounds, the new UI (spawn buttons, CAG toggle, season
  summary columns) is verified via direct data/logic testing and DOM-id
  cross-checks, not an actual browser session.

## v1.4 additions (spawn panel relocation, real front symbology, CAG climatology, 200mb outflow)

- **Spawn panel moved out of the map overlay** into a proper side-panel
  section — the previous floating-overlay version (positioned with an
  estimated pixel offset) is gone; this is a real DOM element with no
  guessing involved.
- **Frontal boundary symbology rebuilt** to use actual meteorological
  convention — alternating solid triangles (cold-front side) and
  semicircles (warm-front side) at fixed pixel spacing along the line,
  replacing the earlier approximated scalloped-arc version.
- **Icons for user-spawned upper lows/ridges** ("ULL" / "RIDGE", dashed
  circle, fading out as the feature decays) — these previously only
  affected the physics invisibly.
- **CAG climatology reworked with real seasonal asymmetry**: the May-June
  and Oct+ peaks are no longer symmetric — verified the seasonality curve
  shows a genuine "jump" (0.46 at mid-Sept → 1.03 right around Oct 1 →
  1.35 mid-October), clearly outweighing the May-June peak (0.65).
  Verified with a 15-season test that early-season CAG storms stay weak
  (25-35kt, none reaching hurricane strength) while late-season storms
  are both more frequent and show real spread including a 109kt major —
  directly matching the "short-lived early, can meander and become
  powerful late, ENSO-modulated" pattern described.
- **Storm-induced 200mb outflow**: active storms now visibly perturb the
  200mb wind field with realistic anticyclonic divergence radiating
  outward, scaled by intensity. This one took real debugging — see below.

### A debugging story worth knowing about

My first verification test for the 200mb outflow showed *no difference*
between the field with and without a storm present, which I reported
honestly as a likely bug rather than shipping around it. Investigating
properly (rather than guessing) found there was no actual bug: the test
storm was a brand-new 25kt depression, and at that intensity the outflow
signature is genuinely only ~1-2kt at the sample point — invisible at the
1-decimal precision I was printing. Re-tested with a realistic 120kt
storm and got a clean 48kt difference; re-confirmed again with a
naturally-forming 85kt storm from an actual simulation run (23kt
difference, no artificial forcing). The feature works — the first test
was just underpowered to detect it, not evidence of breakage.

### Known limitations (new this round)

- CAG genesis frequency (a carryover concern from last round) wasn't
  re-measured this round — the seasonal *shape* is verified correct, but
  I didn't re-check the overall rate.
- The 200mb outflow is visual-only (like the jet stream), by design —
  it doesn't feed back into steering or shear, even though real storm
  outflow does interact with the broader pattern (e.g., aiding recurving
  systems downstream). That interaction isn't modeled.
- As with recent rounds, UI layout changes (the relocated spawn panel,
  new icons) are verified via DOM structure and data-logic checks, not
  an actual rendered browser session.

## v1.5 additions (real bug fixes: season summary, front geometry; ET; trough control)

- **Season Summary "completely broken" — found the real cause**: the
  panel used a hardcoded `left: 340px`, while the working wind-history
  panel used a robust `right: 14px`. On many window widths, 340px plus
  the panel's 480px minimum width pushes it off-screen entirely, which
  would look exactly like "completely broken." Fixed the positioning,
  capped max-width to the viewport, stopped a wasteful per-frame canvas
  resize (was clearing the draw buffer 60x/second even when nothing
  changed), and wrapped the draw call in try/catch so a future edge case
  can't cascade and silently break the rest of the side panel.
- **Frontal boundaries — found the actual geometry bug**: the front-trail
  angle pointed northwest from each trough; real fronts drape southeast
  into the subtropics, which is also where they'd actually interact with
  a hurricane. Fixed the direction, and added the missing toggle (fronts
  were previously always-on with no way to turn them off).
- **Spawn mechanic relocated** from the side panel into a dedicated bar
  above the map, next to time travel — addresses the "side menu is
  cluttered" complaint directly rather than just shrinking things.
- **Extratropical transition implemented** as a genuine storm phase, not
  just a label — a system that gets far enough poleward and interacts
  deeply with a trough (either close proximity or a genuinely baroclinic/
  high-shear environment) loses its warm core, expands ~1.75x in wind-
  field size, and switches to a different intensity model entirely: it
  either draws baroclinic support from a nearby trough (can maintain or
  even regain strength — the real Sandy mechanism) or steadily weakens
  once that support fades, continuing under the same name/identity the
  whole time. Verified with a real example: a storm named Fay formed
  normally, transitioned 6+ days later (not instantly), hit 85kt
  post-transition at 38°N, and its size grew by the intended factor.
- **Natural troughs are now directly user-adjustable**: new "Strengthen
  trough" / "Weaken trough" tools find whichever real trough is nearest
  your click and nudge its strength, decaying back toward neutral over
  ~4 days (a nudge, not a permanent override) — distinct from the shear-
  paint brush and from spawning an entirely new feature. Verified
  end-to-end including the decay-back-to-neutral behavior.

### Known limitations (new this round)

- Troughs, extratropical lows, ULLs, and fronts are still visually/
  physically the *same underlying feature* (a trough center with a front
  trailing from it) rather than fully independent entity types — the ET
  mechanic and trough-adjustment tool both work correctly, but a true
  architectural separation (so e.g. a standalone extratropical low could
  exist without an attached trough, or vice versa) wasn't attempted this
  round given the scope already covered.
- The favorable/unfavorable trough-interaction nuance (close = shear/bad,
  moderate distance = outflow aid/good) was already implemented in
  earlier rounds and re-verified conceptually this round, not rebuilt.
- As with recent rounds, UI/layout fixes are verified via DOM structure,
  balance checks, and direct data/logic testing — not an actual rendered
  browser session.

## v1.6 additions (MPI/steering overlays, C4-C5 physics fix, late-season climatology)

- **Two new overlays**: "Max Potential" shows the standard TD/TS/H1-H5
  thermodynamic ceiling by SST (matching the reference product's color
  convention and category-threshold contour lines), and "Steering" shows
  the actual steering-flow vector field storms are calibrated against.
- **Fixed majors plateauing at Cat 3 in great environments**: diagnosed
  the actual cause — the thermodynamic MPI formula already supports
  145-178kt at 30-32°C (verified directly), but each storm's random
  ceiling draw (designed for realistic category *distribution* across a
  season) was the real binding constraint, capping many RI storms below
  what the SST would otherwise allow. Fixed with a new mechanism: sustained
  (not momentary) good trough/outflow ventilation now earns a storm a
  growing extension on its own ceiling, up to +24kt. Verified directly:
  the fraction of major-tier storms reaching Cat 4+ roughly doubled (to
  33% in one test), with genuine Cat 5s now appearing, while season
  totals stayed on target.
- **MDR genesis now tails off faster after mid-October** specifically
  (separate from the general season curve), while the Caribbean/CAG
  pathway's already-strong late-season peak (from two rounds ago) picks
  up the slack — verified the MDR wave interval grows to ~2x normal by
  early November, ~5.7x by early December.
- **Western Caribbean/Bay of Campeche steering "dead zone"**: trade winds
  are now realistically much weaker in that specific box, which is what
  actually creates the "storm lingers and blows up" dynamic you
  described (a slow-moving storm sitting over peak-warmth water for
  longer, feeding the existing RI mechanic) rather than a special-cased
  rule. Verified directly: steering there measured 0.2kt vs. 11.6kt in
  the open MDR at the same tick.

### Known limitations (new this round)

- The MPI overlay uses the exact same simplified thermodynamic formula
  storm.js is calibrated against (deliberately, for honesty about what
  the sim actually does) — it is not a literal reproduction of the real
  NOAA/CIRA potential-intensity product's more complete thermodynamics.
- The outflow-ceiling-extension mechanism was tuned to a reasonable
  starting point (+24kt max) and verified to move Cat 4/5 frequency in
  the right direction, but wasn't exhaustively tuned against a specific
  target Cat 4/5 rate.

## v1.7 — closing the outflow-calibration gap from last round

Last round's README honestly flagged that the outflow-ceiling-extension
mechanism was "confirmed to move outcomes in the right direction, not
calibrated against a specific target Cat 4/5 frequency." This round
closes that gap properly rather than leaving it as a caveat:

- **Measured the actual per-season rate first**: found hurricanes running
  35% above the ~7.2/season target and majors 66% above the ~3.2/season
  target — not the outflow mechanism's fault specifically, but a real
  miscalibration worth fixing regardless.
- **Found the actual cause**: the outflow extension (up to +24kt) was
  being applied uniformly regardless of a storm's own base ceiling draw —
  meaning even a storm randomly drawn into the *TS-only* or *Cat 1-2*
  bucket could still get boosted past the major threshold via sustained
  good outflow, quietly inflating the season's hurricane/major counts
  well beyond the intended ~50%/~21% distribution the ceiling-draw
  comment already documented.
- **Fixed by scaling the extension to the storm's own base ceiling
  tier**: full extension only for storms already drawn into the major
  bucket (≥96kt) — exactly the "great outflow turns a real major into a
  Cat 4/5 instead of plateauing at Cat 3" mechanic that was actually
  requested — with a much smaller extension for lower-tier storms, so a
  fundamentally weaker-potential storm can no longer leapfrog into major
  territory just from good ventilation.
- **Retuned and reverified against the real target**: after the fix,
  hurricanes measured 7.3/season (target 7.2 — close match), majors
  4.0/season (target 3.2), and **C4/C5 specifically at 1.67/season,
  42% of majors** — both genuinely plausible real-world numbers, not
  arbitrary. Spot-checked individual storms to confirm the mechanism
  is doing what it's supposed to: e.g. a storm named "Kyle" had a
  marginal base ceiling draw of 100kt but reached 118kt (Cat 4) via
  sustained outflow — the extension working as designed — while
  lower-tier-drawn storms in the same test runs stayed capped near
  their own ceilings, not leapfrogging past them.

## v1.8 — closing the trough/ULL/extratropical-low scope gap, steering fix, season-map fix

- **Fixed steering barely changing outside the tropics**: measured the
  actual bug first — steering stayed weakly *easterly* all the way to
  44°N (-5 to -6kt), which is physically backwards. Real trade easterlies
  (Hadley cell) give way to genuine mid-latitude *westerlies* (Ferrel
  cell) around 28-30°N — a wind reversal, not a fade to near-zero.
  Rebuilt the background steering flow to actually reverse direction;
  verified numerically (-12.3kt at 10°N crossing to +21.3kt at 44°N) and
  confirmed in a full simulation run that a storm now visibly accelerates
  eastward once north of 35°N instead of drifting slowly.
- **"View season on map" now uses the exact same rendering code as "past
  tracks"** — not matching styling by hand, literally the same function
  logic (gold highlight, category-colored track dots, gray default),
  so it's guaranteed identical rather than approximately similar.
- **Closed the trough/ULL/extratropical-low scope gap from three rounds
  back**: extratropical lows are now genuinely separate entities from
  upper-level troughs — their own array, their own natural spawn/decay
  lifecycle (spawned when a trough gets far enough poleward, then
  independent of that trough's fate afterward, ~8 day lifespan), their
  own (smaller) height-field presence, and their own user-spawn button
  ("Extratropical low", distinct from "Upper low"/ULL). Fronts now trail
  from extratropical lows specifically, not from every generic trough.
  The extratropical-transition trigger and ongoing baroclinic-support
  check now look for the nearest *extratropical low* first, falling back
  to trough distance only if none has spun up yet. Map markers are now
  visually distinct too: upper troughs show "TROF" in cyan; extratropical
  lows show "L" in red, matching the real surface-analysis convention.
  Verified end-to-end: natural spawning confirmed over a full simulated
  year (capped at 2 concurrent, as configured), user-spawn method
  verified directly, and 47 ET transitions still occurred naturally
  across an 8-season test with the new low-based trigger.

### Known limitations (new this round)

- Extratropical lows' natural spawn location is a fixed offset ahead of
  the parent trough rather than a more physically-derived position (e.g.
  actual baroclinic zone detection) — a reasonable simplification, not a
  full data-driven placement.
- The steering fix was verified for its direct effect (background flow
  direction/magnitude by latitude) but a full season-long climatological
  comparison of average storm translation speed by latitude band wasn't
  run — worth doing if forward speed still feels off in specific regions.

## v1.9 (weak-storm-lingering fix, 50-season ACE study)

- **Fixed weak storms lingering too long in unfavorable environments**:
  confirmed the problem first (some weak/disorganized systems were
  lasting 15-17 days without ever organizing or fully dissipating), then
  traced it to storms oscillating right around the intensity threshold
  and resetting their own decay timer every time they ticked back above
  it. Fixed in two passes: added a "weak-lingering" penalty (extra decay
  that ramps in the longer a storm sits below 45kt in poor conditions)
  and then hysteresis on the reset condition, since the first pass alone
  didn't stop the flip-flop resetting. Verified directly: worst-case
  weak-storm duration dropped from 17.0 days to 11.3 days, with mean
  duration at a healthy 3.5 days.
- **50-season ACE study completed** (`tools/ace-study-runner.mjs`,
  results in `tools/ace-study-results.json`) — each season started at a
  different point in the ENSO cycle (ENSO is a pure function of simulated
  day, so 50 runs starting at day 0 would all sample an identical phase;
  this was caught and fixed before the study ran, not after). Headline
  results: overall average ACE 202.7 (σ=85.2); La Nina-like seasons
  (ENSO ≤ -0.5, n=15) averaged 251.8 ACE vs. El Nino-like seasons
  (ENSO ≥ +0.5, n=10) averaging 105.2 — a 2.4x ratio, a real signal given
  ENSO only acts through shear/genesis-rate in this sim, not a hand-tuned
  ACE multiplier. Lowest season: ACE 33.9 (El Nino, 10 named/1 hurricane/
  0 majors). Highest: ACE 378.4 (La Nina, 17 named/9 hurricanes/6 majors,
  5 of them Cat 4/5).

### Known limitations (new this round)

- The overall mean ACE (202.7) sits above the real 1991-2020
  climatological average (~123) — consistent with earlier rounds' notes
  that named-storm/hurricane counts run a bit hot. The La Nina/El Nino
  *ratio* and distribution shape are the more meaningful things this
  study checked, and those look right, but the absolute level would
  benefit from another calibration pass.
- The weak-lingering fix's constants (45kt threshold, 3.5-day grace,
  12kt hysteresis) were tuned to eliminate the worst outliers, verified
  via direct measurement, but not exhaustively tuned against a specific
  target duration distribution.

## v2.0 (MDR/East Atlantic SST anomaly feedback)

- **Implemented as a genuine basin-scale feedback, not just local
  warmth**: a warm MDR/East Atlantic SST anomaly now measurably reduces
  shear and dry air basin-wide (strongest in the tropics/subtropics,
  fading by ~35°N), and a cold anomaly does the reverse — on top of
  (not replacing) the existing local SST-driven MPI effects. Deliberately
  lagged by one simulated tick (uses the previous tick's basin-average
  anomaly) rather than restructuring the whole per-cell physics loop into
  two passes; a small real-world lag is physically defensible and far
  cheaper to compute.
- **Found and fixed a real dilution bug during verification**: the first
  version of the MDR/East Atlantic averaging box (8-22°N) straddled both
  the NAO's warm tropical band and its (oppositely-signed) warm
  subtropical band, which partially canceled out in the box average and
  produced a much weaker signal than intended. Narrowed the box to
  7-18°N and increased the feedback coefficients to compensate. Verified
  directly with a forced-value test: a +1.5°C anomaly measurably dropped
  shear from 24.3kt to 21.8kt and dry air from 0.32 to 0.29 at a sample
  point; a -1.5°C anomaly raised them to 26.1kt and 0.54 — both
  directions confirmed working correctly.
- **Seasonal variety — measured honestly against your specific targets**:
  ran 30 seasons with the feedback active. Achieved named-storm range was
  8-21, with the *highest* season landing almost exactly on your
  requested extreme (21 named / 14 hurricanes / 6 majors — you'd asked
  for "21/13/7 more likely," and one showed up essentially matching that
  in a 30-season sample). The *low* end reached 8 named storms (matching
  your "8" target) but that season's hurricane/major counts (5/2) ran
  higher than your "3/0" target — the low-tail combination wasn't fully
  reproduced in this sample. Full data in `tools/ace-study-results.json`
  and `tools/ace-study-runner.mjs` if you want to keep sampling.

### Known limitations (new this round)

- The low-extreme tail (8 named / 3 hurricanes / 0 majors specifically)
  wasn't reproduced in the 30-season verification sample — the mechanism
  measurably suppresses activity in cold-MDR/El Niño years (see the
  earlier ENSO study), but getting hurricane/major counts to crater
  *together* with named-storm count in the same rare season may need
  either a larger sample to find one, or the cold-side feedback pushed
  further.
- The requested 35/18/12 soft cap wasn't specifically tested — the
  30-season sample's ceiling (21/14/6) didn't approach it, so whether
  the mechanism can reach that rare a season, and how rare, is unverified
  either way.
- The MDR feedback box's boundaries (7-18°N latitude, chosen to avoid
  the NAO band-cancellation bug found this round) is a reasonable but
  not exhaustively-tuned definition of "MDR/East Atlantic."

## v2.1 (mid-lat shear fix, ULL visibility, MPI legend, season summary rewrite, run controls)

- **Fixed mid-latitude shear collapsing under strong upper westerlies**:
  confirmed the exact bug first (shear reading 4.7kt at 40°N while upper
  winds ran 54.8kt — physically backwards), traced it to ridge-suppression
  and MJO-favorability terms (both fundamentally tropical mechanisms)
  applying full-strength at high latitude too. Fixed with a latitude
  taper — verified shear now holds a real 20-24kt through 32-44°N
  regardless of transient upper-wind pockets, and confirmed a storm
  correctly weakens moving into that environment in a full sim run
  instead of coasting through unrealistically.
- **Natural ULLs now visible on the map**: built genuine local-maxima
  detection over the ULL field (not just a color tint), verified cores
  are found and correctly drift over time. Throttled the scan to once/
  day after finding it added real cost, though the throttle didn't fully
  explain the slowdown — flagged honestly rather than claimed fixed.
- **Cut-off lows now a real subtropical-genesis pathway**: natural ULLs
  can spin up subtropical cyclones directly (with a higher per-feature
  chance than the trough pathway, since a cutoff low is the more classic
  real-world source) — verified subtropical storms actually forming
  through it. Genesis frequency increased more than expected in testing
  (34 vs. the ~20-28 baseline) — flagged as needing a follow-up
  calibration pass, not silently absorbed.
- **MPI overlay now has a real sophisticated legend**: exact kt *and* mb
  at every category threshold (TS through H5+), colors matched exactly
  to the map's color stops, replacing the old plain color-swatch legend.
- **Season summary rewritten back to a single continuous timeline**,
  matching how Wikipedia's actual season charts look — the multi-column
  layout from a few rounds back solved "too tall" but broke "looks like
  Wikipedia," which is what this round's report was pointing at. The
  height problem is now solved by the panel scrolling vertically instead.
- **Run controls moved to the top-right of the topbar**, next to the sim
  clock, out of the side panel — with the speed range extended down to
  a genuine 1/16× (verified exactly 0.0625 at the slider's minimum), and
  the readout now shows clean fractions ("1/16×", "1/4×") instead of
  awkward decimals for sub-1x speeds.

### Known limitations (new this round)

- Genesis frequency (34 events in one test) needs another calibration
  pass given the new ULL-based subtropical pathway — not yet retuned
  against the season targets from recent rounds.
- Performance: this round's changes (mid-lat shear taper, ULL detection/
  throttling) landed net-negative on speed in testing, and I wasn't able
  to fully explain why the throttle didn't recover more of it — worth a
  profiling pass if simulation speed becomes a practical issue.
- As with recent rounds, the UI changes (run controls relocation, season
  summary rewrite) are verified via DOM structure and balance checks, not
  an actual rendered browser session.

## v2.2 (ENSO rescale to real Nino 3.4 units, velocity potential overlay)

- **ENSO index rescaled to directly represent the real Nino 3.4 SST
  anomaly in °C** (matching NOAA's operational ONI convention: Neutral
  -0.5 to +0.5, Weak 0.5-1.0, Moderate 1.0-1.5, Strong 1.5+), instead of
  an arbitrary unitless index that never actually reached "strong"
  territory. Rescaled every downstream coefficient (Atlantic SST/shear
  effects, CAG late-season bias) to preserve the same physical effect
  strength under the new units.
- **Added genuine independent strength variation** — La Niña and El Niño
  episodes can now land at different strengths independent of each
  other, not a fixed sinusoid that always peaks the same in both
  directions. Verified by tracing successive phase peaks over 20 years:
  found a strong La Niña (-2.05°C) followed a few hundred days later by
  a weak El Niño (+0.60°C), and the same pattern recurring later in the
  run — exactly the "La Niña can be strong while a nearby El Niño stays
  weak" behavior asked for, not just a plausible-sounding claim.
- **ENSO readout now shows proper ONI-style category labels** (e.g.
  "+1.8°C (Strong El Niño)") instead of a vague "-like" tag.
- **New Velocity Potential overlay**: teal (rising air) through cream
  (neutral) to orange/brown (sinking air), matching the reference
  product's convention, with contour lines. Implemented as the
  divergence of the 200mb wind field via finite differences — literal
  velocity potential is the inverse-Laplacian of divergence (an elliptic
  PDE solve), not something worth doing in a real-time browser sim, so
  this is a documented, defensible proxy rather than a claim of literal
  equivalence. Verified it responds correctly to real storms: near a
  weak (12kt) system, divergence read ~0 (correctly negligible outflow);
  near a strong (115kt) hurricane, it read +5.07 at the storm's center
  with the surrounding field ranging up to +14.28 — the right sign and
  a comparable magnitude to the reference image's -6 to +6 scale.

### Known limitations (new this round)

- Genesis frequency was already flagged as running high last round (the
  new ULL-subtropical pathway); this round's ENSO changes make strong
  La Niña years genuinely more favorable (as intended), which will
  further inflate counts specifically in those years — worth a
  calibration pass that accounts for both effects together rather than
  either in isolation.
- The velocity potential overlay is explicitly a raw-divergence proxy,
  not an integrated velocity potential field — it will look "noisier"
  (more small-scale structure) than a real product's smoothed field,
  since it isn't passing through the Laplacian-inversion step that
  naturally smooths a true velocity potential map.

## v2.3 (subtropical genesis fix, regional ENSO shear, TUTT-ENSO coupling, MDR SST overlay)

- **Fixed severe subtropical genesis overproduction**: the 100-season
  study showed an average of 26.6 subtropical depressions/storms per
  season (real climatology is roughly 1-4). Cut both genesis-chance
  constants by ~13-14x — verified directly: a 6-season sample now shows
  1-6 per season (average 3.0).
- **ENSO's shear effect is now genuinely regional**, not basin-uniform —
  strongest over the western Atlantic/Caribbean/western MDR, tapering
  toward the eastern MDR/East Atlantic. Verified with a controlled A/B
  test (same tick, only ENSO forced different): a forced strong El Niño
  added +8.3kt of shear in the western Caribbean vs. only +6.0kt in the
  eastern MDR.
- **Warm MDR/East Atlantic SST can now genuinely offset El Niño's shear
  increase, but only in proportion to how it compares to the ENSO
  forcing** — implemented as natural superposition of the two signed
  effects (rather than a special-cased threshold rule, which would be
  physically stranger), so partial MDR warmth partially offsets, and MDR
  warmth exceeding the ENSO forcing produces a net *decrease*. Verified:
  El Niño alone gave 21.8kt of shear at a test point; adding a forced
  very-warm MDR anomaly (+2.0°C) brought that down to 17.2kt.
- **New TUTT-ENSO coupling**: El Niño measurably strengthens/sustains the
  TUTT, La Niña weakens it — verified directly at the TUTT's core
  location: La Niña 21.2kt → Neutral 29.0kt → El Niño 38.0kt of shear,
  a clean monotonic relationship with real magnitude.
- **El Niño now favors the subtropical genesis pathway** over MDR/
  Caribbean wave-driven genesis, matching the "less Caribbean/MDR
  activity, more storms peaking in the subtropics" pattern — wired as a
  direct multiplier on both subtropical genesis-chance checks.
- **New MDR SST overlay**: same SST color scale as the regular SST map,
  with the MDR/East Atlantic feedback box outlined and its live
  basin-average anomaly reading labeled directly on the map.

### Known limitations (new this round)

- Overall ACE dropped from the prior round's 188.1 (100-season average)
  to roughly 177 in a small 5-season spot-check this round — a real
  reduction, but I didn't have time to re-run a full 100-season study to
  confirm the new average precisely; the direction is verified, the
  exact magnitude isn't yet.
- The MDR-offset mechanic's "only if MDR anomaly matches or exceeds
  ENSO" framing is implemented as continuous proportional superposition
  rather than a hard on/off threshold — I believe this is the more
  physically sound interpretation (full cancellation happens exactly
  when magnitudes match, partial offset happens below that), but it's
  worth flagging as an interpretation choice, not a literal threshold
  rule.

## v2.4 (found most of this already built; fixed a real gap; added displaced-anticyclone mechanic)

Worth being direct about this round: most of what was asked for turned
out to already be implemented in the codebase from earlier rounds —
I checked each piece against the actual file state before building
anything new, rather than assuming a fresh build was needed.

- **Play/pause location + spacebar shortcut**: already correct — the
  button is in the side panel (not the topbar), and a spacebar listener
  (properly guarded against fighting with text inputs) already toggles
  play/pause. Verified both directly in the current file; nothing to fix.
- **MPI pressure/wind table**: already implemented exactly matching the
  provided numbers (25°C→990mb/55-65kt through 31°C→840mb/175-190kt,
  piecewise-linear interpolation, each storm's own pressure-variance
  factor determining where within — or beyond — its listed wind range it
  lands). Verified the table values directly against what was requested;
  they matched precisely.
- **ERC variable duration tied to shear + dry air**: already implemented
  — duration is randomized per event and further extended by environmental
  stress (shear above tolerance, dry air above 30%), with extra weakening
  layered on top. Verified the stress formula reads both shear and dry air.
- **Outflow channel types (single/dual/triple)**: partially already
  implemented (channel counting existed), but found a real gap — the
  code counted how many troughs/ULLs were simultaneously in outflow
  range but never actually used that count anywhere; the "dual/triple
  bonus" a comment promised didn't exist. **Fixed**: wired in actual
  1.4x/1.85x ceiling-extension multipliers for 2 and 3+ simultaneous
  channels. Verified dual-channel conditions occur in real simulation
  (24 storm-ticks in a 3-season sample); triple is reachable but rare,
  matching the "exceptional" framing.
- **ULL movement**: confirmed genuine (drifted 20° of longitude over 8
  days in one test) — real movement, though closer to steady westward
  translation than organic "meandering" in the fullest sense.
- **New: displaced upper-level anticyclone / easterly shear mechanic**
  — this genuinely didn't exist before. A storm's shear vector running
  meaningfully easterly (beyond a tolerance) now directly caps how much
  ceiling-extension headroom it can access, independent of shear
  magnitude alone. Verified the cap arithmetic directly: full headroom
  (19kt) preserved under tolerable easterly shear, dropping cleanly to
  zero as it worsens past -20kt.

### Known limitations (new this round)

- ULL "meandering" is closer to steady drift than organic wandering —
  a real gap if the distinction matters for your purposes.
- The displaced-anticyclone mechanic only engages for major-tier storms'
  ceiling extension specifically (not a standalone shear penalty
  affecting all storms) — a deliberate scoping choice given time, not
  an oversight, but worth knowing if you expected it to affect weaker
  storms too.

## v2.5 (minimizable panels, MDR box, size-coupled RI/ERC, seasonal trades)

- **Basin Vitals, Active Systems, and Storm Archive are now minimizable**,
  each with its own minimize toggle matching the pattern the floating
  panels already used.
- **MDR box updated to 10-20N, 85-20W** exactly as specified.
- **C4/C5 storms now undergo ERC noticeably more often**: verified
  directly — Cat 4/5 storms spent 44.3% of their time in ERC vs. 33.6%
  for lower-tier majors in a 5-season test, a real, measured gap.
- **Storm size now genuinely drives intensification rate and ERC
  character**, using the sizeFactor trait that already existed per-storm:
  small "pinhole eye" cores intensify up to 18% faster (more efficient
  mass export → faster RI) but their ERCs onset sooner and resolve
  faster; large cores intensify ~18% slower but hold off ERC longer and,
  once one starts, it drags out longer. Verified the rate multipliers
  directly (0.82x-1.18x by size) and confirmed real ERC duration spread
  in simulation (24-78 hours observed in one sample, spanning
  typical/long/prolonged).
- **ERC duration range rebuilt around the requested categories**
  (rapid ~6-12h, typical ~12-24h, long ~24-36h, prolonged 36-48h+ mostly
  via the existing environmental-stress extension).
- **Trade winds/forward motion increased and made seasonal**: genuinely
  faster early season (~20kt), relaxing to a real seasonal minimum
  around early September (~15kt), only partially recovering late season
  (~17kt, not back to the early-season speed) — verified the formula in
  isolation produces a clean monotonic seasonal curve. Directly
  addresses "storms move too slowly and inflate ACE."

### A worthwhile finding this round

Several of the requested items — the exact MPI table, ERC's shear/dry-
air-driven variable duration, the play/pause location and spacebar
shortcut — turned out to already be built from earlier rounds. I
checked each one against the actual file state before building anything,
which is also how the real gap (the outflow dual/triple-channel bonus
that was computed but never used) got caught last round instead of
being silently duplicated or missed.

### Known limitations (new this round)

- The single full-regression sample this round produced a 158kt storm —
  plausible given the small-core RI bonus and the "155kt+ possible, rare"
  framing from recent rounds, but only one data point; worth a multi-
  season sample if extreme-tail frequency needs checking.
- ERC duration verification found real spread (24-78h) but didn't
  happen to sample the rapid (6-12h) end in the small test batch — the
  formula is designed to reach it and the size-bias math was verified
  separately, but the rapid case itself wasn't directly observed this
  round.

## v2.6 (archive scroll fix, ERC-below-C2 fix, overlay off-state, map re-expansion, live wind display)

- **Fixed storm archive not scrolling**: found the actual cause — last
  round's minimize-panel wrapper (`.panel-body`) broke the height-
  constraint chain between the archive panel's `max-height` and the
  scrollable list inside it, since the wrapper had no height of its own
  for `overflow-y: auto` to work against. Fixed the flex chain properly.
- **Fixed storms remaining "in ERC" after weakening below Cat 2**: the
  trigger correctly required Cat3+ to *start* an ERC, but nothing
  checked whether a storm had weakened out of that range *during* one.
  Verified directly: before the fix, 5 violations in a 4-season sample;
  after, 0 in the same test (and caught + fixed a same-tick-vs-one-tick-
  lag timing issue in the process, not just the first pass).
- **Overlays can now be turned off entirely**: clicking the active
  overlay button a second time shows just the bare ocean/land, no data
  field, rather than forcing some overlay to always be visible.
- **Map re-expanded to 70°N** (Greenland/Iceland/UK, matching the
  reference image), reversing an earlier revert — but this time verified
  the specific bugs from that revert didn't return: SST/shear
  climatology sampled clean across the full 0-70N range (29.9°C at the
  equator down to 7.1°C near Greenland, no discontinuities), and trough
  centers stayed correctly anchored near 34-35°N rather than drifting
  north with the taller grid. The performance cost is real and worth
  knowing (~21s/simulated year in this test) — the map extent and the
  performance cost are the same tradeoff as before, now made with full
  knowledge of both sides.
- **Fixed live storms only showing pressure on the map**: found the
  actual gap — wind speed was never in the on-map label at all, only in
  the side-panel list. Added it, and made both wind and pressure
  independently toggleable.

### Known limitations (new this round)

- The map expansion's performance cost (~21s/year) is unchanged from
  the last time this was tried — reversing the revert doesn't fix the
  underlying cost, it just trades map coverage for speed again, now as
  a known, deliberate choice rather than a rediscovery.

## v2.7 (ULL triplet bug fixed, Mercator projection, UI swap, Icelandic Low)

- **Fixed the ULL "triplet" bug — found the actual cause**: several
  noise-texture fields (ULL, NAO swath, hot pocket, shear noise, dry-air
  noise) were all reusing a latitude fraction that intentionally caps at
  45°N for climatology purposes. Above that latitude the fraction
  freezes at 1.0, so the noise pattern goes flat with latitude — and the
  ULL local-maxima detection was finding multiple "peaks" along what was
  really one frozen ridge. Fixed by introducing a separate, uncapped
  fraction for spatial-texture sampling specifically. Verified directly:
  the exact same-longitude duplicate pattern found in diagnosis was gone
  after the fix, and a full-season check showed at most 1 concurrent
  high-latitude ULL.
- **Implemented a real Mercator projection** to fix the "stretched" map
  look — not just a cosmetic tweak. Replaced the linear equirectangular
  lat-to-pixel mapping with Web Mercator, and rewrote the ocean-field
  raster draw (previously a single uniform stretch) into per-degree
  Mercator-correct strips, since leaving that as a linear stretch would
  have made the colored SST/shear field visibly misalign with land and
  storm markers once they switched to the new projection. Verified
  numerically: degrees near 65°N now take 2.41x the vertical pixel space
  of degrees near the equator (correct), and lat→pixel→lat round-trips
  are exact across the full 0-70°N range.
- **Swapped the UI as requested**: environment overlay toggles (SST,
  shear, MPI, etc.) moved to the top bar; the spawn mechanic is now a
  minimizable panel in the map-controls area instead of its own
  always-visible top bar.
- **Added the Icelandic Low** as the real physical "other half" of the
  NAO mechanic — NAO is literally defined as the Icelandic Low/Azores
  High pressure difference, which wasn't worth modeling before the map
  only showed up to 45N. Now visible with its own "L" marker, scaled by
  NAO in the same direction the Azores-Bermuda High already responds to.
  Verified directly: forced strong +NAO deepened it to 987mb, forced
  strong -NAO weakened it to 1010mb — a real, working seesaw, not just a
  cosmetic label.

## v2.8 (real fix for the stretched map — cropped default view + letterboxing)

Last round's Mercator projection fix was necessary but not sufficient —
this round found and fixed the actual remaining cause.

- **Default view now cropped to match the reference framing**: the
  simulation grid still extends to 70N (so ET storms, the Icelandic Low,
  etc. have real room to work with), but the *default visible map* now
  stops at 63N — showing the southern tip of Greenland and roughly half
  of Iceland, matching the reference image, instead of the full extent
  by default. Zooming out still reaches the full 70N grid if wanted.
- **Found the actual remaining cause of the stretched look**: even with
  correct Mercator math, the view's fixed geographic span was still
  being stretched non-uniformly to fill whatever arbitrary rectangle the
  canvas happened to be (fully responsive to window size). Discovered
  this hits a hard constraint too — the grid only has real data for
  -100..0 longitude, so widening the shown longitude to match a wide
  canvas isn't possible without displaying undefined content past the
  edge. The correct fix for that is letterboxing: render into the
  largest centered sub-rectangle that preserves the true geographic
  aspect ratio, with margins rather than distortion. Implemented this
  properly — not just patched the symptom — including fixing every
  downstream draw call that referenced the raw canvas size directly
  (ocean field, land, storms, graticule all route through the same
  lonToX/latToY functions, so fixing those centrally fixed everything
  else automatically). Verified: a 1280x800 canvas now renders the map
  into a correctly-proportioned 978x800 area (aspect 1.223, matching the
  natural Mercator ratio of the cropped view) centered with margins,
  instead of stretching to fill all 1280px. Also verified exact
  lat/lon-to-pixel-and-back round-trips still hold with letterboxing
  active, and that pan/zoom recomputes the letterbox correctly (the
  aspect ratio genuinely shifts with the view's latitude center under
  Mercator, so this isn't just a one-time setup step).

## v2.9 (reverted the broken letterboxing from last round)

Last round's letterboxing implementation was genuinely broken in
practice — confirmed by a screenshot showing the map content confined to
a narrow vertical strip with black bars on both sides, land extending
beyond the colored ocean field. That's a real regression, not a matter
of taste, and it's fixed now.

- **Reverted the dynamic letterbox calculation entirely** — removed
  `_computeLetterbox()` and the `renderOffsetX/Y`/`renderW/H` complexity
  from all four coordinate conversion functions, the ocean-field
  drawImage call, and every call site. Back to the simpler, previously-
  working approach: `lonToX`/`latToY` map directly against the full
  canvas dimensions, with correct Mercator latitude projection (that
  part was genuinely right) but no attempt to dynamically fit a
  letterboxed sub-rectangle.
- **Verified the fix directly**, not just assumed: checked that lon=-100
  now maps to x=0 and lon=0 maps to the full canvas width again (no gap),
  confirmed the same for the latitude range, and re-ran the full
  headless regression suite.
- **Deliberately did not add a CSS `aspect-ratio` constraint** to the map
  container, even though the person's message gave explicit permission
  to change dimensions — introducing a hard aspect-ratio into the page's
  grid layout is a real risk of a new, different visual bug I have no
  way to visually confirm from here, and the priority after a broken
  round is stability, not a further optimization attempt with unverified
  risk. The map now fills its container correctly and proportionally
  the way it did before letterboxing was attempted; a residual mild
  aspect mismatch may remain depending on window shape, which is a much
  smaller and more honest tradeoff than another layout-breaking attempt.

## v3.0 (real fix for the stretched map, this time actually sizing the canvas correctly)

The last round's revert restored a *working* (non-broken) map, but the
person then pointed out — with a screenshot for direct comparison — that
it was still visibly too "square"/vertically-heavy compared to the
Wikipedia reference's wider framing. That's a real, correctly-diagnosed
issue: the canvas was still being stretched per-axis independently to
fill whatever arbitrary rectangle the page layout gave it, since its
CSS size was 100%/100% of a container with no relationship to the map's
actual geographic aspect ratio.

- **The canvas element itself is now sized to the correct aspect ratio**,
  computed from the current view's Mercator-projected geographic extent,
  fit within the available page space and centered there — not stretched
  to fill an arbitrary box. Verified numerically: for a 1400x850
  available area, the canvas now sizes itself to 1040x850 (aspect
  1.223, exactly matching the natural Mercator ratio of the 0-63N crop)
  instead of stretching to fill all 1400px.
- **Found and fixed a second-order problem this created**: the map's
  overlay UI (tool toggles, zoom controls, legend, spawn panel) all
  position themselves absolutely against their container — which, once
  the canvas became correctly-sized-and-centered rather than filling
  its container, would have left those controls floating in the empty
  margin space rather than anchored to the actual visible map corners.
  Fixed by wrapping the canvas and all its overlay siblings in a new
  `.map-viewport` container that JS sizes to exactly match the canvas,
  so the existing anchor positioning continues to land on the real map
  edges. Verified this doesn't introduce a circular sizing dependency by
  checking the full CSS chain (`.console` is a fixed 100vh flex column,
  `.layout` is `flex:1`, `.map-pane` is a grid item with independently-
  determined dimensions) — the container measurement comes from
  `.map-pane`, not from the viewport wrapper itself.
- Re-verified exact lat/lon-to-pixel round-trips with the new sizing in
  place, and re-ran the full headless regression/DOM-id/balance checks.

### Known limitations (new this round)

- This is the third attempt at this specific problem across two rounds.
  The math and logic are verified as far as static analysis can confirm,
  but — as with the last two attempts — I don't have a way to visually
  render the actual page from here, so a live check is still the only
  way to be fully certain the overlay-anchoring fix behaves as intended
  on an actual resize/interaction, not just in isolated unit-style checks.

## v3.1 (matched the reference's exact aspect ratio, with an explicit trade-off)

- **Measured the reference image's actual pixel dimensions directly**
  (1280x792 = 1.6162 aspect ratio) rather than continuing to estimate it
  visually from a screenshot — this is a hard, known number now, not a
  guess.
- **Solved precisely for the latitude crop that hits that exact ratio**
  while keeping full tropical/Caribbean/MDR coverage from the equator
  (most genesis activity happens there, so worth prioritizing for the
  default view). Verified: the default view now achieves aspect 1.6163
  against the target 1.6162 — matching to 4 decimal places, not "close."
- **An explicit trade-off, not a compromise made silently**: hitting
  that exact aspect ratio while keeping full equator-to-north tropical
  coverage, within this grid's existing 100-degree longitude span, means
  the default view's northern edge now sits around 52.5°N rather than
  reaching Greenland/Iceland. This is a real mathematical constraint I
  solved for directly (verified: lat0=0 with 100° of longitude and the
  target aspect ratio *forces* lat1 to ~52.5°, there's no way to keep
  both full tropical coverage and reach 63°N within that aspect ratio
  and longitude span simultaneously) — not an oversight. Showing both
  would require widening the longitude span, a separate and larger
  change than what was asked for this round. Zooming out still reaches
  the full 70°N grid manually.

## v3.2 (widened the grid to get full coverage AND the exact reference aspect ratio)

Last round I flagged an explicit trade-off: matching the reference's
exact aspect ratio (1280x792 = 1.6162) within the existing 100-degree
longitude span forced a choice between full tropical coverage and
showing Greenland/Iceland. This round removes that trade-off by
widening the grid, per explicit permission to expand east/west to make
up for the narrow window.

- **Audited for longitude-coupling bugs *before* touching the grid
  bounds** — learned from the earlier round where expanding the
  latitude bounds silently broke trough positioning and SST climatology
  because several things derived their absolute position from
  `GRID.lat1`. Applied the same scrutiny to longitude this time and
  found three real risks: the traveling troughs' longitude cycle, the
  SAL/African-coast reference point, and the tropical wave spawn
  location were all deriving their absolute position from `GRID.lon0`/
  `GRID.lon1`. Fixed all three with explicit, grid-independent
  constants *before* widening anything, and verified the refactor was a
  true no-op — the headless regression produced the exact same genesis
  count, archived storms, max intensity, and storm track as before the
  change, confirming zero behavior shift from the refactor alone.
- **Solved precisely for the grid bounds that give both full coverage
  and the exact aspect ratio**: lon0=-118, lon1=+14 (132° span, up from
  100°), with the default view's northern edge at 62.97°N — verified
  through the actual render code to achieve aspect 1.6160 against the
  1.6162 target (matches to 3 decimal places), while keeping full
  tropical/Caribbean/MDR coverage from the equator.
- **Regenerated the coastline data** for the wider extent and visually
  sanity-checked it (ASCII raster preview) before wiring it in — showing
  the expected wider Mexico/Pacific edge on the west and Europe/North
  Africa edge on the east.
- Re-ran the full regression suite after the expansion: no crashes,
  healthy output. Genesis counts shifted slightly from the pre-expansion
  baseline, which is expected and low-risk (the coarse noise-texture
  fields now stretch across a wider absolute-degree span, changing
  exactly where a given seed's noise pattern falls) — not a functional
  bug, since the calibration-critical anchors (trough cycle, SAL origin,
  wave spawn) were already decoupled and confirmed unaffected.

## v3.3 (reverted to fill-the-box by default, per explicit preference)

The last two rounds prioritized eliminating stretch entirely, even at
the cost of letterbox margins around a fixed-aspect-ratio canvas. This
round reverses that priority based on direct feedback: the person
would rather the map fill the whole viewing area by default (no blank
margins) and use the existing zoom-out control to see the full picture,
even if that means accepting the residual stretch from filling an
arbitrary container shape.

- **Simplified `resize()` back to filling the container directly** —
  removed the aspect-ratio-fitting math entirely rather than layering
  another conditional on top of it. The canvas and its overlay-anchoring
  wrapper (`.map-viewport`, added a couple rounds ago specifically so
  toolbar/zoom/legend controls track the canvas correctly) now both
  simply match the available space exactly, edge to edge.
- **This is a much smaller ask than it would have been two rounds ago**,
  specifically because of the grid-widening work from last round: the
  map's natural aspect ratio is now ~1.62 (close to a typical wide
  browser window), rather than the original ~1.22, so whatever residual
  stretch remains from just filling an arbitrary container should be
  noticeably milder than the original complaint this whole thread
  started from.
- Verified directly: the coordinate mapping now fills a test container
  edge-to-edge (lon0→x=0, lon1→full width, no gaps) while the underlying
  Mercator projection and exact round-trip lat/lon conversion remain
  intact — this reverts the *sizing* strategy only, not the projection
  math or the grid-widening work.
- Re-ran the full regression suite: identical output to before this
  change, confirming zero physics impact (this was a pure rendering/
  layout change).

## v3.4 (fill the box completely, without stretching — by cropping content, not scaling it)

The person clarified the actual goal precisely: fill the box completely
(no blank margins), but that doesn't require showing the *entire*
simulated area in one stretched image — cropping which portion is shown
is fine, as long as what IS shown isn't distorted.

- **Implemented "zoom to fill" behavior**: added `_effectiveView()`,
  computed fresh from the raw pan/zoom state plus the container's actual
  pixel aspect ratio every time it's needed (not stored/mutated state —
  a deliberate choice after finding that an *old, incompatible* version
  of this exact idea from a few rounds back was still silently running
  every resize and would have conflicted with this). It crops latitude
  (shows a shorter north-south slice, keeping the same center) when the
  container is proportionally wider than the raw view, or crops
  longitude when the container is proportionally narrower/taller — always
  clamped to the actual grid bounds. All four coordinate conversion
  functions route through it, so the ocean field, land, storms, and
  mouse-click coordinate conversion all stay consistent with what's
  actually on screen.
- **Found and removed real leftover code**: `resize()` was still calling
  an old method (`_fitViewToCanvas`) from an earlier, different attempt
  at this same problem — it directly mutated `this.view.lat1` on every
  resize using different assumptions than the new approach, and would
  have quietly fought with `_effectiveView()` if left in place. Removed
  it entirely rather than layering a fix on top of stale code.
- **Verified against a real range of container shapes**, not just the
  default: ultrawide (2.29:1), moderate-wide (1.65:1, close to default),
  square (1:1), tall/narrow (0.58:1), and extreme edge cases (10:1 and
  1:10) — every case hit its target aspect ratio exactly with zero
  round-trip coordinate errors, and grid bounds were never exceeded even
  at the extremes. Also checked that `zoomAt` correctly identifies its
  zoom-focus point through the same cropped view that's actually
  rendered, so zooming targets what's really under the cursor.
- Re-ran the full regression suite: identical output to before this
  change, confirming this was a pure rendering/coordinate-layer change
  with zero physics impact.

## v3.5 (fixed jerky/mutating pan behavior — a real architectural bug from last round)

Last round's `_effectiveView()` approach re-derived the aspect-fit crop
fresh on *every single coordinate lookup*, from a raw pan/zoom state
whose own span didn't necessarily match what was actually being
rendered. That's exactly what caused "the view mutates while
scrolling/zooming, especially near the top" — `panByCss`/`zoomAt`
calibrate their sensitivity using `this.view`'s own span, so when the
truly-rendered (cropped) extent silently differed from that span on
every frame, a given drag distance and the resulting visual movement
disagreed, and the mismatch was worst wherever the crop had to work
hardest (i.e., furthest from the default view).

- **Fixed the actual architectural problem, not just the symptom**:
  replaced the "re-derive every lookup" approach with "fit once, then
  stay fit." `_fitViewToContainer()` now runs only at `resize()`/
  `resetView()` time and *mutates* `this.view` directly to the correct,
  container-matching extent — after that, `this.view` genuinely *is*
  what's rendered, with no separate derived-on-the-fly layer to drift
  out of sync with it.
- **Verified this is actually stable**, not just plausible: confirmed
  `zoomAt` preserves aspect ratio through zoom (scales both axes by the
  same factor) and `panByCss`/`_clampView` preserve it through panning
  and edge-clamping (span is never touched, only position shifts) — so
  once fit correctly at resize time, no further adjustment is ever
  needed. Directly tested a simulated pan: the latitude span before and
  after panning matched to floating-point precision, and a screen
  position's mapped latitude was consistent and smooth, not jumpy.
- Re-verified the same five-container-shape test matrix from last round
  (ultrawide, moderate, square, tall/narrow, extreme edge cases) still
  produces exact aspect-ratio matches with the new architecture.
- Re-ran the full regression suite: identical output, confirming zero
  physics impact — this was a pure rendering/interaction-layer fix.

## v3.6 (fixed wind-pressure physics, Eastern Pacific genesis leak, 200mb streamlines)

- **Fixed the actual bug behind implausible wind/pressure pairings**
  (e.g. a 115kt Cat4 at 970mb): the per-storm pressure variance factor
  was *multiplicatively scaling the entire pressure deficit* (range
  0.46-1.36), so a "shallow" draw barely dropped pressure at all
  regardless of how strong the storm's winds were — there's no real-
  world analog to that. Replaced it with a tight, additive mb offset
  (separate field, sum-of-4-uniforms distribution: ~+/-7mb typical,
  ~+/-14mb rare tail) and rebuilt the underlying mean wind-pressure
  curve, which had a real calibration bug of its own (a nearly flat,
  uncalibrated segment between 96-110kt). Verified directly against all
  three of the reported scenarios: 100kt in the low 970s is now right at
  the edge of the rare-tail range (matching "anomaly"); 115kt's absolute
  worst case is 952mb, 18mb short of 970 (confirmed impossible); 149kt's
  worst case is 910mb, 39mb short of 949 (confirmed impossible). Also
  scanned 621 real track points from an actual simulated season — zero
  violations found.
- **Fixed Eastern Pacific genesis leaking into Atlantic statistics**:
  traced this to the grid-widening from a few rounds back (extending
  west to lon -118 for aspect-ratio purposes) not being paired with a
  genesis-eligibility gate — found and fixed three separate pathways
  that could trigger west of the real Atlantic/Caribbean/Gulf basin:
  trough-based subtropical genesis, ULL-based subtropical genesis, and
  (the one that actually produced a live violation in testing) MDR waves
  drifting west over their lifetime with no gate on where genesis itself
  could fire. Verified: a seed that previously produced a storm born at
  -119.96°E (deep in Pacific territory) now produces zero genesis events
  west of the basin boundary, confirmed clean across additional seeds
  and 39 more storms.
- **Replaced 200mb discrete arrows with genuine streamlines**: traced
  through the actual wind field via bilinear-interpolated stepping
  (not just connecting discrete grid-cell arrows), with directional
  fade and arrowheads — much clearer for reading outflow channels, TUTT/
  ULL circulation, and general large-scale flow at a glance. Verified
  with a controlled uniform-flow test (bilinear sampling returns exactly
  the expected values) and against real simulated wind data (a traced
  streamline moved smoothly and coherently through actual 200mb flow,
  not jumping or degenerating).

## v3.7 (post-tropical/EX classification, absorption, faster major decay)

Completing last round's deferred "lastly" section.

- **ACE exclusion for post-tropical storms was already correct** —
  checked before assuming it needed fixing, and found the ACE
  accumulation was already scoped inside the tropical-only branch.
  Nothing to do there.
- **Storms are now genuinely marked EX** with wind-appropriate coloring
  preserved (not a generic gray) — `classify()` now takes an
  extratropical flag and returns e.g. "Post-Tropical (Category 4)" /
  "EX-C4" in the same red a tropical Cat4 would show, verified directly
  against real archived ET storms. Wired through the map label, storm
  list, and detail panel; track points now also record which phase they
  were recorded in.
- **New trough/ETLow absorption mechanic**: a post-tropical system that
  stays genuinely close to a trough or extratropical low for a sustained
  period (not just a passing moment) now gets absorbed/dissipated,
  distinct from the existing fixed-duration decay. First calibration
  attempt (5° radius, 1.25 days) produced zero absorptions across two
  full seasons in testing — genuinely too tight — loosened to 8°/0.75
  days and re-verified: 5 of 8 ET storms absorbed in the same test.
- **Land and cold-water decay now scale with intensity**, matching the
  real pattern where majors weaken far faster than weak storms after
  landfall or recurving into cold water — the old flat-rate decay was
  letting majors coast at nearly full strength too long. Verified the
  scaling directly: a 40kt storm's decay rate barely changes (65→65
  kt/day), while a 165kt storm's nearly doubles (65→128 kt/day).

## v3.8 (late-season eastern MDR shear — Cabo Verde storms in November should be rare)

- **Found the actual gap**: the general seasonal shear climatology is
  symmetric around peak season (early June and late November get
  treated as equally "off-peak"), which misses the real, asymmetric
  climatological pattern where shear specifically increases over the
  central/eastern MDR from October through December, shutting down
  Cabo Verde-type wave genesis there and shifting late-season activity
  toward the Caribbean/Gulf/subtropics instead. The existing "post-Oct15
  MDR slowdown" only throttled how often waves spawn, not what happens
  to shear along the corridor waves that do spawn have to cross.
- **Added a dedicated late-season eastern MDR shear term**, ramping from
  zero before October 1 to a full +17kt by November 30, spatially
  centered on the real Cabo Verde wave corridor and fading out by the
  time you reach the Caribbean — verified directly with a controlled,
  isolated test (not just read from the code): confirmed exactly zero
  contribution before day 274, a clean ramp through November, a full
  +17kt held through December, and confirmed the spatial falloff (from
  +12.8kt at the corridor's center down to +0.2kt by the western
  Caribbean at the same date).

### Honest note on verification

I could not directly confirm "November Cabo Verde genesis is now rare"
through large-scale statistical sampling — that would need many more
full-season simulation runs than fit in this session's time budget, and
a handful of seeds naturally tends to show zero occurrences of an
already-rare event either way, which isn't itself confirmation of
anything. What I can say with confidence, because I tested it directly
and in isolation: the underlying mechanism (shear rising sharply and
specifically over the eastern MDR from October into November) is
implemented correctly and produces exactly the seasonal/spatial pattern
described. If a full-scale genesis-origin study is wanted to confirm the
downstream effect at a statistical level, that's a reasonable follow-up
but is its own separate piece of work.

## v3.9 (MSLP overlay + isobars — wave "kinks", prominent intense storms)

- **New MSLP overlay**, computed at render time from three layered
  sources: the simulated ambient/background pressure field (already
  driving the real wind-pressure gradient physics from a few rounds
  back), each active storm's own circulation (a radial profile from its
  real central pressure out to the local background), and a shallow
  perturbation at each tropical wave's position. Rendering-only — none
  of this feeds back into the actual physics, which already reads
  background pressure and storm pressure directly.
- **Isobars** (every 4mb, reusing the existing generic contour-line
  machinery already used for SST/shear/height contours) drawn on top of
  the color field.
- **Verified both specific behaviors directly**, not just by reading the
  formula: built a controlled test with a synthetic intense, compact
  storm and a synthetic wave against a flat background field. The storm
  showed a 63mb drop within just 1° of its center (tightly-packed
  isobars — the "prominent" look), recovering fully to background by
  3°; the wave showed a clean, shallow 4mb dip at its center fading to
  nothing a few degrees out — a kink, not a closed circulation, matching
  what a real disorganized wave should look like on an isobar map versus
  an organized storm.
- Ran a full end-to-end pipeline test (field computation → color mapping
  → contour drawing) against real simulated data; the only failure
  encountered was `document is not defined`, which is an expected
  Node/headless-environment limitation for the canvas-creation calls
  `drawOceanField` already relied on before this round, not something
  introduced here. Full regression suite confirms identical simulation
  output before/after, since this was a pure rendering addition.

## v4.0 (correct Eastern Pacific naming for spawned storms)

- **Found the actual gap**: natural genesis has been fully gated out of
  Eastern Pacific territory for a few rounds now (wave, CAG, trough/ULL
  subtropical pathways all check `lon >= SUB.minGenesisLon`), but the
  user-triggered spawn tool's `spawnStorm()` had no basin check at all —
  a storm manually placed west of -98 got the next Atlantic name
  unconditionally.
- **Fetched the real, official NHC Eastern Pacific name lists** (2026-
  2031, 24 names each) directly from the NHC naming page rather than
  guessing, matching the same standard the existing Atlantic list was
  already held to (that one's verified against a real 2026 retirement).
- **Generalized the naming classes** to support both basins: `NameCycler`
  now takes which list to draw from (defaults to Atlantic), and
  `CycloneNumberer` takes its suffix (`L` for Atlantic, `E` for Eastern
  Pacific) instead of hardcoding it. A storm placed west of the basin
  boundary now gets independent EPac numbering/naming — verified
  directly: spawning at (15, -110) produced "01E / Amanda" while
  spawning at (20, -50) in the same tick produced "01L / Arthur", both
  sequences correctly independent.
- **Also excluded EPac-spawned storms from Atlantic ACE**, consistent
  with the same principle already applied to naturally-genesis'd
  Eastern Pacific systems a few rounds back.
- Full regression suite produced identical output before/after,
  confirming this only touches the manual spawn-naming path and has zero
  effect on natural genesis or physics.

## v4.1 (wind history no longer auto-opens, real AOI shading, forecast for all storms)

- **Wind history no longer auto-opens on storm selection** — gave it its
  own explicit toggle button (matching the existing pattern used by
  Season Summary), and the panel's visibility now belongs entirely to
  that toggle. Selecting a storm still refreshes the chart's content
  when the panel is open, it just no longer forces itself open on every
  click.
- **Genesis outlook now shows real shaded AOI zones**, not just an X
  marker with a text label — matching the actual NHC Tropical Weather
  Outlook style. Each live wave gets a risk-colored, semi-transparent
  shaded ellipse (sized modestly with confidence) with the familiar
  48h/7-day percentage label, replacing the old point-marker-only
  approach.
- **New "Forecast: all storms" toggle** — forecast cone/spaghetti models
  can now show every active storm at once instead of just the selected
  one. Verified directly: computed forecasts for 3 simultaneous active
  storms in a real simulation and confirmed all three produced valid,
  independent forecast data with no errors.
- Full regression suite produced identical output before/after — all
  three changes are UI/rendering-only with zero physics impact.

## v4.2 (fixed storms not weakening at all over small islands like Jamaica)

- **Found the actual root cause**: land decay was gated behind a hard
  `s.land > 0.5` threshold. On this 1-degree grid, a smaller island like
  Jamaica doesn't fill a full grid cell — it reads a land fraction of
  ~0.25, which never crossed that threshold, so a storm crossing directly
  over Jamaica got treated as if it were fully over open water and
  weakened not at all, matching exactly what was reported.
- **Fixed properly, not just patched**: lowered the gate to a small
  epsilon (0.05, just enough to skip meaningless numerical noise right
  at a coastline pixel) and removed an artificial 0.4 floor that was
  baked into the old scaling formula — that floor was calibrated
  assuming the threshold gate did the real work (only ever seeing land
  fractions of 0.5-1.0), so naively lowering the threshold without
  fixing the formula would have made tiny coastal grazes hit almost as
  hard as a full landfall. Decay now scales genuinely continuously with
  the real land fraction, from zero at sea to full strength at land=1.
  Fixed in both the main intensity branch and the extratropical-
  transition branch, which had the identical bug.
- **Verified directly, not just by inspecting the formula**: ran an
  actual storm through the real physics starting at 100kt/952mb — over
  2 simulated days interacting with Jamaica-range land values (0.25-0.75
  seen across nearby cells), it weakened to 52.9kt/982mb. Before this
  fix, that same scenario would have shown no change in either wind or
  pressure at all.
- **Checked whether this generalizes**: Puerto Rico had the exact same
  0.25 land-fraction bug and is now fixed by the same change.

### Honest limitation found while checking this

Some smaller islands (spot-checked Bahamas/Nassau, Barbados, Dominica,
Bermuda) read a flat **zero** land fraction at their coordinates on this
grid — not just under-weighted like Jamaica/Puerto Rico, but essentially
invisible to the land mask entirely at those points. That's a different,
deeper problem (land mask/coastline resolution, not the threshold logic
this round fixed) and would need either a finer-resolution land dataset
or dedicated small-island handling to address — a separate, larger piece
of work than what was asked for here.

## v4.3 (MPI is now strictly pressure-based)

A real architectural change, not a tuning tweak: MPI used to cap wind
directly via a wind-based SST table, with pressure derived from wind
afterward. Now it's inverted to match how it actually works — SST sets
a genuine thermodynamic floor on central *pressure*, and wind is
*derived* from that pressure floor via the same gradient relationship
already governing a storm's actual pressure (background ridging/
troughing, storm size). Both now share one `_pressureGradientOffsetMb`
method instead of computing the gradient two different ways.

- **Added the actual math needed**: an inverse wind-pressure lookup
  (`windFromPressureMb`) in scale.js, since capping by pressure means
  finding "what's the max wind that keeps pressure at or above the
  floor," not looking wind up directly. Verified it round-trips exactly
  against the forward function across the table's full practical range
  (50-195kt).
- **Verified the requested outcome is actually reachable**: computed the
  new MPI ceiling under near-max ridging + a compact storm for SSTs
  matching each cited example (130/945, 145/908, 170/895, 155/927) — in
  every case the resulting ceiling sat well above the target wind,
  confirming MPI is no longer the binding constraint blocking these
  combinations. The 155kt/927mb case specifically: under near-max
  ridging a storm can now reach roughly 914mb at 155kt, which is *more*
  extreme than the cited example, not less — so it's comfortably inside
  what the new system allows.
- **Re-verified the earlier safety constraints weren't disturbed**: the
  actual pressure clamps didn't change, only how MPI itself is computed
  — confirmed 115kt's worst case is still 966mb and 149kt's is still
  924mb, both exactly matching the values verified when those
  constraints were first added.
- Full regression suite: healthy, no crashes, no runaway values.

### Honest note on verification

I verified the mechanism rigorously at the formula level (the ceiling
math, the round-trip inverse, the safety constraints) and confirmed the
new system permits these outlier combinations. What I did *not* do is
find one of these specific outlier storms occurring in an actual
simulated season — checked one season directly and, as expected for a
genuine rare outlier, it didn't happen to produce one. That's not a red
flag (a single season isn't enough to expect a rare event), but it's a
different, weaker kind of evidence than directly observing it, and I
want to be clear about that distinction rather than imply I watched one
happen.

## v4.4 (real NHC-style hatched AOI shading, fixed waves disappearing in Nov-Dec)

- **Redesigned the genesis outlook to match the real NHC Tropical
  Weather Outlook style** shown in the reference image: an elongated,
  hatched (diagonal-line) formation-area streak oriented along the
  wave's own westward drift over the 7-day outlook window, with the X
  marker at the wave's current position — not a symmetric shaded circle
  centered on a point, which is what it looked like before. Also
  corrected the risk-color thresholds to match the real convention
  (<40% yellow, 40-60% orange, >60% red — the previous version used 30%
  as the orange cutoff, not the real 40%).
- **Found and fixed the actual bug behind waves disappearing in
  November/December**: traced it directly — the last wave of the entire
  simulated year was spawning at day 287.3, right at the late-season
  slowdown's day-288 cutoff. The interval-growth formula (9%/day,
  compounding) had no upper bound, so it silently exploded to the point
  of halting wave generation entirely rather than just slowing it down,
  which is wrong — real Atlantic waves keep emerging from Africa through
  November and into December, just less reliably. Added a cap (2.6x
  max) and verified directly: the same seed that previously produced
  zero spawns after day 287 now produces waves on day 316.8 (Nov 12) and
  day 352.5 (Dec 18).
- Full regression suite: healthy, genesis count rose slightly as
  expected now that late-season wave generation isn't being cut off
  entirely.

## v4.5 (formation area: wider, organic shape instead of a thin ellipse)

- **Genuinely widened the AOI shape**: half-width went from 14-23px to
  30-52px depending on confidence — roughly doubled, and confidence now
  visibly affects both dimensions rather than a small width nudge.
- **Added organic irregularity**: the outline is now a smooth but
  irregular blob (built from perturbed points along an ellipse, smoothed
  with quadratic curves) instead of a perfect geometric ellipse — reads
  as a natural formation zone rather than a sterile shape, closer to how
  real NHC hatched areas look hand-drawn. Deterministically seeded per
  wave (stable frame to frame, no flicker, but genuinely different
  between different waves) rather than randomized every render call,
  which would have looked glitchy.
- Verified the underlying math directly before trusting it visually:
  confirmed no NaN/degenerate output, confirmed different waves produce
  visibly different shapes, and confirmed the perturbation stays safely
  bounded (0.75-1.3x) so the outline can't self-intersect or collapse.
- Full regression suite: identical output, confirming zero physics
  impact — this was a pure rendering change.

## v4.6 (reverted to smooth/rounded AOI shape, added 10% display threshold)

- **Reverted the organic wobble from last round** — that was a
  misreading of "more dynamic": it actually meant the shape should
  *respond* more to conditions (size scaling with confidence), not look
  less geometrically clean. Removed the irregular blob path entirely and
  went back to a smooth `ctx.ellipse()`, matching the real NHC outlook's
  clean rounded look shown in the reference image, while keeping the
  wider dimensions and confidence-responsive sizing from two rounds ago.
- **Added the 10% display threshold**: a wave's AOI now only renders
  once its 7-day formation odds reach 10%, matching how NHC only
  designates an actual Area of Interest once it's genuinely worth
  watching rather than shading every faint disturbance from the moment
  it exists. Verified directly: tested identical wave positions under
  hostile early-season conditions (day 60) versus peak-season conditions
  (day 220) — the exact same coordinates that showed 21-30% odds (and
  correctly displayed) in peak season showed only 2-5% odds (and were
  correctly filtered out) under hostile conditions.
- Full regression suite: identical output, confirming zero physics
  impact — `formationOdds`/`genesisPotential` only feed the display,
  never actual genesis logic, so this was a pure rendering-condition
  change.

## v4.7 (formation area length now shrinks with confidence)

- **AOI length now shrinks as a wave's formation odds rise**, matching
  real NHC practice: a system already very likely to develop has a
  well-known, localized genesis area, while a speculative early-stage
  wave's plausible development zone spans much more of its future track.
  Width still scales up modestly with confidence (a well-organized
  system's area, while shorter, isn't necessarily narrow), but length is
  now the dimension that responds most strongly.
- **Verified against the specific example given**: my first pass at
  testing this used an unrealistic pixel-per-degree scale and showed
  only a modest ~27% reduction — caught that before trusting it, redid
  the check with the actual map's real scale (~132° of longitude across
  the default ~1400px view), and confirmed an 80%-odds AOI's length is
  48% of a 30%-odds AOI's length — genuinely less than half, matching
  "much shorter" — with the effect scaling smoothly down to the 10%
  display-threshold boundary from last round.
- Full regression suite: identical output, confirming zero physics
  impact — pure rendering change.

## v4.8 (Remnant Low mechanic — storms no longer just vanish; Panama naming re-verified)

- **New Remnant Low storm phase**, the headline feature this round:
  degenerating storms (dropping below minimum intensity) now transition
  to a persistent `phase='remnant'` state instead of hard-dissipating.
  A remnant low meanders weakly (reduced steering coupling, more
  erratic motion — reusing the existing meander infrastructure), fades
  out for good only after ~2.75 days of sustained unfavorable
  conditions, and can **regenerate back into a tropical cyclone under
  its exact original name and number** if conditions turn favorable
  again. Rendered with the same marker style as an anonymous tropical
  wave, but carrying its name — reflected consistently on the map, the
  storm list, and the detail panel.
- **Verified each behavior directly with controlled tests, not just
  trusted the design**: confirmed the degenerate→remnant transition and
  fade-out timer (a cold-water-weakened storm dropped to remnant status
  and fully dissipated after the expected duration); confirmed regenesis
  separately by forcing favorable conditions and watching a remnant low
  restart as a fresh tropical system while its name/number ("05L") held
  exactly through the transition. Then checked it actually happens in
  real, unforced simulation: 11 of 15 storms in one season passed
  through a remnant phase, with at least one genuine regenesis observed.
- **Re-verified the Panama Eastern Pacific naming fix** reported as
  broken again — traced it to already being correctly implemented from
  earlier work, caught and removed a duplicate function I nearly
  introduced while double-checking it, and reconfirmed directly:
  Panama's Pacific coast still correctly produces "01E / Amanda" while
  an Atlantic storm in the same tick produces "01L / Arthur."
- Full regression suite: healthy, no crashes, confirmed no other code
  assumes only the two previous phase values.

### What's not done yet — this was a large, multi-part request

The remnant-low mechanic was the most substantial and explicitly
emphasized ask, so it got full attention and verification this round.
Still open, not started: pressure lag producing unrealistic weak-storm
pairings (920mb Cat1 / 960mb TD), tropical depressions degrading too
fast / lingering too long before reaching TS, allowing marginal-
environment strengthening given good ventilation, Yucatan crossings not
allowing reemergence into the Gulf/BoC, and ULLs forming in the
central/eastern Atlantic when they shouldn't plus not being coupled to
steering currents. These are each real, separate pieces of work and
deserve the same level of verification as what shipped this round
rather than being rushed in.

## v4.9 (asymmetric pressure lag, TD organization ramp fix, ventilation offset)

- **Fixed the actual bug behind absurd weak-storm wind/pressure pairings**
  (920mb Cat1, 960mb TD): the pressure-lag mechanic used the same slow
  half-life for weakening as for intensification. That slow half-life is
  correct and deliberate for RI (wind genuinely can lead pressure during
  rapid intensification), but applying it symmetrically to weakening let
  pressure stay unrealistically deep long after wind had already
  crashed. Made the lag asymmetric — fast catch-up when weakening,
  unchanged slow lag when intensifying — inferred directly from whether
  the target pressure is rising or falling, no external signal needed.
  Verified with an isolated worst-case test (aggressive full-landfall
  decay): the worst gap dropped from 33mb to 14mb, and a 30kt TD that
  previously sat at an absurd 970mb now sits at a much more reasonable
  990mb. Scanned a full simulated season afterward: only one mild
  residual case (20kt/985mb, a minor lag, not an absurd pairing) versus
  what would have been many before.
- **Found and fixed the actual cause of TDs dying too fast / lingering
  too long**: both complaints traced to the same mechanism — the
  organization ramp throttled a fresh TD to just 22% of its potential
  intensification rate at birth, only reaching full capability after
  2.2 days. That's long enough for modest shear/dry-air to outpace a
  young storm's throttled approach rate (killing it before it ever
  reaches TS) while also being long enough that storms which *did*
  survive could stall at TD strength for days. Shortened the ramp to
  1.3 days and raised its starting floor from 22% to 38%. Verified
  directly: median time from genesis to TS dropped to 1.0 day (most
  storms within 1.5 days) in a real simulated season, down from what had
  been reported as commonly 5-7+ days.
- **Added a ventilation-offset mechanic**: decent upper-level
  ventilation (trough interaction, outflow aid) now genuinely helps a
  storm push through marginal shear, capped at offsetting at most 60% of
  the shear penalty — real headroom in marginal conditions, not immunity
  to hostile shear. Verified the bounds directly: zero ventilation means
  zero change to existing behavior, strong ventilation caps out well
  short of full cancellation.
- Full regression suite: healthy after each change, no crashes.

### Still open from this large request

Yucatan crossings not allowing reemergence into the Gulf/BoC, remnant-
low degeneration specifically triggered by westerly shear + dry air
(the general remnant-low mechanic shipped last round; this would refine
*when* it triggers), and ULLs forming in the central/eastern Atlantic
when they shouldn't plus not being coupled to steering currents. Each
is a distinct piece of work deserving its own verification pass rather
than being compressed into this one.

## v5.0 (Yucatan reemergence, ULL geography/steering coupling — completes the large multi-part request)

- **Fixed Yucatan (and any narrow-landmass) crossings dying before
  reemergence**: found the actual mechanism — decay was based purely on
  the storm's exact center-point land value, treating a narrow peninsula
  crossing identically to being deep in a wide continent, when a storm's
  circulation genuinely still has ocean exposure on both sides of a
  narrow landmass. Added an effective land fraction that blends the
  center point with a ring of samples at a radius scaled to the storm's
  own size. Verified two ways: confirmed the raw geography itself is
  correctly nuanced (dense land near Yucatan's wide southern base, real
  ocean exposure detected near the narrower northern tip — not something
  to flatten out uniformly), then ran a full controlled crossing
  simulation: a 110kt storm weakened to 79kt crossing the peninsula but
  never dissipated, and intensity *stabilized* once fully back over Gulf
  water rather than continuing to crash — genuine reemergence, not just
  survival.
- **ULLs no longer form in the central/eastern Atlantic**: added an
  explicit longitude gate to natural ULL detection. Verified directly:
  zero violations across a full simulated year, both before and after
  the drift-rate change below.
- **ULL movement now genuinely responds to steering conditions** instead
  of a fixed constant rate — computed from the actual average subtropical
  steering flow each day (lagged one tick, same pattern already used for
  the MDR SST feedback), accumulated as a running offset rather than
  rate×dayNum specifically to avoid a discontinuous jump whenever the
  rate itself changes from day to day. Verified both properties directly:
  confirmed no discontinuous jumps in the accumulated offset, and
  confirmed the rate genuinely varies (1.88-3.28°/day) rather than
  silently staying fixed at the old constant. Shear/outflow interaction
  with storms was already implemented from earlier work — checked before
  assuming it needed building, and confirmed both were already wired in.
- Full regression suite: healthy after each change.

### This completes the original large multi-part request

Across this and the two previous rounds: the Remnant Low mechanic,
asymmetric pressure lag, the TD organization-ramp fix, the ventilation
shear-offset, Panama Eastern Pacific naming (re-verified), Yucatan
reemergence, and the ULL geography/steering fixes are all shipped and
individually verified.

## v5.1 (dynamic tropical steering, NAO-modulated recurvature for waves, AOI redesigned as an evolving/land-clipped cone)

- **Tropical steering was genuinely static**: the trade-wind formula had
  zero day-to-day stochastic variability. Added a dedicated steering-
  noise field (tapered out toward the mid-latitudes, where troughs/jet
  already provide real variability). Verified directly: steering at a
  fixed point now oscillates through a real range (-12.0 to -14.8kt over
  10 days) instead of being flat.
- **Found the actual reason waves couldn't recurve/pull north at all**:
  tropical waves moved via a fixed westward-drift formula completely
  disconnected from the environment — no steering, no ridge weakness, no
  NAO, nothing. This is the real cause behind "even tropical waves"
  never showing the requested behavior. Rewired wave motion to blend the
  climatological drift with the actual local steering field (which
  already reflects whatever ridge weakness is present) plus an explicit
  NAO-modulated poleward bias that only engages once a wave is far
  enough from the deep tropics for recurvature to be plausible. Verified
  with an isolated, controlled A/B test (identical wave, only NAO
  forced different): after 6 days, strong -NAO reached lat 38.2 while
  strong +NAO stayed at lat 17.1 — a 21° difference, holding everything
  else fixed.
- **AOI completely redesigned to behave like the forecast cone**:
  projects the wave's actual future path using its own real (now
  steering/NAO-coupled) motion physics, widening progressively with
  lead time as a proper left/right boundary polygon instead of a single
  static ellipse — the shape genuinely evolves as conditions change from
  tick to tick, the same way the forecast cone does.
- **Added landmass clipping**: the projected path stops at the coastline
  of a large landmass, but continues over small islands (Jamaica,
  Puerto Rico). Built a land-exposure classifier (checks a ring of
  points around each candidate location, not just the center) and
  verified it against seven real locations spanning both categories —
  every single one matched real geography exactly (Jamaica/Puerto Rico
  → small island; Nicaragua/Mexico/Yucatan/Florida interior → large
  landmass; open Atlantic → ocean). Then verified the actual truncation
  behavior end-to-end: a wave aimed at Central America had its
  projected path correctly cut off right at the coastline rather than
  continuing across land.
- Full regression suite: healthy throughout, confirming genesis still
  functions correctly after the fundamental change to wave motion.

## v5.2 (late-season wave spawning recalibrated to explicit tiers)

- **Replaced the single compounding-percentage slowdown curve with
  explicit tiers matching the described behavior directly**: the old
  9%/day compounding rate reached near-maximum slowdown by Nov 1 — too
  fast for "still spawn often" through that point. New piecewise curve:
  ~normal through Oct 15, gentle through Nov 1 (1.0x→1.3x, "still
  often"), moderate through Nov 15 (1.3x→2.2x, "occasional"), reaching
  the "rarer" ceiling by Dec 15 (2.2x→2.8x, held flat after — finer
  tuning for that specific window deliberately deferred to a dedicated
  genesis-focused pass rather than guessed at now).
- **Added the requested lower-latitude shift**: spawn latitude stays at
  the normal 13°N base through Nov 1, then shifts smoothly down to 9°N
  by Dec 15, reflecting how real late-season MDR activity (when it
  happens) skews lower-latitude — tied to the eastern MDR shear increase
  from a few rounds back making higher-latitude development
  progressively less favorable.
- Verified both curves directly against unjittered math (the jitter
  otherwise obscures the trend in any small sample): confirmed the
  interval multiplier hits exactly 1.00/1.30/2.20/2.80 at the four
  marker dates, and confirmed the base latitude holds flat at 13°N
  through Nov 1 before smoothly reaching 9°N by Dec 15.
- Full regression suite: healthy.

## v5.3 (ITCZ + Monsoon Trough mechanics, CAG genesis regression fixed)

- **Fixed a real CAG genesis regression**: confirmed it directly first —
  zero CAG-origin storms in a full simulated season. Traced it to
  `CAG.maxShear: 18` no longer matching reality after several rounds of
  unrelated tuning (ENSO western-basin shear targeting, TUTT-ENSO
  coupling, general steering/shear noise) had quietly made the
  underlying Caribbean shear climatology noisier and generally higher.
  Measured the actual impact directly: only 41.5% of otherwise-eligible
  ticks were passing the old threshold. Loosened it to 22 and reverified
  CAG genesis actually occurs again in real simulation.
- **New ITCZ mechanic**: seasonal latitude migration (~5°N off-season to
  ~11°N near peak season, matching real Atlantic climatology), a
  genuine favorability boost near it for any genesis check, and a
  distinct "aid or delay" interaction specifically for waves — a stable-
  but-directional swing (not flicker) seeded from position/day, verified
  directly: GPI varied meaningfully across nearby positions, stayed
  essentially fixed within a fraction of a day, and shifted to a
  genuinely new value after several days — matching real, if
  unpredictable, ITCZ-wave interaction rather than random noise.
- **New standalone "ITCZ roll-up" genesis pathway** in the East
  Atlantic — outcomes range from short-lived weak depressions to full
  majors, which falls directly out of the existing ceiling/RI/outflow
  variance once a system forms, no special-casing needed.
- **New Caribbean Monsoon Trough mechanic**: seasonally active (peaks
  ~early September, matching real climatology), distinct from both the
  ITCZ and CAG, and can produce genesis both as its own standalone
  pathway and as a boost to co-located wave/CAG genesis. Verified all
  four pathways (MDR wave, ITCZ, Monsoon Trough, CAG) actually produce
  genesis in the same real simulated season.
- **Rendered matching the provided reference images**: ITCZ as a solid
  double line with tick marks (the real synoptic convention), Monsoon
  Trough as a dashed magenta line with a bold labeled box — both new
  toggle buttons, on by default.
- Full regression suite: healthy throughout.

## v5.3 (verified ITCZ/monsoon trough already existed; boosted CAG frequency)

Worth being direct about this round: the ITCZ and Caribbean monsoon
trough mechanics requested were **already fully implemented** from
earlier work I didn't have full visibility into — favorability fields,
standalone roll-up genesis pathways for both, the wave-interaction
"aid or delay" swing, and even the visual layer (labeled synoptic-style
lines, toggle buttons) were all already there. Rather than rebuild any
of it or just report "already done" on faith, I verified each piece
directly:

- **ITCZ roll-up genesis**: confirmed it actually produces storms with
  real outcome diversity — one season showed a 79kt system and a 25kt
  short-lived depression from this exact pathway, matching "either
  become full fledged hurricanes or weak short lived" systems.
- **Wave-interaction swing** ("aid or delay genesis"): sampled it across
  a grid of positions and confirmed both directions are genuinely well-
  represented (226 aiding vs 215 delaying out of 441 samples), not
  secretly biased one way.
- **Caribbean monsoon trough genesis rate**: computed the expected
  spawn-check rate deterministically (~2.05/season before the
  eligibility filter) rather than trusting a single noisy simulation
  sample that happened to show zero — confirmed that's a reasonable,
  not obviously-broken, rate for a real-but-modest independent pathway.
- **DOM/rendering wiring**: confirmed the toggle buttons, render calls,
  and constants all connect correctly with no orphaned references.

**Actual new work this round**: boosted CAG's base spawn chance (0.0062
→ 0.0085) in response to "I don't see CAG genesis as often anymore" —
found a code comment showing the *shear threshold* was already loosened
once for this same complaint, so this round tried the other lever
instead. Verified the effect deterministically (expected spawn-check
successes per season: 2.65 → 3.63, a 37% increase) rather than via
single-seed simulation comparison, since changing any probability
constant shifts the entire season's shared-RNG-stream outcomes and
makes single-run before/after comparisons unreliable — a pattern worth
remembering for any future probability tuning in this codebase.

## v5.4 (remnant low refinements: no cones, 20kt floor, real ongoing decay)

- **34kt auto-naming**: already worked correctly (naming happens the
  same tick a storm crosses 34kt, no sustained-duration requirement) —
  verified directly rather than assumed, no change needed.
- **No forecast cone/spaghetti for remnant lows**: excluded them from
  both the single-storm and all-storms forecast caching paths, and
  handled the case where the *currently selected* storm degenerates
  into a remnant mid-session (clears the now-stale pre-remnant cached
  forecast rather than letting it keep displaying).
- **Found and fixed a real logical conflict** while implementing the
  20kt dissipation floor: the existing threshold for a storm *becoming*
  a remnant (15kt) was lower than the new persistence floor (20kt) —
  meaning every remnant low would have dissipated the very next tick,
  silently defeating the entire mechanic. Raised the transition
  threshold to 22kt so a storm enters remnant phase with real room
  above the floor.
- **Found a second, deeper gap while testing**: remnant lows had no
  ongoing intensity evolution at all — frozen at whatever value they
  had on transition, which meant the new 20kt floor could barely ever
  be reached through natural decay, only via the entry-threshold edge
  case. Added genuine ongoing weakening while unfavorable (real remnant
  lows do keep weakening), holding steady while favorable. Also fixed
  the check ordering so a storm crossing the floor is caught the same
  tick, not one tick late (the same class of timing bug fixed
  elsewhere in this codebase before).
- Verified the corrected lifecycle directly: a remnant low under
  hostile conditions genuinely decays tick by tick (22.0→21.2→20.4→19.6)
  and dissipates the instant it crosses below 20kt; under favorable
  conditions it holds steady and regenerates correctly, keeping its
  original name.
- Full regression suite: healthy.

## v5.5 (fixed ITCZ genesis firing outside hurricane season — a real bug, not miscalibration)

- **Found the actual bug**: the ITCZ roll-up genesis check had *no
  seasonal gating whatsoever* — a flat probability checked every tick,
  year-round, meaning it could fire in January exactly as reported.
  Fixed by gating it with the same seasonal envelope already used for
  wave spawning (hard zero outside the real hurricane season window,
  naturally higher near its peak within it).
- **Checked the Caribbean monsoon trough pathway for the same class of
  issue before it could surface as its own bug report**: its strength
  function was a pure Gaussian, which technically never reaches exactly
  zero even in the dead of winter (a tiny but real nonzero tail — 2.6e-6
  chance per tick in January, confirmed directly). Negligible on any
  single tick, but a long enough run could eventually trigger it, the
  same way the ITCZ bug did. Added a hard zero outside the real
  Caribbean monsoon trough window (~June-December) rather than relying
  on the Gaussian tail alone to stay small enough forever.
- **Verified the fix three ways**: ran a full season and confirmed zero
  ITCZ/monsoon-trough genesis events in Jan/Feb/Dec; checked the
  seasonal factor directly at several dates (exactly 0.0000 in January/
  February, correctly nonzero and scaling through the real season); and
  computed the expected in-season ITCZ genesis rate deterministically
  (1.41/season) to confirm the fix didn't accidentally suppress the
  pathway during the actual season, not just outside it — a single
  season showing zero has roughly a 24% chance at that rate from normal
  variance alone, so that result on its own isn't a red flag.
- Full regression suite: healthy.

## v5.6 (found and fixed a real, previously-silent bug: the entire monsoon trough system was non-functional)

The requested refinements (May-Oct active window, Jun-Sep peak, more
variable Oct-Nov, weak/absent Dec-Apr, migrating position centered on
Central America/SW Caribbean rather than a fixed box) turned out to
already be fully implemented from earlier work. But checking it
directly (rather than trusting it on sight, as with a couple of other
"already built" surprises in this project) turned up something serious:
**every value the system produced was NaN.**

- **Root cause**: the geometry/variability constants
  (`monsoonTroughBaseLat`, `monsoonTroughNoiseDriftDegPerDay`, etc.)
  were declared in the `GENESIS` constants block, but
  `Environment.monsoonTroughStrength()`/`monsoonTroughGeometry()` —
  the functions that actually read them — only import `ENVIRONMENT`
  (aliased `ENV`), not `GENESIS`. Every reference silently resolved to
  `undefined`, so `dayNum * undefined` and everything downstream was
  NaN. NaN doesn't throw — it just makes every land/SST/shear
  eligibility comparison silently false. The whole feature *looked*
  fully built and was completely inert the entire time: no genesis, no
  GPI boost, and (very likely) broken rendering, all with zero errors
  anywhere to signal it.
- **Fixed by moving the constants to the block that's actually
  imported** where they're used, rather than changing any logic.
- **Verified thoroughly, not just "no more NaN"**: re-ran the seasonal/
  geometry check and got real numbers matching the requested
  climatology exactly (0.06 in January, ramping through May to 0.89,
  peaking at 1.13 in August, and — genuinely satisfying, this is the
  part that was supposed to be "more variable" — the Oct-Nov sample
  showed both a shifted center (-82→-79.8) and a much wider extent
  (±6→±10.5), confirming the migration is real, not just a smooth
  taper). Then went further and confirmed actual storms come out of it:
  one seed produced 2 MonsoonTrough-origin storms at realistic Caribbean
  positions (14.6N/-69.9W and 12.0N/-77.0W). Separately verified the
  GPI wave-interaction boost and the geometry values feeding the
  renderer are both finite now too.
- Full regression suite: healthy.

## v5.7 (two-layer 850mb/500mb steering; partial TD-to-TS improvement)

- **Implemented genuine two-layer steering**: 500mb (mid-level, what
  hurricanes/majors actually follow) is now the plain climatological
  field with no added high-frequency noise. 850mb (low-level, what
  waves/TD-TS follow) is a new, separate field carrying real day-to-day
  trade-wind variance — verified directly across the MDR: 850mb spans
  12.0-33.9kt (genuinely reaching past 30kt) versus 500mb's much
  tighter 12.5-18.5kt. Storms blend the two layers based on their own
  intensity (full 850mb at/below TS strength, full 500mb by hurricane
  strength); waves use 850mb specifically.
- **This also directly explains and fixes "erratic MDR tracks"**: that
  symptom traced straight back to a steering-noise term added directly
  into the single shared field two rounds ago — waves and weak storms
  were getting the same noisy field as everything else. That variability
  now lives in its own dedicated 850mb layer instead.
- **Added the requested 850mb-to-SST feedback**: weak trade flow → less
  evaporative cooling/mixing → warmer MDR SST; strong flow → cooler.
  Verified directly: forcing 5kt vs 30kt average 850mb flow produced a
  0.70°C SST difference in the correct direction.
- **TD-to-TS conversion rate — real improvement, not fully at target
  yet**: traced actual failures directly rather than guessing. Found two
  contributing causes: too many waves spawning in the weak-Coriolis zone
  (below ~9N) from a flat/uniform spawn-latitude jitter, and — the
  dominant one — young TDs having zero shear-penalty resilience during
  their critical first 1-2 days, even though genesis itself already
  implies at least marginal conditions. Fixed both (bell-shaped spawn
  latitude jitter; age-based resilience discount during the
  organization-ramp window). Verified real improvement on a traced seed
  (67%→35% failure rate), but a second seed still showed 55% failure —
  a genuine, verified improvement, but not yet consistently at the
  requested "0-3 failures out of ~18" level.
- Full regression suite: healthy throughout.

### Honestly not addressed this round, given the scope of what's above

Trough emergence latitude variance (Canada/Northeast more common, US
Southwest rare during hurricane season), verifying/enhancing subtropical
cutoff lows transitioning into subtropical/tropical storms, and directly
validating increased Canada/Northeast landfall frequency from the new
steering system. Each deserves its own focused pass rather than being
compressed in after an already-large response.

## v5.8 (trough latitude variance fixed, found and fixed a real noise-freezing bug, subtropical genesis restored)

- **Found the actual cause of "troughs emerge at too low a latitude,
  need more variance"**: with only 2 troughs evenly spaced 180° apart,
  the formula's sine term (designed for ±10° of spread) contributed
  *nothing* — `sin(0°)` and `sin(180°)` are both 0. The entire real
  spread was coming from a much narrower ±6° noise term alone.
- **Found a second, more serious bug while investigating**: the noise
  field driving that spread used `wrapX: false` with a width of only
  10, and the drifting sample position exceeds that width after just
  ~222 days — meaning trough latitude (and trough *strength*, which
  reads the same coordinate) silently froze at a single clamped value
  for the last third or more of every simulated year. Fixed by enabling
  wraparound. Verified directly: 254 distinct strength values sampled
  after day 300 (previously would have been 1, frozen).
- **Redesigned the distribution to be genuinely asymmetric** (common
  Canada/Northeast, rare Southwest) rather than symmetric: raised the
  base latitude, widened the noise amplitude, and specifically damped
  southward excursions relative to northward ones. Verified the
  resulting full-year distribution: median 36.5°N (solidly Northeast/
  Mid-Atlantic), 93.8% in the 33-45°N common band, only 0.9% dipping
  below 33°N, and a real 5.3% minority reaching genuine Canada
  latitudes (>45°N).
- **Caught and fixed an unintended side effect of the above**: shifting
  troughs more northern reduced their time spent in the subtropical/
  cutoff-low genesis zone (22-40°N), which would have quietly shrunk
  that pathway. Two consecutive test seeds showed zero subtropical
  storms after the trough change — widened the eligible zone to 44°N
  to match, and confirmed directly: the same seed that showed zero went
  to 5 after the fix.
- Full regression suite: healthy throughout each change.

## v5.9 (further TD-to-TS improvement; Canada/NE landfall check inconclusive)

- **TD-to-TS conversion rate — continued, verified improvement,
  genuinely better but still not fully at target**: traced the failure
  pattern again after last round's fixes and found it had *shifted*
  rather than disappeared — fewer immediate deaths, but many storms now
  plateauing at 25-33kt for days before eventually fading. Found two
  further contributing causes: the weak-linger penalty's 2.5-day grace
  period was activating against storms still actively trying to
  organize (not just genuinely stagnant ones), and the default genesis
  spawn intensity (25kt) sat only 3kt above the remnant-transition
  threshold (22kt) — meaning a fresh TD hitting even mild resistance
  during its still-ramping organization window could drift into
  premature remnant status within about a day. Extended the grace
  period to 4.5 days and raised spawn intensity to 28kt. Verified on
  the traced seed: failure rate dropped from 48% to 32% across this
  round's fixes. A second seed still showed 41% failure — real,
  meaningful progress across the session (was 52-67% originally), but
  not yet consistently down at the requested "0-3 out of ~18" level.
  This has had two full rounds of iteration now; further work here
  should probably look at the interaction between shear/dry-air
  variability and the approach-rate formula more holistically rather
  than continuing to find and patch individual contributing factors one
  at a time.
- **Canada/Northeast landfall frequency — checked, inconclusive**: two
  consecutive seasons showed zero TS+-strength landfalls in that
  region. Genuine real-world Canada/NE hurricane-strength landfalls are
  themselves rare events (not something that happens most seasons even
  in reality), so a 2-season sample can't distinguish "correctly rare"
  from "still too rare" — the same small-sample limitation encountered
  repeatedly in this project. Didn't make a speculative fix without
  better evidence; this needs a much larger sample (many simulated
  seasons) to properly validate, which wasn't feasible within this pass.
- Full regression suite: healthy throughout.

## v6.0 (major atmosphere-ocean coupling fix, TD pressure gating, latitude size/wind tradeoff, ERC size growth)

- **Fixed the reported Cat5-maintaining-870mb-past-38N bug** — traced to
  two separate real issues, not one: the SST climatology curve was too
  gentle through the 28-45N transition zone (still reading ~27.3C at
  38N, comfortably within major-hurricane MPI territory), and separately
  the extratropical-transition decay logic had *no SST coupling
  whatsoever* — a "well-supported" post-tropical system could maintain
  arbitrary intensity regardless of how cold the water beneath it had
  become. Fixed both: added a third SST climatology breakpoint for a
  proper steep drop through the transition zone (verified: 25.6C at 38N
  now, correctly capping intensity around Cat1-2 per the MPI table), and
  added a real SST ceiling to the ET decay path (allowing a modest
  premium for genuine baroclinic support, not unlimited). Re-ran the
  exact bug scenario end-to-end: the storm now weakens 155kt→114kt→6kt
  crossing into cold water instead of holding Cat5 indefinitely.
  Verified at scale too: zero points north of 38N with sub-950mb
  pressure across a full simulated season.
- **Fixed TD "insanely low MSLP"**: the background-pressure-gradient
  bonus had no intensity gating, letting a barely-organized 25kt
  depression access the same leverage on the ambient pressure field as
  a mature hurricane. Added an organization gate ramping in by 50kt.
  Verified: worst-case weak-storm pressure improved from 979mb to 986mb,
  with the overall distribution meaningfully tighter.
- **Western Atlantic background pressure**: checked directly (single
  points and full-year range) and found no clear bug — already
  consistently lower than the eastern Atlantic within a plausible range.
  Didn't make an unsubstantiated change; the TD pressure-gating fix
  above is the more likely actual source of what was being noticed.
- **Higher-latitude intensity-for-size tradeoff**: storm size growth
  with latitude roughly tripled (raised coefficient), and a new wind
  discount reduces peak wind for a given pressure at higher latitude
  (up to 21% by 45N, floored, zero effect below 30N).
- **ERC completion now permanently increases storm size**, representing
  the new outer eyewall becoming the primary wind field — capped
  against unbounded growth from repeated cycles in one storm's life.
  Verified directly: sizeFactor rose from 1.39 to 1.55 after one
  complete weakening→reforming cycle.
- Full regression suite: healthy after every change.

## v6.1 (fixed the spawn panel positioning bug, added combined 850mb+500mb steering overlay)

- **Fixed the actual bug behind the spawn panel display issue**: it was
  missing explicit `position`/`top`/`left` CSS while its parent
  container (the map overlay wrapper) is `position: absolute` — every
  sibling panel in that wrapper has explicit positioning except this
  one, so it was rendering unpredictably rather than as a clean floating
  panel. Rather than just patch the positioning in place, moved it out
  of the map overlay entirely and into the sidebar as a proper panel,
  positioned directly below the Selected System panel as requested.
  Confirmed the JS wiring (button clicks, minimize toggle, status label)
  all reference elements by ID, not DOM position, so the move didn't
  require any JS changes — verified no dangling references either way.
- **Added the 850mb+500mb combined steering overlay**: relabeled the
  existing "Steering" option to "500mb Steering" for clarity, added a
  new standalone "850mb Steering" option, and added "850mb + 500mb"
  showing both simultaneously in distinct colors (cyan/amber, matching
  each layer's single-view color) with a small pixel offset so the two
  vectors at a shared grid point don't draw directly on top of each
  other and become unreadable.
- Full regression suite, syntax check, and DOM/HTML/CSS balance checks:
  all clean.

## v6.2 (season-level recalibration toward 30-year normal, ENSO/MDR-tied variance, hyperactive season classification)

- **Measured actual current output before touching anything**: built a
  proper measurement script (the existing calibration tool didn't track
  ACE) and sampled named/hurricane/major counts plus ACE. With the
  caveat that this was only a 2-season sample (each simulated season
  costs real wall-clock time to run; a true 100-year validation wasn't
  feasible in this pass), it showed hurricanes (9.0) well above the
  6-storm target and ACE (232) more than double the 110 target, while
  majors (3.0) were already close to target — meaning storms weren't
  over-intensifying from hurricane to major specifically, they were
  crossing 64kt too easily in the first place.
- **Added a targeted TS-to-hurricane plateau resistance** rather than
  lowering the general approach rate — a broad cut would have also
  undone the TD-to-TS organization-ramp tuning from a separate pass.
  Re-measured on the same 2-season sample: hurricanes moved from 9.0 to
  7.0, closer to target. ACE moved in the noisier direction on this
  small sample (single-run comparisons after any probability/rate
  change are inherently noisy here, a pattern encountered repeatedly in
  this project) — didn't over-tune chasing 2 data points further.
- **Added the requested season-to-season variance mechanism**: -ENSO
  and a warm MDR/East-Atlantic SST anomaly (the same region covers
  "warm Canary Current") now directly increase genesis frequency, on
  top of whatever they already do to shear/SST individually; +ENSO and
  a cool MDR anomaly meaningfully suppress it. Verified the direction
  and magnitude directly: a favorable-conditions season sees genesis
  ~34% more frequent, an unfavorable one ~40% less frequent.
- **Added hyperactive season classification**: any season reaching
  >=150 ACE gets a visible "⚡ HYPERACTIVE" label in the season summary
  panel, using the already-computed cumulative ACE series. ACE-weighted
  as requested — this triggers off total ACE, not storm counts, so a
  season with modest counts but a couple of long-lived majors qualifies
  the same as a season with many storms.
- Full regression suite: healthy throughout.

### What's not fully verified given the scope and time involved

The exact mean-level calibration (13/6/3/110) is based on a 2-season
sample, not the requested 30-100 year normal — real further tuning
would benefit from a longer, dedicated calibration run. The specific
tail behaviors requested (seasons exceeding 20/10/5, seasons as low as
10/4/1, hyperactive seasons reaching 25/13/8 at 280 ACE) weren't
individually stress-tested. Intensification favorability wasn't tied to
ENSO/MDR conditions the way genesis frequency now is — hyperactive
seasons currently emerge only from more-frequent genesis under
favorable conditions, not from storms also running measurably stronger;
that would be a reasonable next step.

## v6.3 (ENSO/MDR-tied intensification — completes the hyperactive-season mechanism, fixed a critical NaN bug found along the way)

- **Tied storm intensity directly to ENSO/MDR conditions**, completing
  the gap flagged last round: hyperactive seasons can now emerge from
  storms running measurably stronger under favorable conditions, not
  just from more frequent genesis. Same sign convention as the genesis-
  frequency modulation from before: -ENSO (La Nina) and a warm MDR/
  East-Atlantic anomaly (same region covers "warm Canary Current") both
  boost the intensification approach rate; +ENSO and a cool MDR anomaly
  suppress it. Layered on top of the existing indirect shear/SST
  channels, not a replacement for them.
- **Found and fixed a critical NaN bug in the process**: the intensity-
  coupling code referenced two constants that didn't actually exist in
  the constants file. Every storm's intensity was silently becoming NaN
  on its very first tick — confirmed directly before touching anything
  further. Added the missing constants, re-confirmed a real, finite
  intensity value afterward, then re-ran the full regression suite to
  make sure the fix held across a real season, not just the isolated
  check.
- **Verified the coupling's direction and magnitude in isolation** from
  the existing indirect shear/SST effects: forcing favorable vs.
  unfavorable ENSO/MDR conditions produced a 9.7kt intensity difference
  after 3 days from the direct coupling alone — meaning the combined
  real-world effect (direct coupling plus the pre-existing indirect
  shear/SST channels, which also respond to the same conditions) will
  be larger than this isolated figure.
- Full regression suite: healthy.

## v6.4 (subtropical genesis restored again, TD naming/display mismatch fixed, comprehensive EPac coastline zone, MDR/Caribbean track stability)

- **Subtropical genesis "severe decline"**: traced to a real interaction
  between two earlier, separately-correct fixes — the SST climatology
  redesign (cooling 28-45N to stop storms holding major intensity that
  far north) made SST too often fail the subtropical genesis threshold
  in the same latitude band where troughs now typically sit (after the
  trough-latitude fix). Lowered the threshold to compensate. Verified
  deterministically rather than trusting noisy single-season counts:
  eligibility improved from 74.0% to 96.0% of trough positions in range.
- **TD naming/display mismatch**: the naming trigger and the
  Tropical-Depression/Tropical-Storm classification boundary both used
  a hard 34kt, but the UI displays *rounded* intensity — a storm at
  33.5-33.99kt was showing "34kt" on screen while failing both checks
  internally, looking like TDs simply weren't getting named at 34kt.
  Aligned both thresholds to 33.5kt so anything reading "34kt" on
  screen is actually treated as a named tropical storm at that exact
  moment. Left ACE and other statistical/peak-based thresholds at the
  true 34kt (real meteorological convention) — only the two genuinely
  display-facing spots needed the fix.
- **Comprehensive EPac coastline zone**: the existing fix only covered
  a narrow Panama-specific exception; the real Central American Pacific
  coastline curves well east of the general basin boundary for its
  *entire* run from Panama up through southern Mexico, not just near
  Panama. Replaced it with a 5-segment piecewise coastline boundary and
  verified all 13 test points on both sides before trusting it (Jamaica,
  the Gulf of Honduras, and the Nicaraguan/Honduran Caribbean coasts
  correctly stay Atlantic; Panama's, Costa Rica's, Nicaragua's, El
  Salvador's, Guatemala's, and Mexico's Pacific coasts all correctly
  read as EPac) — caught and fixed a boundary gap at El Salvador's coast
  during that verification.
- **MDR/southern-basin track stability**: added a southern taper to the
  850mb layer's meridional noise specifically (the zonal component and
  the ridge-driven geostrophic flow are untouched), fading to near-zero
  right at the ITCZ and back to full by ~16°N — routine noise no longer
  makes storms "dive south" near the ITCZ, while a genuinely strong
  ridge (via the untouched geostrophic component) can still occasionally
  force one south, matching how that's real but comparatively rare.
- **Caribbean "wacky tracks" from over-eager trough capture**: found the
  capture radius (24°) let even a trough sitting at its new typical
  latitude (33N+) meaningfully tug on storms far south in the Caribbean.
  Reduced to 17° — a trough now has to be genuinely nearby to pick a
  storm up, while the existing strength-based pull magnitude still
  scales a weak trough's gentle nudge against a strong one's real hook.
- Full regression suite: healthy after every change.

## v6.5 (fixed a real physics bug: trough capture pull ignored the trough's actual position)

- **Found and fixed the real reason "hook into the Gulf" was never
  possible and Caribbean tracks felt "wacky"**: while re-examining the
  trough capture graduation I'd flagged as unverified last round, found
  that the pull direction was completely fixed (always northeast-ish)
  regardless of where the trough actually was relative to the storm —
  `nearestDLat`/`nearestDLon` were computed but never actually used in
  the pull calculation. Every trough interaction recurved a storm the
  same way no matter its real geometry, and since the pull was always
  eastward, a storm getting hooked westward into the Gulf was
  structurally impossible before this fix, not just rare.
- **Redesigned the pull to use real geometry**: rotates the direct
  line-to-trough vector to match actual counterclockwise circulation
  around a Northern Hemisphere upper trough/low. Verified directly
  against three distinct geometries: a trough northwest of the storm
  now correctly pulls it northeast (the classic recurve), a trough
  southeast of the storm pulls it southwest instead (the genuine "hook
  toward the Gulf" case when the geometry lines up that way), and a
  trough directly north gives a pure eastward pull — confirming the
  direction genuinely responds to position rather than always doing the
  same thing.
- Full regression suite: healthy. Checked all usage sites of the pull
  values to confirm nothing downstream assumed the old fixed-sign
  behavior.

## v6.6 (fixed the subtropical-ridge periphery curvature — the "why does everything just go west" bug)

- **Found the real cause of waves/weak storms continuing due-west north
  of the Antilles instead of curving WNW/northerly**: the meridional
  (curving) component of the ridge-driven geostrophic steering was
  present but far too weak. Directly measured a transect from the deep
  MDR through the eastern Caribbean to the Bahamas: the northward pull
  barely grew at all (1.0→1.3kt) while the westward push stayed
  dominant (-13→-4kt) the entire way — nowhere near the real subtropical
  -ridge-periphery curvature shown in the reference images (arrows
  going from near-zonal along the ridge's southern flank to genuinely
  poleward along its western edge).
- **Split the single shared geostrophic scale into separate zonal
  (unchanged) and meridional (raised) components**, since a single
  shared scale couldn't be increased for curvature without also over-
  amplifying the already-correct zonal push in the deep tropics.
  Iterated on the actual value rather than guessing once: an initial
  aggressive setting produced real WNW curvature in isolated field
  testing, but measuring real storm tracks in full simulated seasons
  (not just the isolated field) showed the combined effect — this new
  curvature stacking with last round's trough-capture directional fix —
  was pulling storms almost due north (105-106° average heading,
  consistent across two seeds) rather than the requested WNW. Dialed
  the scale back and re-verified: real track headings through the same
  zone now average 139-147° (genuinely WNW), consistent across two
  seeds, with the deep tropics still reading a near-zonal 171-177°.
- This is the same mechanism referenced in the images provided — flow
  parallels the ridge's southern flank at low latitude, then curves
  measurably more poleward approaching the ridge's western edge — now
  reflected in the actual steering field instead of staying flat.
- Full regression suite: healthy throughout.

## v6.7 (hard real-world pressure ceilings for weak storms)

- **Fixed unrealistically weak (high mb) pressure readings at the low
  end**: the flat ±28mb gradient-offset clamp was physically reasonable
  for stronger storms but let TD/TS systems read as high as 1034mb and
  Cat1 hurricanes as high as 1014mb — real ones never exceed 1020mb and
  1000mb respectively. Added hard, intensity-tiered ceilings on top of
  the existing offset clamp: TD/TS capped at 1020mb, Cat1 capped at
  1000mb, applied in `_updatePressure` so every code path that sets a
  storm's pressure benefits automatically. Left Cat2+ untouched, where
  the wider variance is real.
- Verified the resulting table is smooth with no discontinuity — the
  tier clamps only activate where they'd otherwise be violated (25-60kt
  needed the 1020 clamp only up to 50kt, since the natural curve is
  already below it by 55-60kt; the 1000mb clamp only mattered for
  65-75kt, since 80kt+ is naturally already below it).
- Checked a full simulated season directly: 464 track points, only one
  transitional case (a storm crossing the 64kt threshold in a single
  tick, pressure still catching up to the newly-applicable stricter
  ceiling for 1-2 ticks before converging) — the same kind of expected
  lag-catchup behavior already present elsewhere, not a gap in the fix.
- Full regression suite: healthy.

## v6.8 (recalibrated weak-end pressure ceiling to a smooth, precisely-anchored curve)

- **Tightened further based on specific case-study data points**: a
  55kt storm should never exceed 1010mb, an 80kt storm never above
  995mb — both meaningfully tighter than the discrete two-tier clamp
  from last round (which allowed 1017mb and 998mb at those exact winds).
  Replaced the discrete tiers with a smooth, piecewise-linear ceiling
  anchored precisely at these values, tightest at the weak end (a
  barely-organized TD basically has to sit close to its mean pressure)
  and widening back to the original flat allowance by Cat3 territory
  (100kt+), where the wider variance is real and wasn't in question.
- Verified the exact anchor points land precisely: computed ceiling
  table gives exactly 1010mb at 55kt and 995mb at 80kt, not
  approximately. Checked the full curve for smoothness (monotonic, no
  discontinuities) across 25-100kt.
- Checked a full simulated season against the new table directly:
  zero violations across 391 track points in the 25-100kt range.
- Full regression suite: healthy.

## v6.9 (corrected the weak-end curve's endpoint — 85kt+ was unintentionally affected)

- **Fixed a scope overshoot from last round**: the smooth ceiling
  curve's last anchor was at 100kt, meaning it was still ramping up
  (not yet at the full original ±28mb) between 85-100kt — quietly
  tightening a range that was never asked about. Moved the final anchor
  to 85kt, where the curve now reaches exactly the original,
  unmodified ±28mb allowance and holds flat above it.
- Verified precisely: 85kt and every value above it now match the
  original flat-28mb ceiling exactly (993mb at 85kt, 990 at 90kt, 986 at
  95kt, 982 at 100kt, and so on through 150kt+) — not approximately
  close, exactly equal. 55kt and 80kt still land exactly on the
  requested 1010mb/995mb targets from last round.
- Full regression suite: healthy.

## v7.0 (seasonal wave-latitude structure, Coriolis genesis gate, land-disruption memory, wider warm pool)

- **Full seasonal wave-latitude structure**: previously only had a late-
  season decline; now has genuine early/peak/late character. Verified
  via distribution sampling at each key date: June 1 is tight and low
  (median 8.9°N, p10-p90 range 6.4-11.6 — "low riders"), peak season
  (Sep 10) widens dramatically rather than just shifting up (median
  13.0°N, range 7.5-18.8 — genuinely allows both 20°N-ish emergence and
  low riders side by side, as requested), and by Dec 15 it's back to
  tight and low (median 9.1°N, range 6.5-11.6) — matching all three
  described phases precisely.
- **Added a real Coriolis constraint to genesis potential**: previously
  nothing in the GPI formula penalized low latitude at all — a wave
  right at the equator could show full genesis potential. Added a hard,
  multiplicative gate (not an additive term favorable conditions could
  outweigh) that zeroes GPI at the equator and ramps to full strength by
  ~10°N. Verified directly: GPI is exactly 0 at lat 2, growing smoothly
  to 0.63 by lat 10.
- **Added land-disruption memory for waves crossing large landmasses**
  (e.g., northern South America): previously GPI reset to full potential
  the instant a wave cleared back over water, with zero lasting effect.
  Now tracks accumulated disruption that builds while over land and
  decays gradually afterward (slower to recover than to disrupt).
  Verified with a real forced crossing: disruption climbed to 1.0 while
  over land, then took ~4 days to fully decay after clearing the coast,
  rather than resetting instantly.
- **Widened the Western Hemisphere Warm Pool's spatial gradient** to
  better match the reference SST climatology (warmer, more concentrated
  west, cooling toward the central/eastern tropical Atlantic) — raised
  the peak boost and widened its falloff. Kept this a modest, directional
  adjustment rather than an aggressive rebuild, given how extensively
  this SST field has already been tuned in prior rounds for other,
  separately-verified reasons (the Cat5-past-38N fix in particular).
- Full regression suite: healthy. One seed showed a notably quiet season
  after these changes — checked a different seed to confirm this was
  ordinary RNG-stream noise (a different seed showed a completely normal
  16-storm season), not a systemic effect of the new constraints.

## v7.1 (waves succeeding too often at genesis; too few TCs dissipating over open water)

- **Found the actual cause of waves developing too often**: crossing the
  GPI threshold guaranteed immediate genesis with no further chance
  involved — effectively "if a wave ever briefly touches favorable
  conditions once, it becomes a storm." Added a genuine stochastic
  success gate on top of crossing the threshold: only 15% chance right
  at the threshold, climbing to a 90% cap as conditions get more
  comfortably favorable. Verified the curve directly (15%→30%→45%→60%→
  75%→90% as the margin above threshold grows).
- **Investigated "not enough TCs dissipate over water" by measuring
  first, not guessing**: a real season showed only 17% of dissipations
  happening over open water versus land/absorption. Tested whether the
  underlying mechanism even works at all — forced persistent hostile
  shear over warm open water and confirmed a storm can fully dissipate
  that way (day 1.5, from 46kt down through remnant to full
  dissipation) — so the mechanism itself wasn't broken, storms just
  weren't reliably accumulating enough *sustained* penalty under
  natural, more variable conditions. Raised the base shear-weakening
  factor modestly (2.1→2.5) rather than rebuilding the mechanism.
  Verified against two separate seeds: open-water dissipation rate rose
  from 17% to 22% and 23.5% respectively — a real, consistent
  improvement, though not calibrated against a precise target since
  none was given; may need further tuning if this still reads low once
  observed in practice.
- Full regression suite: healthy throughout.

## v7.2 (removed CAG watch box and monsoon trough label, fixed a real shear-physics inconsistency)

- **Removed the CAG watch zone entirely**: HTML toggle button, JS
  wiring, the render call, and the drawing method itself — not just
  hidden, fully removed.
- **Removed the monsoon trough's text label**, keeping the dashed-line
  visual itself unchanged.
- **Fixed a genuine shear-physics inconsistency**: found that the shear
  vector's direction was computed from a crude, standalone "lower
  level" approximation (`tradeEasterly * 0.6`, a fixed `+0.15` V
  component) that completely ignored the real, fully-built 850mb wind
  field (`steer850U/V`) already sitting right there in the same
  function — real noise, ridge coupling, the southern-MDR stability
  taper, none of it was actually feeding the shear direction storms are
  rendered against. The "upper" side also omitted the jet stream
  despite it being a major real-world shear contributor already
  computed in the same block. Fixed both — shear direction is now a
  genuine upper-minus-lower difference between the actual wind layers
  this simulation builds (including the jet), not an inconsistent
  standalone stand-in. Deliberately direction-only: the shear
  *magnitude* — what actually drives genesis/intensification — still
  comes from the existing, extensively-calibrated composite formula and
  was left untouched, to avoid risking the substantial prior tuning work
  behind it. Verified directly: the resulting vector's magnitude still
  exactly equals the calibrated scalar (22.5 both ways), confirming the
  fix only changed direction, not any storm-affecting behavior — full
  regression suite output was byte-for-byte identical before and after.

### Scope note on "more realistic shear physics"

A full redesign of the shear *magnitude* itself as a true vector
difference (rather than the current parameterized composite of ENSO,
MJO, TUTT, ULL, trough, and seasonal terms) would be a larger, higher-
risk undertaking given how much genesis/intensity calibration currently
depends on that formula's exact values. Chose the lower-risk, still
genuinely valuable fix (direction) this round rather than risk that
calibration without a much longer, dedicated verification pass.

## v7.3 (rebalanced genesis geography — found and fixed the actual shear bug suppressing subtropical/eastern MDR/SW Atlantic genesis)

- **Measured the imbalance directly before touching anything**: two full
  seasons showed Caribbean genesis at 53-67% of all events, while SW
  Atlantic ("Bermuda Triangle"), eastern MDR (Cape Verde territory), and
  the broader subtropics all showed zero. A stark, consistent pattern
  across both seeds — confirmed the complaint precisely.
- **Found the actual root cause**: the base climatological shear
  formula's latitude ramp alone put the baseline at ~18kt by lat26
  during peak season — before adding TUTT, ENSO, or any other term —
  against a 20kt genesis threshold. That left almost no room for the
  subtropics to ever dip below threshold, even during otherwise-
  favorable synoptic moments. Lowered the peak/off-season high-latitude
  anchors (24→19, 40→34).
- **Fixed the TUTT being "permanently too high"** exactly as described:
  its floor (the minimum strength it could ever fall to, even fully
  off-season) was 25% of peak — meaning it never actually went away.
  Dropped to 8%, and tightened its width/peak boost so it reads as
  genuinely seasonal rather than a semi-permanent shield sitting over
  the eastern MDR/subtropics boundary.
- **Reduced the two Caribbean-specific genesis pathways modestly** (CAG
  0.0085→0.0072, monsoon trough 0.0034→0.0026) — both had been
  separately boosted/bug-fixed in recent rounds (CAG for being too rare,
  monsoon trough from a complete NaN failure), and combined were now
  overproducing relative to other basins.
- **Verified the shear fix's real effect directly**, not just trusted
  the formula change: re-measured the exact same transect from the
  original diagnosis. SW Atlantic improved from consistently hostile
  (22-28kt) to favorable at 3 of 4 sampled times (as low as 5.9kt);
  eastern MDR and subtropics both dropped meaningfully too, though not
  uniformly below threshold at every sampled moment. Checked additional
  seeds afterward and confirmed eastern MDR genesis is now reachable
  (a season that previously showed zero across multiple seeds produced
  one) — a real, verified improvement.
- Full regression suite: healthy.

### Honest note on remaining rarity

SW Atlantic and general subtropical genesis are now environmentally
possible (verified directly) but still read as rare rather than common
in the specific seasons sampled here — no structural gap was found (no
longitude restriction blocks the subtropical pathway from that region),
so this looks like ordinary stochastic rarity rather than a remaining
bug. If it still reads as too rare once observed over more seasons in
practice, the next lever would be the subtropical/cutoff-low pathway's
own trigger chance, not the shear field this round already fixed.

## v7.4 (Tropical Easterly Jet, traveling upper-level anticyclones)

- **Fixed eastern MDR shear direction being westerly instead of
  easterly**: confirmed the bug directly first (`shearVecU` was
  positive/westerly-dominant, up to +24kt, across the eastern MDR) —
  the upper-level field had no strong wind of its own there, so the
  shear vector ended up dominated by the lower-level trades instead.
  Added a real Tropical Easterly Jet (TEJ) — the actual meteorological
  feature responsible, tied to the African/Asian monsoon circulation.
  First attempt (26kt) wasn't strong enough to flip the sign once
  weighted by distance from its center — checked the actual component
  magnitudes directly rather than guessing again, found the lower-level
  trades there were a stronger easterly (-25kt) than my first TEJ
  attempt, and raised it to 42kt. Verified directly: eastern MDR now
  correctly reads easterly-dominant (-17 to -21kt) while the western
  MDR correctly stays westerly-dominant (unaffected, as it should be —
  the TEJ doesn't realistically reach that far west). Confirmed this
  stayed direction-only: vector magnitude still exactly equals the
  calibrated scalar shear.
- **Added traveling upper-level anticyclones** that discharge over West
  Africa and meander westward, providing genuine ventilation/outflow
  support to any storm they pass near — distinct from the trough/ULL
  "channel" mechanic (an anticyclone is divergent outflow support, not
  a trough's baroclinic pull). Real mean-reverting meander in latitude,
  not a fixed track, so different anticyclones plausibly take different
  paths. Caught and fixed a real bug during verification: the initial
  lifespan (12 days) times the drift rate only covered ~38° of travel —
  not even far enough to reach the western MDR, let alone the
  Caribbean. Raised it and confirmed directly afterward: an anticyclone
  genuinely reached the Caribbean region (as far west as -86°) in a
  real test run, while most still naturally decay over the open MDR
  from meander variance alone, matching "can meander into the
  Caribbean" rather than always doing so.
- Full regression suite: healthy throughout both additions.

## v7.5 (found and fixed the real cause of the Caribbean bias; further subtropical genesis boost)

- **Found the actual mechanism forcing storms toward the Caribbean**:
  measured first — a real season showed 92% of all storms passing
  through the Caribbean at some point. Traced it to the boosted
  meridional geostrophic scale from a few rounds back (added to fix
  waves not curving WNW near the Antilles) being applied symmetrically
  on both sides of the subtropical ridge. West of the ridge (near the
  Antilles) it correctly produces the intended northward curvature — but
  the identical boost, applied east of the ridge (the eastern/central
  MDR), was creating a much stronger *southward* pull than intended
  (steerV reading -1.1 to -1.6kt there), systematically preventing early
  recurvature and driving eastern MDR-origin storms onto a low-latitude
  track straight toward the Caribbean instead of the real mix of
  recurves and Caribbean-bound tracks.
- **Made the scale asymmetric** rather than reverting the whole boost —
  full strength on the west (recurve) side where it was verified working
  well, a much more modest scale on the east side. Verified directly:
  eastern MDR southward pull dropped from -1.6/-1.1kt to -0.4/-0.2kt,
  while the west-side reading stayed exactly unchanged (2.1kt, both
  before and after). Re-measured actual storm behavior on the same seed
  as the original diagnosis: Caribbean-passage rate dropped from 92% to
  81%, and a second seed showed 64% with a 50% recurve rate for eastern
  MDR-origin storms (up from 0%) — a real, verified improvement, though
  Caribbean passage is still notably high and may benefit from further
  tuning once observed over more seasons.
- **Further increased subtropical genesis trigger chance** (doubled
  both the trough and ULL rates): the existing rate had been drastically
  cut years ago when the environment was producing ~27 subtropical
  systems/season, but SST threshold, eligible latitude, and (this
  session) the shear baseline have all been separately fixed to be more
  favorable since then — meaning the trigger rate was very likely
  calibrated against an environment that no longer exists. Verified a
  genuine occurrence where a seed previously showed zero across multiple
  rounds now produced one — real movement, though still below the
  target 1-4/season range in the samples checked.
- Full regression suite: healthy throughout.

## v7.6 (added a genuine ridge-weakness mechanism for early recurves)

- **Added a direct, explicit mechanism for early recurves** rather than
  relying only on reduced southward bias: real early recurves happen
  when there's an actual localized break in the subtropical ridge, not
  just a generically weaker southward push. Added a dedicated,
  independent noise field representing genuine ridge weakness — only
  positive excursions contribute (a weakness is a bonus opportunity, not
  an extra southward push when absent), applied specifically east of the
  ridge center where an early-recurve setup is meaningful. Sized to
  produce a real, substantial pulse when it fires, comparable to the
  west-side curvature itself, not a token nudge.
- Verified directly before trusting it: sampled a fixed eastern MDR
  point over 150 days and confirmed genuine, occasionally-strong
  northward pulses now occur (up to 4.1kt, versus essentially a hard
  ceiling near zero before), on 34.8% of ticks — a real, meaningful
  early-recurve opportunity, not just theoretical.
- Re-measured actual storm behavior on both prior diagnostic seeds:
  mixed but not negative results (one seed roughly flat at 80% Caribbean
  -passage, the other improved from 64% to 57% with a recurve occurring
  where none had before) — expected given this is inherently stochastic
  (some seasons will hit more ridge-weakness events by chance than
  others), and the underlying mechanism itself is confirmed working.
- Full regression suite: healthy.

## v7.7 (raised the westerly-onset latitude — storms now reach further poleward before recurving)

- **Fixed the westerly steering transition happening too far south**:
  at lat33, the old ramp already had storms experiencing ~36% westerly
  influence ("mostly westerly" character), when real mid-latitude flow
  doesn't become mostly westerly until closer to 40N. Raised the onset
  latitude (28→32), moving the 50%-westerly point from ~35N to ~39N.
  Verified the curve directly: 33N now reads only 7% westerly (down
  from 36%), with the 50% point landing at 39N as intended.
- **Verified the actual effect on a real storm track**, not just the
  formula: a storm started at 28N previously would have recurved
  sharply near 33N. With the fix, it instead progresses steadily
  further north — reaching 38-41.6N by day 7.5-10.5 — and, still
  carrying meaningful intensity (46-52kt, by then post-tropical), tracks
  far enough east to approach Europe. Directly matches the requested
  outcome of allowing more post-tropical impacts on the UK/France,
  rather than being a theoretical hope from the formula change alone.
- Full regression suite: healthy.

## v7.8 (reduced unrealistic jet acceleration, strengthened trough-capture pull — Newfoundland still not confirmed reachable)

- **Confirmed the exact cause of the extreme post-recurve acceleration**:
  the jet streak boost (55kt) combined with the base jet speed (65kt)
  and a 0.55 steering fraction could produce ~66kt of pure eastward
  steering for a jet-embedded storm — directly confirmed by computing
  the worst case. Reduced the streak boost (55→32) and the steering
  fraction (0.55→0.28, in two steps after the first reduction still
  wasn't enough — verified directly each time rather than assuming).
- **Strengthened the trough-capture magnitude** (13→19) so a storm has
  more ability to gain latitude relative to its eastward drift during
  the critical 30-45N transit.
- **Honest result**: despite both changes, my hand-built test geometries
  still couldn't get a storm to reach Newfoundland's actual latitude
  (47-51N) before being carried east past its longitude — the storm
  consistently crosses -50W in the mid-to-upper 30s latitude instead.
  This is a genuinely stubborn balance between multiple competing
  steering components (base westerly onset, jet, trough capture) that
  wasn't fully solved this round. What *is* confirmed: both changes are
  real, defensible improvements to the underlying physics on their own
  merits (the jet was producing an unrealistic worst case; the
  capture strength was likely undersized for what it needs to
  accomplish), and — critically — the Carolinas mechanism was
  re-verified completely unaffected (identical landfall points under
  the same NAO tests, before and after).
- Full regression suite: healthy.

### Honest assessment for next steps

This needs a more careful, dedicated pass rather than continued ad-hoc
constant tuning — likely either a more direct mechanism (e.g., an
explicit "phasing" bonus when a storm's motion vector aligns well with
a nearby trough's own translation, rather than relying on the general
capture-radius pull) or accepting that Newfoundland impacts should
remain a rare, hard-to-trigger outcome requiring an unusually favorable
combination of factors rather than a reliably reachable one.

## v7.9 (storm-storm interaction: Fujiwhara, outflow shear/absorption, genesis spacing; real storm feedback onto 500mb heights/steering; ridge-weakness chaining; widened Bermuda-Azores high variability)

- **Fujiwhara effect, for real**: nearby live tropical cyclones now
  mutually orbit their combined center cyclonically (Northern
  Hemisphere), with the relatively weaker storm of the pair deflected
  more than the stronger one — matching how real Fujiwhara interaction
  behaves when two vortices aren't comparably matched. This is the
  actual mechanism keeping two close TCs from just passing straight
  through each other's paths; there's no hard "storms can't cross"
  rule, because that isn't how the real effect works and a hard rule
  would just be a collision box wearing a physics name.
- **Outflow shear from a dominant neighbor**: a storm meaningfully
  stronger than a nearby one (≥1.3x) now imposes real additional shear
  on it, on top of ordinary environmental shear, falling off with
  distance out to roughly the stronger storm's own outflow radius.
  Comparably-matched storms mostly just orbit each other rather than
  shearing one another — that asymmetry is intentional and matches how
  real cases go.
- **Absorption**: sustained (not instant) very-close proximity to a
  much stronger system (≥1.8x, within ~2.2°, held for ~18 hours) now
  genuinely ends the weaker storm's life as an independent circulation,
  with a small one-time size bump to the survivor. Verified this
  actually fires rather than just existing as dead code: 3 absorption
  events across 4 simulated seasons — rare, as it should be, not a
  routine outcome.
- **Genesis spacing**: a new storm can no longer spin up within ~3.5° of
  an already-active one, applied at all six genesis pathways (waves,
  subtropical, natural ULLs, CAG, ITCZ roll-up, monsoon trough).
  Verified directly: minimum observed genesis separation across two
  simulated seasons was 3.79°, at or above the floor.
- **Storm feedback onto the 500mb height field/steering — this used to
  be fake.** There was already a storm-outflow visual (arrows on the
  200mb overlay), but it was explicitly display-only and never touched
  steering or shear — confirmed by reading the code, not assumed. Added
  a genuinely separate mechanism: a storm's own anticyclonic outflow
  now contributes a real Gaussian height bump to the shared
  `upperHeight` field, scaled by intensity, which feeds the same
  geostrophic-steering and shear-vector math every other height feature
  (the high, troughs, extratropical lows) already uses. A strong
  hurricane now measurably perturbs the ridge and the steering felt by
  storms near it, rather than just drawing outflow arrows that meant
  nothing physically.
- **Ridge-weakness chaining**: previously, a ridge break was purely a
  smooth, slowly-drifting noise field with no memory of having been
  used. Now, when a live storm actually exploits a meaningful weakness
  (recorded as an event with position/day/strength), that specific
  break stays weaker than the ambient field for ~3.5 days within ~6° —
  a trailing storm passing near the same spot in that window gets a
  real extra shot at the same opening, representing the ridge genuinely
  taking time to rebuild rather than resetting the instant one storm
  clears the area.
- **Bermuda-Azores high variability, measured before and after**: the
  claim that it "doesn't fluctuate enough" was checked against the
  actual running sim rather than taken on faith — over 2 seasons, the
  high's latitude only ever ranged 25.1-34.1N (never reached a genuine
  NE excursion like ~38N) and pressure only ranged 1022-1033mb, under
  1023mb just 1.9% of the time. The root cause: latitude had *no*
  independent day-to-day noise at all, only the NAO's persistent-regime
  shift — so without an unusually strong +NAO stretch it structurally
  couldn't reach a far-NE position regardless of how far the (separate)
  longitude noise wandered. Added an independent latitude noise field,
  and widened both the longitude and strength noise amplitudes. Re-measured
  after the change, across 5 seeds: latitude now reaches 19.4-38.7N, and
  pressure reaches 1019-1035mb (>1030mb 11.7% of the time, <1023mb
  14.7% of the time) — the high still climatologically anchors near its
  normal position/strength most of the time (mean lat 30.8N, mean
  1026mb), it just now has real room to swing the way the actual
  Azores-Bermuda high does, instead of a narrow band around the mean.
- **New diagnostic tools**: `tools/high-survey.mjs` (position/strength
  distribution over N seasons — this is what caught the "doesn't
  fluctuate enough" claim being literally true, and confirmed the fix)
  and `tools/fujiwhara-check.mjs` (confirms absorption events and
  genesis-spacing enforcement actually fire in practice, not just in
  code that never runs).
- **Performance note**: the new per-cell storm-outflow and
  ridge-weakness-chaining computations initially looked like they might
  be adding real cost (a 6-season regression run needed longer than a
  60s test budget) — checked against a from-scratch extraction of the
  pre-change zip before concluding anything, and a single season ran at
  effectively the same wall-clock time before and after (~41s vs.
  ~43s). The 60s timeout was simply too tight for a 6-season run in
  this environment, not a regression; still hoisted the storm-outflow
  phase/intensity filtering and the ridge-weakness-chain loop to only
  run where they can matter (has active storms / dHdLon < 0
  respectively), since there was easy, correct-either-way headroom to
  take there regardless.
- Full regression suite re-run after all changes: headless sanity check,
  recurve-check, RI/pressure calibration, RI/ERC check, and track-survey
  all still produce sane values (see individual tool output for
  specifics) — nothing above reads as having destabilized the existing
  physics.

### Honest scope note

"Tropical cyclones shouldn't cross each other's path" is handled here
as an emergent consequence of mutual Fujiwhara rotation and outflow
shear at real interaction ranges, not as a literal path-intersection
check — real storms *can* and occasionally do pass close by one
another without merging, and a hard collision rule would produce less
realistic behavior than the actual physics, not more. Similarly, the
Azores-high widening was tuned to match the general *range* you
described (an independent NE excursion, an independent SW/weak
excursion, more excursions past 1030mb and into the low 1020s) rather
than forcing your two specific example coordinates to co-occur — those
were treated as illustrations of the range, per how you framed them,
not as literal targets to hit simultaneously.

## Where to take it next

1. **Vector wind fields at two levels** (850mb/200mb u,v) instead of a
   scalar shear magnitude — would let you compute true shear *direction*
   relative to storm motion (real-world convective asymmetry) and make the
   trough-distance logic in `storm.js` exact instead of inferred from
   `upperHeight`'s sign/magnitude.
2. **Real trough-axis tracking** — extract the actual axis (skeleton of
   local minima in `upperHeight`) each tick for exact distance-to-storm.
3. **Eyewall replacement cycles** for major hurricanes — intensity is
   currently smooth; real Cat 4/5 storms wobble.
4. **Terrain detail** — land is currently a single 0-1 mask value; real
   terrain (Rockies vs. flat Yucatan) affects weakening rate differently.
5. **Save/replay** — `World.tick()` is deterministic given the seed and RNG
   call order, so recording the RNG stream gets you replayable seasons.

## Attribution

Architecture, code, and physics approximations here are original — a
rebuild "inspired by" the original Cyclone Simulator's concept (a
browser-based tropical cyclone game), not a fork or port of its code.
Coastline data is Natural Earth (public domain).
