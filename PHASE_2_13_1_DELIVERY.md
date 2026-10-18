# Phase 2.13.1 — Delivery Report

**Date:** 2026-10-15 · **Status:** Complete — all seven changes delivered, all gates green.

## Summary

Seven targeted changes on top of the existing physics/gameplay architecture
(no unrelated redesigns):

| # | Change | Status |
|---|--------|--------|
| 1 | Space background: concentric-circle/target-ring removal | ✅ |
| 2 | Merge teleportation fixed (root cause found + fixed) | ✅ |
| 3 | Discovery animation → comic-book reveal | ✅ |
| 4 | Tiers 1–3 unlocked from the first session | ✅ |
| 5 | Weighted ball spawning (`src/config/spawn.ts`) | ✅ |
| 6 | Jungle background refined into a cohesive environment | ✅ |
| 7 | Raise Walls is a one-use ability | ✅ |

---

## §2 Merge teleportation — root cause

**Root cause (three defects, all in the dense-pile fallback path of
`mergePlacement.ts` + its caller):**

1. **Unbounded relaxation drift.** The 8-iteration "bounded relaxation"
   shifted the replacement center away from the worst-penetrating obstacle by
   the full residual each iteration with **no cap on total drift from the
   original merge midpoint**. Each residual can exceed 100px; 8 iterations
   could walk the spawn point hundreds of pixels across the container (the
   walls only clamped it inside the playfield).
2. **Age-based push loosening (`2 × MAX_PUSH` after 1s).** `MergeSystem` let
   pending replacements push neighbors aside with **240px** instantaneous
   `translateBall` pushes once a deferral aged past one second. That is the
   visible "ball teleports to a distant position" — a *neighbor*, shoved
   hard enough to visibly jump.
3. **Unvalidated pushes (the "trapped inside other balls" symptom).** A push
   was never checked against *third* balls, so a shoved neighbor could be
   translated straight into another ball, ending up buried inside it.

**Fixes (`src/game/systems/mergePlacement.ts`, `MergeSystem.ts`):**

- The relaxation may now drift **at most `MAX_RING_PX` (240px) from the
  original clamped midpoint**; beyond that the placement **defers** instead
  of walking away.
- `MAX_PUSH` is a hard **60px** ceiling with **no age-based loosening**
  (removed).
- Every push is validated against **all other obstacles**: if a push would
  bury a neighbor inside a third ball (beyond a 2px contact tolerance), the
  placement **defers**.
- The squeeze is attempted from the **midpoint first** (most local), then
  the least-penetrating ring candidate.
- On deferral the merge area is **woken** (`wakeNear`) so a sleeping pile
  genuinely relaxes and the retry resolves — deferrals observed resolving in
  ≤ 350ms.
- Existing merge cooldown, score, chain merges and parents' momentum are
  preserved unchanged.

**Browser verification (not just unit tests):** `MergeSystem` now records
`lastMerges` (source midpoint vs replacement position, pushes, deferral
delay; exposed as the `mergeLocality()` DEV hook).
`qa/verify-merge-locality.mjs` drives three crowded scenarios (left wall,
right wall, center) with **real cascading merges** and verifies every single
recorded merge:

- worst displacement **122–174px** across all merges (bound 320px),
- pushes bounded (≤ 3 per merge, ≤ 60px),
- deferrals resolve (≤ 350ms),
- no pile-ball instant jump > 0px at 200ms sampling,
- no ball buried inside another (pairwise center scan),
- no duplicate renderers/constraints (renderer == registered).

Wall-adjacent merges were tested explicitly (left-wall and right-wall
cases). Unit regressions in `merge-placement.test.ts` cover: fully packed
neighborhood → **defers** (never buries); sparse-blocked neighborhood →
bounded pushes with exact envelope clearance.

## §5 Weighted spawning — final weights

`src/config/spawn.ts` now owns the editable table:

```ts
export const SPAWN_WEIGHTS = { 1: 40, 2: 30, 3: 20, 4: 10 }   // user-tuned 2026-10-15
```

> Note: the spec's starting values were 70/22/7/1; `src/config/spawn.ts`
> was manually edited mid-session to 40/30/20/10 and the user confirmed
> these tuned values ship as the default. Ordering still satisfies the
> requirement: tier 1 most common → tier 4 rarest; tiers 5–10 are absent
> from the table and **never** spawn randomly (only merge results).

- `normalizedSpawnWeights()` validates loudly (empty/all-zero/negative/NaN
  weights throw at boot) and normalizes any scale.
- `pickWeightedTier()` does **inverse-CDF weighted sampling** (never
  uniform); tolerant of rng values outside [0,1).
- `randomSpawnTier()` (ballTiers) delegates to it; `SPAWNABLE_TIERS` is
  derived from the table keys (1–4).
- Queue behavior (crane current + preview next) preserved through
  dropping/swapping/restarting — re-verified.

**Tests** (`src/config/spawn-weights.test.ts`): deterministic boundary
selection with a stubbed rng; table/normalization validation; seeded
statistical test (50k draws, mulberry32) within ±1.5pp of 40/30/20/10 with
strict rarity ordering and no out-of-table tier; reproducibility.
**Browser:** 240 real queue draws across 120 restarts → 40.0/30.8/21.3/7.9%
(no tier 5–10 ever).

## §7 Raise Walls — one-use lifecycle (proof it cannot be reused)

**Root cause of the defect:** `doRaise()` had **no consumed flag** —
`walls.activate()` only refuses while the animation is active
(raising/raised/lowering); once the walls returned to `normal`, a second
activation succeeded despite the "×1" quantity.

**Fix:** `raiseUsed` latches in `PlaygroundScene.doRaise()` — the single
gate for both keyboard (E) and the button — set the moment
`walls.activate()` succeeds; restored **only** by a genuine restart.
`ability:raiseUsed` → `AbilityBar.markRaiseUsed()` flips the button to
**USED / disabled / counter removed** immediately.

**Browser proof (`qa/phase2131.mjs`, §7):**

- E activates → consumed immediately (game flag + UI button state).
- 6× repeated E presses **and** button clicks while raised → phase stays
  `raised`, height never changes (no stacking/re-raise).
- After the full cycle (raise 0.9s + hold 25s + lower 0.9s) → walls back to
  `normal` at exactly the pre-activation height; 4× further E/button
  attempts → **walls stay down**, still marked USED.
- Restart → charge restored (game + UI), and works exactly once again.

## §3 Comic-book discovery reveal

`DiscoveryOverlay` rewritten: darkened full-screen dim, the **actual new
ball** centered, **two bold capsule-ended horizontal lines** (tier color,
ink outline) above/below the ball that slam open from the middle
(Back.easeOut scale-wipe) and **flash white twice** (~340ms/~580ms), the
`NEW BALL DISCOVERED!` title above the top line, `Tier N` below the bottom
line, smooth fade exit. Removed: the radial wedge burst, all sparkles, the
full-screen flash. Reduced-motion: no flash pulses, no shake.

**Browser pixel verification:** tier-4 red line bands detected at the exact
predicted line Ys (78/67 and 72/67 samples), centered ball confirmed, title
confirmed, **all 8 corner probes at luminance 21** (no rays/speed lines),
clean auto-exit, repeat T4 merges never re-trigger (a T4+T4→T5 reveal is a
legitimate new-tier discovery), tiers 1–3 never trigger. Physics pause/resume
preserved.

## §4 Tiers 1–3 unlocked from the start

`discoveredTiers` starts `{1,2,3}` (both at boot and after restart) and
`TierProgression` mirrors it — the progression path shows tiers 1–3 colored
from the very first session, driven by the **real** discovery state (T2/T3
merges no longer emit `state:discovered`; T4+ discoveries animate their
nodes exactly as before). Restart resets to `[1,2,3]`. Verified in-browser.

## §1 + §6 Backgrounds

**Space (`BackgroundTheme.ts`):** the 7-step concentric-circle `glow()` helper
(the radar-target look) is replaced by `softGlow()` — three wide,
wider-than-tall ellipse layers at gentle alpha steps + an offset highlight
per nebula. Stars, glints, navy→purple gradient, nebula clouds and the
subtle square grid all remain; nothing radial/halo/target-like is drawn.
Also applies to the light/fantasy glows (softer corner haze, softer moon
halo).

**Jungle:** rewritten as a cohesive environment: **smooth rolling hills**
(two layered sine bands — no jagged triangles), a **tapered waterfall**
with streak, pool and soft mist, a **rounded tree line** for forest depth, a
**scalloped two-layer leaf canopy** with hanging vines, refined palm fronds
framing the corners, and **leafy mounds** (scalloped silhouettes, replacing
the circle-cluster bushes). The central gameplay area stays clear and the
subtle grid is integrated.

**Browser verification:** space — no ring-edge stacks in background-only
regions (max 3 hard steps/row vs ~14 for the old 7-ring glow) with
atmospheric variance retained; jungle — canopy covers the top edge at
desktop and mobile, center luminance 152/146 (clear), hills behind the
container, full coverage (no unrendered pixels), mobile viewport safe.

## Verification evidence

- **Unit:** 198/198 tests (`npx vitest run`), including the new
  `spawn-weights.test.ts` (11 tests) and updated merge-locality contracts.
- **Typecheck:** `tsc --noEmit` clean. **Lint:** `eslint .` clean.
- **Production build:** ✓ (pre-existing chunk-size warning only).
- **Browser suites** (dev server, real input events, real physics):
  - `qa/phase2131.mjs` — **33/33 checks** (discovery, progression, weighted
    spawn sampling, raise-walls lifecycle, space + jungle themes at desktop
    and mobile).
  - `qa/verify-merge-locality.mjs` — all locality/teleport/bury checks pass
    across crowded left-wall, right-wall and center scenarios.
  - Regressions re-run and green: `qa/phase2130.mjs` (30 checks),
    `qa/phase2121-pixels.mjs`, `qa/phase2121-viewports.mjs` (jungle top-edge
    color expectation updated to the new canopy green).
- **Screenshots:** `qa/screens/p2131/` (reveal mid-frame, raise-consumed,
  space/jungle desktop + mobile, crowded-merge verification frames).

## Files changed

| File | Change |
|------|--------|
| `src/game/systems/mergePlacement.ts` | Bounded relaxation drift, push validation vs third balls, midpoint-first squeeze, MAX_PUSH=60 hard cap |
| `src/game/systems/MergeSystem.ts` | No age loosening, wake-on-defer, `lastMerges` QA record, reset clears it |
| `src/config/spawn.ts` | `SPAWN_WEIGHTS` (40/30/20/10), validation + normalization, `pickWeightedTier` |
| `src/config/ballTiers.ts` | `randomSpawnTier` → weighted; `SPAWNABLE_TIERS` derived from the table |
| `src/config/spawn-weights.test.ts` | NEW — deterministic + seeded statistical weight tests |
| `src/game/systems/merge-placement.test.ts` | Updated to the defer-on-packed contract + bounded-squeeze case |
| `src/game/rendering/DiscoveryOverlay.ts` | Comic-book reveal (lines/flash, no rays/sparkles) |
| `src/game/rendering/BackgroundTheme.ts` | `softGlow` replaces `glow`; space nebulas; jungle rewrite + 5 new helpers |
| `src/game/scenes/PlaygroundScene.ts` | `raiseUsed` gate + restore; `discoveredTiers` 1–3; QA hooks (`mergeLocality`, `abilityRaiseUsed`, `queueInfo.raiseUsed`) |
| `src/ui/TierProgression.ts` | Initial state `[1,2,3]` |
| `src/ui/AbilityBar.ts` / `src/ui/UiRoot.ts` / `src/game/scenes/UIScene.ts` | `markRaiseUsed` chain, USED button state, QA facade |
| `src/game/events/gameBus.ts` | `ability:raiseUsed` event |
| `qa/phase2131.mjs` | NEW — Phase 2.13.1 browser QA suite (33 checks) |
| `qa/verify-merge-locality.mjs` | NEW — crowded-merge locality verification |
| `qa/phase2130.mjs`, `qa/phase2121-pixels.mjs` | Expectations updated to the 2.13.1 policies |

## Honest limitations

- Reference videos remain uninspected (no ffmpeg, image viewing filtered in
  this session); layout judgment uses the established stage geometry.
- The space-theme "no rings" pixel check is calibrated to *visible* edges
  (≥6 luminance steps): the new nebula haze legitimately has 2–3 hard cloud
  edges per blob (that is the cloud), while the old art produced ~14
  regularly-spaced ring steps per crossing — the check asserts ≤ 5.
- Tier 10 remains a locked placeholder by design.
