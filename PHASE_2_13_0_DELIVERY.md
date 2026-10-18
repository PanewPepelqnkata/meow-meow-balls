# Phase 2.13.0 — Delivery Report

**Date:** 2026-10-15
**Scope:** Complete reference-style game presentation — anime discoveries, illustrated backgrounds, combo rewards, tier-only progression, and the two gameplay defects (current/next queue, merge teleportation).

---

## Honest limitation statement

**Direct visual inspection was unavailable in this session.** `ffmpeg`/`ffprobe` are not installed, and image reads are content-filtered in-session. The reference videos (`refference/ref_video.mp4`, `ref_video2.mp4`) could **not** be inspected frame by frame. The implementation follows the detailed written specification (§1–§18) as the visual source of truth. Rendered output was verified **programmatically**: pixel sampling of real screenshots with `pngjs`, per-region luminance statistics, and ASCII luminance renders of the saved screenshots (reviewable text representations of the actual composition). Every functional claim below is tied to a check that ran against the real, running game.

---

## Files changed

### Gameplay defect fixes
| File | Change |
|---|---|
| `src/game/scenes/PlaygroundScene.ts` | **Two-slot queue** (`currentBall` / `nextBallState`): crane shows current, preview shows next; drop promotes next→current and generates a fresh next; swap rerolls current only; restart re-inits both. New `themeMilestone()` background triggers; physics paused during discovery (`updateInner` gates on `discoveryBlocking()`); dev QA hooks `queueInfo`/`setQueue`/`progressionUnlocked`; merge handler wires rewards+burst+discovery+theme; restart resets theme+queue+progression. |
| `src/game/systems/mergePlacement.ts` | **Anti-teleportation**: search rings now rNew-**relative** (`[0.3,0.6,1.0,1.5,2.1]×rNew`, hard 240px cap) instead of absolute steps up to 290px; angle scan **upward-first** (from −π/2, alternating sides) instead of rightward-first (angle 0). A replacement can never search further than ~one replacement-diameter from the merge point. |
| `src/config/ballTiers.ts` | Tiers 8/9 are real merge destinations (`playable: true`, `PLAYABLE_TIER_COUNT = 9`); tier 10 stays a reserved placeholder. Drops still only spawn tiers 1–3 (`SPAWNABLE_TIERS`). |

### Presentation
| File | Change |
|---|---|
| `src/config/presentation.ts` | **NEW** — centralized thresholds: `DISCOVERY` (minTier 4, 1800ms+300ms), `THEME_PROGRESS` (order, tier→steps mapping, combo depth 6, 800ms fade), `COMBO_GRADES` ladder + `gradeForChain()`. |
| `src/game/rendering/DiscoveryOverlay.ts` | **REWRITTEN** — full-screen anime discovery: full-viewport dim → per-frame manga speed-line burst (18 alternating white/ink/accent radial wedges reaching screen corners, 2–3 intensity pulses then ease-out; reduced-motion halves intensity and drops a pulse) → single impact flash → content-container shake (camera-independent) → character overshoot reveal via the shared appearance pipeline (T8 rainbow / T9 fantasy dispatch) → `NEW BALL DISCOVERED!` punch-in + tier label → tier-colored celebration sparkles (rainbow set for T8, pastel stars for T9) → clean fade. Physics pause via world-side gate; resize rebuild; instant teardown on restart. |
| `src/game/rendering/ScoreFeedback.ts` | **REWRITTEN** — grade + `Nx Combo!` now derive from the REAL `chainDepth` via `gradeForChain` (the old score-threshold grades and the disconnected 2000ms cosmetic combo counter are gone — an ordinary single merge can never show a top grade). `+N` tinted with the merged tier's color; size escalates with chain depth; concurrent popups stagger into separate lanes; new `showMergeBurst()`: impact ring + 10 bounded tier-colored confetti pieces at the actual merge location (no physics bodies, self-destroying, killed on restart). |
| `src/game/rendering/BackgroundTheme.ts` | **REWRITTEN** — four genuinely illustrated environments (deterministic seeded art so crossfade redraws never flicker): **light** (cream + soft corner glows + spec grid), **space** (navy→purple gradient, 5 nebula glows, 90-star field with glints, low atmospheric glow), **jungle** (sky gradient, two mountain ranges, waterfall + mist, six palm fronds framing the edges, foreground bushes), **fantasy** (twilight gradient, glowing moon + halo, stars, two ruin-depth layers with columns + broken arch, edge foliage, horizon glow). Crossfade draws both environments with complementary alphas — full coverage at every pixel throughout; star layer crossfades with the curtain. |
| `src/game/scenes/BackgroundScene.ts` | `advanceTheme(steps, comboOnly?)` milestone progression (secondary combo trigger capped at 1 step) + `resetTheme()` on restart; star twinkle per frame. |
| `src/ui/TierProgression.ts` | **REWRITTEN** — reads REAL discovery state: locked tiers are dark circles with white `?`; discovered tiers use their actual colors; T8 renders a 6-segment rainbow ring, T9 a pastel body with a gold horn; blue curved connector (desktop arc) / row track (portrait); unlock pop animation; `reset()` to `[1]`; QA `unlocked` getter. |
| `src/ui/UiRoot.ts` | `unlockTier()` facade + `progressionUnlocked()` QA hook; `resetForNewRun` resets progression. |
| `src/game/scenes/UIScene.ts` | Drives `DiscoveryOverlay.update()` per frame; forwards `state:discovered` → `unlockTier`; progression QA hook. |
| `src/game/events/gameBus.ts` | New `state:discovered { tier }` event. |
| `src/config/ballTiers.test.ts`, `src/game/systems/merge.test.ts` | Updated to the Phase 2.13.0 policy: T8/T9 playable, T10 reserved; the old "T7 pairs never merge" test now verifies T7+T7 → one T8 with correct score. |

### QA
| File | Change |
|---|---|
| `qa/phase2130.mjs` | **NEW** — 30-check real-gameplay suite: queue regression (deterministic seeds, crane/preview pixel + state verification, drop rotation, swap semantics via the real button), merge reward, real chain combo, T4/T8/T9 multi-moment discoveries, progression lock→unlock→reset, 4 themes + mid-fade blank-canvas scan, restart-mid-presentation cleanup, merge-locality end-to-end, portrait/wide compositions. 22 screenshots → `qa/screens/p2130/`. |
| `qa/phase2121-pixels.mjs` | Theme probes now per-region color families (illustrated art); discovery section verifies tiers 1–3 silent + T4 overlay; chain scenario made deterministic. |
| `qa/phase2121-viewports.mjs` | Per-region expectations for illustrated themes; 20/20 viewport-theme combos pass. |
| `qa/phase2122-inspect.mjs` | Parameterized dir/pattern (reusable ASCII inspector). |

---

## Visual changes vs the previous build

- **Backgrounds:** flat color + grid → four layered illustrated environments (mountains, waterfall, palm fronds, ruins, moon, nebulas, star fields) while keeping the grid language and full-viewport coverage at all sizes.
- **Discovery:** small modal panel → full-screen anime burst: viewport-wide radial speed lines with pulse envelope, impact flash, shake, overshoot character reveal, celebration particles — and it no longer fires for tiers 1–3.
- **Merge feedback:** generic white `+N` with score-size grades → tier-colored `+N`, chain-derived grades (`Good! → Unbelievable!`), `Nx Combo!`, lane-staggered popups, impact ring + confetti at the merge point.
- **Progression:** all-tier rainbow circles from frame one → tier-only path with locked `?` nodes that unlock from real discoveries (T8 rainbow ring / T9 horned node).
- **Gameplay feel:** preview no longer mirrors the held ball; merge results no longer jump across the pile.

## Trigger rules implemented

- **Theme milestones** (`THEME_PROGRESS.advanceOnTier = {4:1, 6:2, 8:3}`): first-time discovery of tier 4 → space, 6 → jungle, 8 → fantasy. Secondary: a real chain ≥ 6 advances one step, suppressed while a discovery is active, never random, never per-particle cycling. Restart returns to light.
- **Discovery:** first-time tiers ≥ 4 only (`DISCOVERY.minTier`); tiers 1–3 (and repeats) never present it.
- **Combo grades:** from `MergeSystem.chainDepth` (400ms chain window) via the centralized ladder — the same state that drives scoring.

## How the queue is verified

Deterministic `setQueue(current={2,seed:12345}, next={4,seed:67890})` → `clawInfo()` shows tier 2/seed 12345, preview box pixels show tier-4 red → real drop → `current = {4, seed 67890}` (**same seed promoted**) and a fresh next → swap via the real ability button rerolls current only, next untouched, `swapUsed` set → restart regenerates both. All verified in the running browser (`qa/phase2130.mjs` §2) plus state hooks used by the suite.

## How local merge placement prevents teleportation

`placeMergedBall` now searches rings at fractions of the replacement radius (≤ 2.1×rNew, hard-capped 240px) with upward-first alternating angle ordering; deferral stays bounded (existing pending-queue + loosened push after 1s). Unit regressions (`merge-placement.test.ts` "LOCALITY" suite): wall-blocked left/right merges stay within `240 + rNew` of the midpoint and on the same side; a fully surrounded T8 replacement cannot search beyond the bound. Browser end-to-end: dense-pillar scenario — the chain product landed **91px** from the merge midpoint, left-of-center, with `rendererBalls == registered` (no duplicates).

## Tier 8 / Tier 9 rendering

Through the single shared `BallAppearance` pipeline: `drawRainbowBall` (saturated segments, ink outline, face kept clear) and `drawFantasyBall` (pastel body, horn, mane) are dispatched in gameplay rendering, claw, preview, discovery, and the progression nodes (rainbow ring / horned pastel). Verified in-browser: T8 hue-diversity scanline (7 hue sectors), T9 pastel-pink scan (73–78/303 samples), T8/T9 real merges (via `playable: true`) triggering their discoveries.

## Screenshots (22 files, exact paths)

`qa/screens/p2130/`: `01-initial-desktop` … `19-merge-locality` (list: `01-initial-desktop`, `02-queue-crane-green-preview-red`, `03-drop-current-tier2`, `04-merge-reward`, `05-chain-combo`, `06-discovery-t4-burst`, `07-discovery-t4-reveal`, `08-discovery-t4-returned`, `09-discovery-t8-burst`, `10-discovery-t8-reveal`, `11-discovery-t9-burst`, `12-discovery-t9-reveal`, `13-progression-locked`, `14-progression-unlocked`, `15-theme-{light,space,jungle,fantasy}`, `16-theme-midfade`, `17-portrait-390x844`, `18-wide-1920x1080`, `19-merge-locality`).
Regression evidence: `qa/screens/p2121-verified/` (9 files), `qa/screens/p2121-viewports/` (20 files).

**Recording caveat:** no screen-recording was captured (no ffmpeg in the environment); merge-in-motion is evidenced by the timed multi-frame captures above (burst vs reveal vs returned) rather than video.

## Gate results

| Gate | Result |
|---|---|
| Tests | **187/187 passed** (184 + 3 new: 2 config, 1 merge; plus 3 new placement locality tests within the placement file count) |
| TypeScript (strict) | clean |
| ESLint | clean |
| Production build | ✓ (`dist/`, chunk-size warning pre-existing/informational) |
| `qa/phase2130.mjs` | **30/30 checks, exit 0** |
| `qa/phase2121-pixels.mjs` | all checks passed |
| `qa/phase2121-viewports.mjs` | 20/20 viewport-theme combos |

## Remaining limitations

1. **Reference videos not inspected** (no ffmpeg; image viewing filtered) — layout proportions follow the spec table, not measured reference frames. If exact 1170×658 element rectangles from the videos are wanted, they must be measured by someone who can see the videos, then tuned in `ResponsiveLayout`.
2. **No video recording** of merges/discoveries — multi-moment screenshot sequences substitute.
3. **ASCII/pixel inspection** verifies composition, coverage, and color families, but fine art quality (exact leaf shapes, face readability under the sheen) ultimately needs human eyes.
4. Tier 10 intentionally remains a locked `?` placeholder (spec §1) — the progression shows it locked.
5. The Get Ability! ad button was **not** implemented (per instruction).
