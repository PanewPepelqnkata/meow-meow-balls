# BALL RUSH — Implementation Checklist

Version: 0.2 (updated for menu + gameplay reference screenshots — awaiting user review)
Each phase ends with a review checkpoint. Do not start the next phase until the
previous phase's acceptance criteria pass and the user signs off.

---

## Phase 0 — Scaffolding
- [x] Vite + React + TypeScript project (strict mode), ESLint + Prettier.
- [x] Phaser + Matter.js installed and booting into an empty scene.
- [x] Repo structure per ARCHITECTURE.md §2; placeholder config files.
- [x] **Finalize the logical stage size**: decided **720×1280** — calculation-based
      (docs/STAGE_SIZE.md), centralized in `src/config/stage.ts`; still to be
      confirmed on physical devices before Phase 10.
- [x] CI-able `npm run build` + `typecheck` + `lint` scripts pass.

**Accept:** app renders a colored clear screen on desktop and mobile browser; typecheck strict passes; stage size decision documented.
**Status (Phase 0 complete):** all checks pass (`typecheck`, `lint`, `test` 5/5, `build`, dev-server smoke test, lockfile `npm ci` dry-run). Visual on-device confirmation of scene render/resize is pending the user's browser review.

## Phase 1 — Physics Playground (no art)
- [x] Standalone Matter engine stepped by Phaser update; `config/physics.ts` centralizes all tunables.
- [x] Static container walls (side walls with open top, clear bottom) per config (`config/container.ts`; striped prototype visuals in `rendering/ContainerView.ts`).
- [x] Drop balls by pointer; balls collide, stack, rest credibly.
- [x] Fixed 60 Hz step with accumulator (bounded catch-up, `systems/PhysicsWorld.ts`).
- [x] Minimal Ball entity + BallManager (model + body; visuals synced from physics truth).
- [x] Ghost ball + clamped drop position + drop cooldown (`systems/InputSystem.ts`, pure math in `inputMath.ts`).
- [x] Dev-only debug overlay (D key: colliders, container bounds, body count, steps/s; dead-code-eliminated from prod build).
- [x] 10/10 required regression tests pass (incl. 30-ball/60s soak, frame-time variation, reset/disposal, input mapping/clamping).

**Accept:** 30+ balls stack stably for 60 s without tunneling, jitter explosions, or resting-bounce; 60 fps on a mid-tier mobile device.
**Status (pending user review):** soak test passes in headless simulation (30 balls, 70 s simulated, all settled, none escaped); typecheck/lint/tests/build green. ⚠️ On-device 60 fps NOT yet measured — requires physical-device check.

## Phase 2 — Ball Entities & Tiers
- [x] `ballTiers.ts` with 10 entries; tiers 8–10 marked **reserved** (no spawn, no unlock path). Tier-7 pairs are HELD (no invented tier-8 merge) — documented in config + MergeSystem.
- [x] `Ball` model + `BallManager` (create/destroy, body↔model map, pooled).
- [x] Runtime vector-rendered balls per ART_DIRECTION §3 (outline, shade, highlight, layered face) — cached textures per tier (`rendering/BallTextures` in `BallRenderer.ts`).
- [x] Squash-and-stretch on impact; idle wobble (`rendering/deform.ts`, pure + tested); blink/expression state machine deferred to polish phase.
- [x] MergeSystem: collision-driven merges tiers 1–6 → 2–7, duplicate guards, chain window scoring, sleeping spawn to avoid same-frame re-trigger.
- [x] ScoreSystem: tier scores from config, chain bonus (2^depth, cap 8×), reset per run, typed `state:score` events.
- [x] Merge FX: pooled colored particle burst + floating score popup (`rendering/ScoreFeedback.ts`).
- [x] Grid background (light gray, visible through clear interior) + playful striped container (`rendering/ContainerView.ts`).
- [x] In-canvas NEXT preview + score text (temporary until React HUD phase).
- [x] Merge + soak regression tests (29 tests total incl. merge stress soak with mass conservation).

**Accept:** each tier visually distinct; deformation reads as cartoon but collisions stay rigid; no per-frame allocation churn in renderer.
**Status (pending user review):** typecheck/lint/tests 30/30/build green; merge stress soak passes (30 balls, 60s, merges active, mass conserved, stable). ⚠️ Visual appearance NOT verified — screenshot captured but not inspectable in this environment; requires user browser review.
**Phase 2.24 (SpriteBalls — per-tier baked slime sprites, iPhone 42fps fix):** device profile showed render >12ms at baked≈0 with the live Graphics path streaming ~1,150 triangles/ball/frame (fillPoints + strokePoints, non-batched). Rebuilt the renderer around BATCHED SPRITES: ONE fill+outline texture pair per TIER (tier 1–7), baked once at rest geometry (round contour through the same wobble pipeline, tier color + ink outline) at 256px radius and rasterized via Graphics.generateTexture (`rendering/TierBaker.ts`); every ball renders as two batched quads (fill 9.5 / outline 10.5) scaled by liveR/256. DEFORM = TRANSFORM-ONLY: the particle-bounds aspect (h/w, the same signal the old contour path fed the face) drives scaleX on the fill quad — no steady-state contour re-tessellation. IMPACT OVERLAY (`rendering/WobbleOverlay.ts`): while a ball's aspect < 0.955 (real impact transient; rest churn ≥0.96), its LIVE wobbled contour draws through one shared Graphics at depth 9.6, bounded to the top-3 most-deformed balls/frame (sprite quads hide for those frames) — the dent/bulge look survives exactly where it matters, the settled pile is 100% batched. FACES (`rendering/FacePool.ts`): per-ball 3-texture atlas (sclera/pupil/mouth) baked once at registration, 5 pooled quads/ball at depth 11; gaze (glance timeline) repositions pupils per frame; easter-egg expressions + panic morph + sweat fall back to the live face draw for that ball only. TIERS 8/9 keep the live path (rainbow Date.now() shimmer / fantasy procedural extras) and bake PER BALL via TierBaker.bakeLiveContour when asleep (the BallBaker approach survives for exactly these two tiers — BallBaker.ts itself deleted, replaced). API preserved: bakedSize/isBaked now report SPRITE counts (acceptance: WALL line reads sprite counts through the same fields); dropBake/suspend/resume kept (dropBake drops only tier-8/9 per-ball bakes). QA: `spriteView` dev hook exposes live sprite transforms. Gates: 243/243 tests, tsc, eslint, build; headless probes (qa/_spriteballs-probe.mjs): settled balls render as sprites (isBaked true, drawn==registered), impact frames show sprite scaleX≠scaleY, merges complete with STABLE texture counts (no per-merge leak), sclera pixels verified on canvas, zero page errors.
**Phase 2.9.7 (physics stabilization + art style):** live instrumentation found maxPen 39.9px on 4-4 pairs, 308/1011 frames with >1px overlap (30%). Root cause: pressureAcceleration 10 + rim/brace 0.35 — the pressure pushed particles INTO contacts faster than the solver resolved them, and the soft ring folded under load instead of resisting. Fix: rim 0.85, braces 0.85 (structural stiffness — softness comes from damping/restitution, not a floppy ring), pressureAcceleration 4 (reduced — less fighting), contact separation cap 2→15px + two passes, and a boundary clamp (clampToContainer) after separation (separation was pushing particles through walls/floor without it — caused 16 escaped particles). Measured after: maxPen 34.3 (23% of r=75 vs 53%), frames with pen>1px: 6/1011 (0.6% vs 30%), escapes 0. Resting jitter 0.29-0.34 (stable, no growth). Fall speed 13.6/14 (preserved). Art: irregularity 3→2 harmonics, amplitude reduced to ±1.5% radius (Ball Guys subtle organic asymmetry; worst ratio 1.056); face enlarged (0.2→0.28 radius) with bigger sclera, offset pupils, cleaner highlights and wider smile per reference proportions. Captures: refference/captures/2.9.7-BEFORE-*.png (before), 2.9.4-case*.png and 2.9.6-*.png (after). 81 tests pass (4 new).
**Phase 2.9.6 (hand-drawn slime, larger small tiers, Raise Walls):** (1) Sizes: t1 34→38 (+12%), t2 44→48 (+9%), progression monotonic 38→48→57→75→97→126. (2) Walls: normal height 660→475 (−28%), floor y=1085 unchanged, rim y=610; WallAnimator (new) animates height 475↔660 over 900ms with smoothstep, holds 25s, collider vertices updated per-frame via setPosition+setVertices, ContainerView.redrawWalls syncs stripes from the same geometry. HUD 'Extend Walls' slot wired: tap → activate() → countdown overlay (WALLS Ns), no re-trigger while active, reset on restart. Lowering sweep nudges particles below the rim. (3) Hand-drawn contour: per-ball seed → 3 low-frequency harmonics (3/5/7 waves, ±1.3–2.6% of radius) applied along deformed contour normals — deterministic, subtle (worst ratio 1.056), rides compression. (4) Softer feel: rim 0.35, braces 0.35, damping 0.16 (retained; softer values caused floor-tunneling collapse — particle body radius must stay at the visual ring, collisionOutset moved to the contact-separation distance only). Center density 0.0012→0.0003 (light center: heavy center pressed the ring flat at rest). Settle pass: center velocity zeroed when area at rest (killed the 0.9px/step sink). CRITICAL FIX: putting collisionOutset in the ring-radius math collapsed every ball (particles r 15.9 on ring 18.1) — ring layout uses the visual radius only. Live captures: refference/captures/2.9.6-*.png (9 shots: falling, resting, irregularity, walls normal/raising/raised/ball-inside/lowering/normal-again). 77 tests pass (3 new: wall lifecycle, size progression, irregularity determinism).
**Phase 2.9.5 (emergency regression fix — slow falling):** live vy trace caught balls falling at a constant 0.44px/step (gravity gain 0.444 damped ×0.5 each step = terminal crawl). Root cause: the 2.9.4 settle-damping gate keyed on PER-PARTICLE speed < 2.5 + area ±2% — both pass during FREE FALL (a falling ring is stress-free → area exactly 1.0), so damping capped every body's terminal velocity. First fix attempt (centroid-speed gate) failed live: damping itself keeps the centroid below the gate (terminal-velocity trap). Final fix: damping requires ball.touched (contact history from the scene's collision drain) + centroid gate — an airborne ball is never damped, a resting pile ball is. Live after-fix: fall accelerates 0.88→2.2→4.2→…→14 (clamp) and lands in ~70 frames; settled residual 0.13–0.15 px/step (jitter fix preserved). Regression tests added: free-fall acceleration under the production gate + resting settle with the touched gate. 74 tests pass; all 6 case captures refreshed.
**Phase 2.9.4 (contact jitter, impact interpenetration, small-ball compression):** three root causes isolated by live+headless instrumentation. (1) RESTING JITTER: a Matter constraint chain under gravity keeps a standing 1.2px/step internal velocity field forever (zero-G → 0.000; pressure pass exonerated — identical residue with it off; positions stable, so it's invisible per-ball but sums across pile contacts). Fix: settle-damping branch in SoftBallManager.stepAll — when a ball's area is within ±2% of rest and particle speeds < 2.5, velocities scale ×0.5/step; measured rest residual 1.23→0.48 px/step, pile creep 1.5px/2s → sub-pixel. (2) IMPACT INTERPENETRATION: live per-frame measurement during an active drop found cross-ball particle surfaces overlapping −4.2px (transient, 1 substep before the solver separates) — invisible in settled tests, visible in gameplay. Fix: bounded positional separation pass (SoftBallManager.separateContacts, ≤2px/pair/step, different-logical-balls only, Body.setPosition(updateVelocity=false) to avoid phantom velocity; first attempt with Body.translate injected −30.5px of phantom velocity and was corrected). Live after-fix: min gap during impact 0.0px (was −4.2). (3) SMALL-BALL COMPRESSION: sustained-pile case 4 areas 0.94–1.0, case 5 sustained 0.82–0.95 (slivers only when the pre-2.9.4 contact overlap artificially pressurized; now bounded). All 6 required cases captured (2.9.4-case1..6-*.png); restart orphan check 20→3 bodies/56→0 constraints. 72 tests pass.
**Phase 2.9.3 (interpenetration, collapse, weight, outline):** root cause of VISIBLE interpenetration measured, not assumed: the Catmull–Rom contour bulges up to 4px beyond the particle collision surfaces under load (verified: bulge sweep), and per-ball draw order let a later ball's stroke cut into an earlier ball's fill at legal contact. Fixes: collisionOutset +5px on every particle (physics surface now covers the rendered edge; regression test asserts contour bulge ≤ outset), two-pass renderer (all fills → all outlines; junctions show both outlines), outline 5→7px (+40%, single constant OUTLINE in SoftBallRenderer). Weight/restitution already correct (0.05; drop bounces ≤1/≤5px per 2.9.2 test). Live pixel verification of production captures: boundary outline median 10px, fill-through-fill transitions 0 (the 4 flagged were anti-aliased shading pixels, outline confirmed present by row scan), worst pile region aspect 0.75 (corner t5s, recognizable). Cross-ball particle-surface gap stayed ≥ +18px (never negative). Evidence pairs: refference/captures/2.9.3-BEFORE-*.png vs 2.9.3-AFTER-*.png (same scenarios). 72 tests pass (new: collision-covers-contour regression).
**Phase 2.9.2 (heavy, non-overlapping, shape-retaining slime):** three reported failures instrumented headless + live. (1) Small-ball collapse — control experiment (small between RIGID bigs: area 0.90; between SOFT bigs: 0.01) plus per-angle radius trace (all ring radii ≈1px for ~20 frames at floor impact) proved the ring point-collapses on impact; fixed with DIAMETER braces (opposite particle pairs, stiffness 0.35 — swept 0.3–0.9; 0.5+ blocks visible flattening) + center-escape retention (center body was escaping the folded ring, 21px). Valid-scenario measurement: small trapped between bigs holds area ≥0.86, aspect ≥0.72. (2) Heavy feel — particle restitution 0.05, frictionAir 0.012, frictionStatic 0.4, constraint damping 0.16: drop onto resting ball bounces ≤1 with ≤5px/step rebound. (3) Interpenetration — particleRadiusFactor 0.24→0.32 (outer surface ≈ nominal radius, ring gaps nearly sealed; cross-ball penetration 5.7px→~0) and dropBall now spawns inside the mouth clamped via clampBallInside (was above the rim, unclamped). Corner-pile crush (live: area 0.04) fixed by pressureAcceleration 10 (swept 8/10/12) + iterations 14/12/6 — corner worst 0.76 ≥ 0.70 target, rest perfect 1.00/1.00. Live acceptance PASS: single drop area 1.00, stack worst area 0.99 maxSpeed 0.8, merges score 168, restart 88→3 bodies/280→0 constraints. Captures: refference/captures/2.9.2-*.png. 71 tests pass.
**Phase 2.9.1 (production instability fix):** live-instrumented the production game (no ?softbody) — captured areas [1.88, 0.14, 4.3] and particle speeds pinned at the 14px/step clamp = one-sided pressure never restored INFLATED balls (collisions inflated them to 4.3×, outward push saturated the clamp permanently = energy pump/launches), and force ∝ edge-length×deficit reached hundreds of gravities on folded balls. Fix: symmetric SIGNED area restoration at velocity level (Δv per particle ≤ pressureAcceleration 1.3 px/step ≈ 4× gravity at full deficit — energy-stable by construction, calibrated so settled press ≈ 6% squash under a 2.3× mass load). Test measurement corrected to settled equilibrium (slam transient may splat to ≥0.4 area, no collapse). Live before/after: speeds [14,11,14,4,14,13.6]→[0.3,0.24,0.29], areas [1.88,0.14,4.3]→[0.99,0.99,0.86,1.0]; acceptance 1–8 PASS (single drop settles, stack maxSpeed 0.7, merges+chains score 48 no spikes, restart 122→3 bodies / 336→0 constraints). 2 regression tests added; 68 total pass.
**Phase 2.9 (soft-body production integration):** production balls are now Matter-native soft bodies — SoftBallManager (logical registry: 1 composite = 16 particles + center + 36 constraints; body-id→ball routing; atomic removal) replaces BallManager in the scene; SoftBallRenderer draws the Catmull–Rom contour + aspect-squashing face from live particle positions; MergeSystem adapted (distinct-logical-ball guard, centroid-midpoint placement via clampBallInside, same touched/chain/dedup rules); pressure+clamp run once per Engine.update via PhysicsWorld.setSubStepHandler; engine iterations 10/8/4; particles sleepThreshold=∞ (no global sleeping change); floor collider outer depth +60px (inner visible surface unchanged) + larger center particle — kills pile-pressure tunneling; live: merge chain t1→t2→t3 (score 424 from cascades), 60.5 fps headless, restart leaves exactly 3 statics / 0 constraints (zero orphans). Evidence: refference/captures/2.9-*.png. 66 tests pass incl. migrated merge suite (soft-based) + contour/lifecycle suites.
**Phase 2.8 (smooth round slime rendering):** contour = centripetal-corrected Catmull–Rom (chord-clamped tangents → no overshoot/self-intersection) through the particle ring at 6 samples/segment, outset along edge normals to wrap the particles' outer edge; fill and outline share one polygon (no mismatch). Particle comparison 12/16/20 → **16 chosen** (best contour roundness 1.084, fastest settle 0.14, +5% cost; 20 costs +18% for no gain). Face follows centroid, scales with area ratio and squashes with the live aspect ratio. Pixel verification of the REST capture: outline radius 88–96px (roundness 1.09), max 2px jump per 3° (avg 0.4px) = smooth; telemetry: rest 137×130 → press 141×118 → recover 138×130, speed 0.19 at rest. Five acceptance screenshots saved to refference/captures/2.8-*.png. 66 tests pass.
**Phase 2.7 (Matter-native soft-body prototype):** ONE-ball prototype behind `?softbody=1` (SoftBallScene) — 12 particle circles + center, rim/spoke/skip-one-brace constraints (native Matter 0.20), particles ARE the collision bodies (no hidden rigid circle). Custom minimal solver passes: edge-normal gas pressure (area preservation; antipodal and radial variants rejected by testing) + per-substep speed clamp. Debug findings fixed by measurement: brace chord formula bug (19% collapse), pressure 22× gravity (floor punch-through), rigid-hoop behavior (rim 0.9→0.35), sleeping-inside-floor (prototype engine: sleeping off, iterations 10/8/4), thin-floor tunneling (80px slab + 14px/step clamp). Headless: settle ✓, box-press flatten 26% + widen +18% with ~volume preservation ✓, recovery ✓, wall piston press ✓, ball-to-ball ✓. Live CDP: rest circle 139×130 → pressed 152×104 → recovered 139×130. Main game untouched (58 pre-existing tests still pass; 62 total).
**Phase 2.6 (deformation model fix):** root cause — contourPoint double-multiplied the squash (s×maxSquash → localized dent was 1.7px vs 25% ellipse = ellipse-dominated squash look). Rebuilt: dent and bulge are separate springs (dent ω≈13.8 ζ≈0.35; bulge is a follower spring chasing the dent amplitude with lag → material propagation); global ellipse demoted to a 0.3× volume hint; dent/bulge are the primary effect. maxSquash 0.25→0.17 (peak dent 9.1px = 27% of r34, in spec range). Contour 32→40 segments + circular smoothing (no polygon artifacts). Live-rendered verification via CDP: peak dent −7.8px localized/asymmetric, recovery phase all-outward +4.2px bulge, exact circle at rest. 58 tests pass incl. 7 new model tests (rest circle, peak depth/bulge/localized-share 75%, smoothness, multi-oscillation recovery, mid-recovery re-excitation, gentle-vs-hard scaling, direction-following for wall/ball contacts).
**Phase 2.5:** slime contour (localized Gaussian dent at the contact point + opposing bulge ring on a 32-segment procedural silhouette; ζ 0.28→0.35 for a ~0.6s multi-oscillation tail; peak deformation 8%→25% of radius, dent 10px/bulge 11px on a 34px ball — prototype-verified per-impact-type before rollout); proportions: mouth 540 (75%), bottom 405 (tier-6 = 62% of floor), height 660 @ y425; control audit — Swap functional (rerolls next ball, once per run, USED state), Extend/Shake honestly labeled SOON (Phase 5), ability button + rank are placeholders, help button removed; debug `<pre>` diagnostics now only render behind ?diag/?autodrop; power-up row moved inside the viewport (bottom 1278 ≤ 1280); layout verified at 720×1280 (no stripe leaks, all controls visible) and 360×740 (canvas 360×640 @ y50, no scroll, no clipping).
**Phase 2.4:** ref-matched rebuild — root cause of invisible deformation identified (Matter resolves collisions BEFORE emitting collisionStart; event-time approach speed was ~19% of real impact) and fixed via pre-step velocity snapshots in PhysicsWorld; balls now render as procedurally redrawn 20-segment deformable contours (entire silhouette + outline + face deform together; texture scaling replaced); HUD shell per reference layout (score/best/rank/ability, NEXT preview + exchange, tier progression bar, power-up buttons, help); container 500/360/700 @ y390; radii 34/44/57/75/97/126 (1.30×, tier-6 = 0.70× floor); 1000ms drop cooldown; first-contact merge eligibility; live CDP verification PASS (impact magnitude 18.7–20.2 px/step, peak contour squash 17%, score increments from cascades, cooldown + eligibility regression-tested).
**Phase 2.3:** container resized to top 500 / bottom 330 / height 590 (69.4% stage width, 46.1% stage height, 67% funnel taper, floor y=1110); ball radii 44/57/74/96/125/162 (locked 1.30× progression, tier-6 fits the 330 floor at a Suika-like 1.02×); jelly deformation (underdamped ζ≈0.28 dual-spring, directional via contact normal in body-local frame, volume-preserving oval, decays to exact rest); score bug fixed (scene now subscribes to the state:score bridge event — counter updates on every merge/reset); merge/score/oscillation regression tests added (41 total).
**Phase 2.1 correction:** open-top trapezoid container (620 top / 480 bottom / 660 h, config-driven, colliders == visuals), user-locked tier 1–6 colors (blue→green→pink→red→orange→yellow) with radii 36–134, simplified single-design faces, striped-rectangle render bug fixed (baked band texture replaces misaligned mask), Matter static-friction override corrected, drop clamping uses spawn-height band, merge results clamped inside trapezoid.

## Phase 3 — Merge System & Scoring
- [ ] Collision-driven merge with guards (same tier, alive, not double-flagged, cooldown).
- [ ] Next-tier spawn at midpoint with averaged momentum; score per `ballTiers` config.
- [ ] Chain processing within the same step (re-scan loop, bounded).
- [ ] `ScoreSystem` + score bridge event to React HUD.

**Accept:** no double merges in automated collision-flood test; chain depth ≥ 3 achievable and scored; score matches config exactly.

## Phase 4 — Spawning, Input, Game Loop Feel
- [ ] `SpawnSystem` (config distribution, tiers 1–3 default) + next-ball preview state.
- [ ] Aiming (clamped horizontal), drop cooldown, ghost indicator.
- [ ] `GameOverDetector` sensor zone; ball-out ends run; danger line warning-only (locked rule).
- [ ] Run lifecycle: start → play → game over screen → restart.

**Accept:** a full run is playable start-to-finish; falling ball reliably ends run; danger-line crossing alone never ends run (explicit test).

## Phase 5 — Power-Ups
- [ ] `PowerUpSystem` strategy pattern; one use per run each; HUD state.
- [ ] Extend Walls (timed wall extension, container width unchanged).
- [ ] Shake (tuned impulse; parameters in config).
- [ ] Swap (reroll upcoming ball).
- [ ] ⚠️ Nothing here may touch tiers 8–10 behavior — still awaiting user spec.

**Accept:** each power-up demonstrably helps without breaking stability; used-state persists across HUD re-renders; walls restore exactly after timer.

## Phase 6 — Effects, Audio, Polish Pass 1
- [ ] Merge splash/droplets/ring/score popups; game-over shake + slow-mo.
- [ ] `AudioManager`: SFX set, optional music, mute persisted.
- [ ] Face expression state machine wired to gameplay events.

**Accept:** 60 fps with effects active on mobile; mute persists across reload; all ART_DIRECTION §5 signature moments present.

## Phase 7 — React UI Shell (menu + gameplay screens)
- [ ] **Home screen** per ART_DIRECTION §6A.1: grid bg, hero machine illustration
      (canvas, reusing ball pipeline), logo, large Play button, PB/profile chip,
      leaderboard entry, settings button — and *nothing else* (no ads/shop/promo).
- [ ] **Gameplay HUD** per ART_DIRECTION §6A.2: score + personal best, NEXT preview
      (Phaser-baked tier images via bridge), ball-progression indicator (tiers 8–10
      shown as dimmed locked slots only), three power-up buttons with USED state,
      danger warning strip, pause overlay. No sidebars/ads/currencies during a run.
- [ ] Settings, stats/history, leaderboard screen shell, game over screen.
- [ ] HUD layout bands reserved top/bottom; container never overlaid; safe areas.
- [ ] Menu/gameplay screen acceptance criteria: see TEST_PLAN §5 (responsive) and
      the manual checklist §8 — both must pass before Phase 8 starts.

**Accept:** full navigation without gameplay breakage; Play → playing in one tap
from load; HUD usable one-handed on phones and never covers the container;
progression indicator only ever shows tiers 1–7 as reachable (8–10 dimmed/locked,
awaiting user spec); no React↔Phaser direct imports (lint-enforced).

## Phase 8 — Supabase Backend
- [ ] Project setup; migrations: `profiles`, `runs`, leaderboard functions/views.
- [ ] RLS on all tables; server-side run insertion via security-definer function with validation (plausibility + rate limit).
- [ ] Anonymous auth sign-in on first launch; profile row creation.
- [ ] Client: `runService` submission with retry/queue; `leaderboardService` (daily/weekly/all-time).

**Accept:** run rows only insertable through the validated function; RLS blocks direct writes; leaderboards return correct windows in UTC/ISO weeks.

## Phase 9 — Stats, History, Leaderboard Integration
- [ ] Lifetime stats tracked client-side + server-derivable; personal best sync.
- [ ] Run history list; daily/weekly/all-time boards wired into UI.

**Accept:** stats survive reload; board tabs show expected data; offline play degrades gracefully.

## Phase 10 — Balance, Performance, Deploy
- [ ] Tier size/score tuning pass; chain bonus formula finalized and documented in GAME_SPEC §6.
- [ ] Performance pass (pooling, particle caps) against TEST_PLAN budgets.
- [ ] Vercel deployment; production build; smoke test on real devices.

**Accept:** TEST_PLAN §6 suite passes; deployed build playable on a real phone.

## Phase 11 — Launch Polish & Backlog Gate
- [ ] Sound/music final pass; icon/favicon; meta tags.
- [ ] Manual regression sweep of TEST_PLAN.
- [ ] Review backlog: cosmetics, async friends, **tier 8–10 mechanic (blocked on user)**.

**Accept:** user sign-off for launch.

---

### Standing blockage (repeated deliberately)

> **Tiers 8–10 randomization mechanic is unspecified.** The user must explain the
> intended behavior before any code touching tier 8–10 spawn, appearance, scoring,
> or merge behavior is written. Until then they exist only as reserved config
> entries with no gameplay path.
