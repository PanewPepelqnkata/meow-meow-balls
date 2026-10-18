# Phase 2.13.2 — Merge Loss Fix + Visual Polish Delivery

Four targeted fixes. Physics/gameplay architecture preserved. Everything below
was verified in the real browser (Playwright + pngjs pixel analysis), not by
unit tests alone.

---

## §1 Merge loss — fixed (critical)

### Root cause

Two defects compounded:

1. **Non-transactional order.** `MergeSystem.tryMerge` removed BOTH source
   balls *before* computing the replacement placement. When placement
   deferred, the sources were already gone and the replacement was a
   `pending` entry retried each frame.
2. **Unbounded deferral.** The Phase 2.13.1 strict placement (defer when any
   neighbor push would exceed `MAX_PUSH` or bury a third ball — correct in
   itself) had no escape hatch for a **jammed** pile: after the source
   removal the pile collapses into the freed pocket, and the pending
   replacement retries against a *closed* pocket forever. Captured live:
   a tier-5 replacement deferred for **4417 ms** (`diag-merge-loss.mjs`);
   deep-jam merges near both walls produced **no replacement at all**
   (`repro-loss-*.png`).

### Fix (`MergeSystem.ts`, `mergePlacement.ts`, `config/merge.ts`)

- **Transactional order**: `tryMerge` now runs `computePlacement()` BEFORE
  `removeSources()` — with the two reserved sources **excluded from the
  obstacle list** (they are about to vanish; their envelopes must not block
  the replacement). Only when the placement decision is made do the sources
  leave the world; on success the replacement spawns in the **same frame** —
  there is no pending window for the common case. On deferral the sources
  are removed (the logical merge stands) and the replacement stays pending,
  anchored at the merge midpoint, retried locally every frame.
- **Guaranteed resolution** (`MERGE.pendingEmergencyMs = 900`): a pending
  older than 900 sim-ms switches to `placeMergedBall(..., { allowOverlap })`
  — the **least-penetrating clamped candidate within the bounded ring
  search** (never a teleport, zero pushes, never deferred). The replacement
  spawns there touching its neighbors and the soft-body contact solver
  separates them gently over a few frames (the area is woken). A replacement
  can therefore be absent for at most ~900 ms — never forever, never lost.
- `MergeLocalityRecord` gains an `emergency` flag for QA.

### Real-browser evidence (`qa/verify-merge-loss.mjs`, 12 checks)

Deep T4/T5 jam (5 rows), T5 pair spawned **inside** the pile near the left
wall, the right wall, and the floor — the merge happens low with a full pile
above (the pocket-closing scenario):

| case | replacement | worst deferral |
|---|---|---|
| left wall | SEEN (T6) | 908 ms |
| right wall | SEEN (T6) | 900 ms |
| floor | SEEN (T6) | 900 ms |

**No merge loss.** Regression `verify-merge-locality.mjs` (2.13.1 contract)
still passes: every replacement local (worst 308 px ≤ 320 px bound), pushes
bounded ≤ 3, **no buried balls, no teleports, no duplicate renderers**.
Unit tests: 2 new emergency-mode tests (the exact jam that defers in strict
mode must resolve under `allowOverlap`; both-wall variants).

---

## §2 Broken background circles — removed

### Root cause

Every theme used the `softGlow` helper — three stacked hard-edged **ellipses**
at alpha steps. At any size it read as a stretched elliptical halo
(the "distorted, unfinished circles" defect).

### Fix (`BackgroundTheme.ts`)

- New shared canvas **radial-gradient cloud texture** (`br-softcloud`,
  256 px, smooth multi-stop falloff — zero visible edge steps).
- `addCloud()` composes each cloud from **three offset gradient blobs** at
  varied scales — an irregular soft cloud shape, never an obvious centered
  circle. Used by: light (warm corner clouds), space (5 tinted nebula
  clouds + a soft low region), jungle (waterfall mist puffs + faint haze),
  fantasy (moon halo + horizon glow).
- Cloud layers are managed images (depth −98) participating in the theme
  crossfade (complementary group alphas), rebuilt on resize, destroyed
  cleanly. The fantasy **moon disc** moved to a crisp Graphics (depth −97)
  drawn above its soft halo.
- Kept: stars + glints, gradients, the square grid, and every illustrated
  environment (hills, waterfall, tree line, canopy, vines, ruins…).

### Real-browser evidence

Hard-edge scan of the background band (luminance steps ≥ 6, grid/stars
excluded): **light/space/jungle = 0 steps per row** (the gradient clouds are
perfectly smooth); fantasy = 3/row (the palm-frond silhouette — an
illustrated shape, allowed). Atmosphere preserved (σ 25–48). Moon crisp
(lum 241) over a soft halo. Crossfades run clean (mid-transition +
settled screenshots). Mobile (390×844) space/jungle pass.

---

## §3 Discovery effect — comic-book panel

### Fix (`DiscoveryOverlay.ts`)

The panel now composes:

- **Orange halftone dot burst** behind the character — four staggered rings
  **fanning out from the ball's edge** (never hidden behind the ball; the
  first version's inner rings were invisible behind the 99 px ball — caught
  and fixed via pixel probe), shrinking and fading outward, popping in with
  the character.
- **Two clean horizontal lines in the discovered ball's tier color** (ink
  outline), each end carrying **sharp yellow/black diamond accents** (a
  large diamond + two small offset ones).
- The lines **slam open from the center** (drawn in relative coordinates so
  the scale-wipe pivots mid-screen) and **flash white twice**.
- Kept: `NEW BALL DISCOVERED!` yellow/black title, darkened full-screen
  background, dramatic character reveal (Back.easeOut pop + landing shake),
  clean exit. No diagonal rays, no plain red bars, no rectangular panel
  edges. Tiers 1–3 never trigger.

### Real-browser evidence (pixel-verified mid-reveal)

Tier-4 lines above/below (78/71 red samples), ball centered (48), **halftone
burst 179 orange dot samples**, diamond accents 4/4 line ends, title 299
yellow samples, corners uniformly dim (lum 21 — no rays), clean exit, no
repeat for tier 4, tiers 1–3 silent.

---

## §4 Tier progression — polished path

### Root cause

The 2.13.0 desktop arc spanned only ~146 px on screen for **ten** nodes
(~30 px diameter each) — the nodes stacked ~50% on top of each other, hiding
the curve and the faces (pre-existing at every landscape size; even the
reference layout overlapped).

### Fix (`TierProgression.ts`, `ResponsiveLayout.ts`)

- **Wide arc** across the bottom-left free zone: reference-space circle
  center (184, 1560), r 777, sweep −1.7085 → −1.0662 rad — nodes from
  ref (80, 790) to ref (560, 880) with ~55 px spacing; verified clear of
  the container (outer-left ≈ 0.36·vw) at every landscape size.
- **Character nodes**: discovered tiers render the actual ball through the
  shared appearance pipeline (rest contour, tier fill, ink outline, face;
  tier 8 rainbow / tier 9 fantasy identities preserved).
- **Locked nodes**: dark discs with enlarged white `?`.
- **Smooth two-tone curve**: soft dark under-stroke + bright blue over-line
  with lead-in/out tails beyond the end nodes.
- **Unlock animation**: character pop (scale overshoot) + yellow glow flash
  + expanding ring pulse.
- Tiers 1–3 unlocked from the first session; later tiers unlock from real
  gameplay (`state:discovered`); abilities untouched.

### Real-browser evidence

Per-node pixel verification at computed positions: tier 1 cyan / 2 green /
3 pink character nodes, 7/7 dark locked nodes, `?` glyphs present, curve
visible in the inter-node gaps — at 1170×658, 1648×936, 1920×1080
(`progression-viewports-2132.mjs`) and the portrait row at 390×844.
Gameplay-driven unlock verified (T4 discovery → progression `[1,2,3,4]`).

---

## Gates

- `npx vitest run`: **200/200** (2 new emergency-placement tests)
- `npm run typecheck`: clean · `npm run lint`: clean · `npm run build`: ✓
- Browser suites: `phase2132.mjs` **37/37**, `phase2131.mjs` all pass,
  `verify-merge-locality.mjs` all pass, `phase2121-pixels.mjs` +
  `phase2121-viewports.mjs` all pass, `progression-viewports-2132.mjs` 3/3

## Key screenshots (`qa/screens/p2132/`)

- Crowded merges: `01-crowded-merge-{left,right}.png`, `verify-loss-*.png`,
  `repro-loss-*.png` (the defect, pre-fix), `diag-loss.png`
- Discovery: `03-discovery-panel.png`, `probe-halftone.png`
- Themes: `02-theme-{light,space,jungle,fantasy}.png`,
  `02-theme-midcrossfade.png`, `02-theme-after-crossfade.png`,
  `05-mobile-theme-*.png`
- Progression: `04-progression-start.png`, `04-progression-unlock-pop.png`,
  `progression-{1170x658,1648x936,1920x1080}.png`, `05-mobile-progression.png`

## Files changed

- `src/game/systems/MergeSystem.ts` — transactional order, `computePlacement`
  / `commitPlacement` split, aged-pending emergency, `emergency` QA field
- `src/game/systems/mergePlacement.ts` — `PlacementOptions.allowOverlap`
  (least-penetration local fallback)
- `src/config/merge.ts` — `pendingEmergencyMs: 900`
- `src/game/systems/merge-placement.test.ts` — 2 emergency-mode tests
- `src/game/rendering/BackgroundTheme.ts` — gradient cloud texture, irregular
  clouds per theme, cloud-layer lifecycle (crossfade/resize/destroy), crisp
  moon; all `softGlow` uses removed
- `src/game/rendering/DiscoveryOverlay.ts` — halftone fan, diamond accents,
  center-origin line wipe, halftone pop entrance
- `src/ui/TierProgression.ts` — character nodes, two-tone curve + tails,
  unlock glow/ring pulse, enlarged `?`
- `src/ui/ResponsiveLayout.ts` — wide progression arc (desktop)
- `qa/phase2132.mjs` (37 checks), `qa/verify-merge-loss.mjs`,
  `qa/progression-viewports-2132.mjs`, `qa/probe-merge-loss.mjs` +
  `qa/diag-merge-loss.mjs` (defect reproduction records)

## Limitations

- The emergency fallback spawns the replacement touching its neighbors and
  lets the soft solver separate them (moderate overlap only, least-penetrating
  candidate, strictly local). Observed worst-case locality for such merges:
  308 px from the source midpoint (within the 320 px ring bound).
- Reference videos remain uninspected (no video tooling).
- The space "no rings" check is calibrated to *visible* edges: the gradient
  clouds legitimately have smooth (sub-threshold) falloffs by design.
