# Phase 2.13.3 Delivery — Two Targeted Fixes

Scope (user spec, nothing else touched — physics and gameplay preserved):

1. **§1 Stop balls disappearing during crowded merges** — `MergeSystem.ts`
2. **§2 Rebuild the discovery screen in genuine comic-book style** — `DiscoveryOverlay.ts`

---

## §1 Merge visibility / no-loss

### Root cause

`tryMerge()` removed BOTH source balls *before* a valid replacement position
existed. When `computePlacement()` returned `null` (jammed pile), the sources
were already gone from the world and the merge existed only as a
`PendingReplacement` record. Two consequences:

- **Visibility gap** — for every deferred frame there were two fewer balls on
  screen with nothing replacing them (the "balls disappearing" report).
- **Loss risk** — the freed pocket invited the settling pile to collapse into
  it, so retries could fail against a *closed* pocket. The 2.13.2 emergency
  fallback capped the loss window at ~900 ms but the deferral frame itself
  still dropped two balls at once.

### Fix (`src/game/systems/MergeSystem.ts`)

The transaction was reordered so **nothing leaves the world until the
replacement position is secured**:

- `tryMerge()` computes placement FIRST (the reserved pair is excluded from
  the obstacle list — its envelopes must not block the replacement). On
  success: `removeSources` + `commitPlacement` in the same frame (no pending
  window at all, as in 2.13.2).
- **On deferral the sources STAY** — visible, physically intact, locked in
  `'merging'` state (`tryMerge` rejects non-active balls, so no other merge
  can take them; revalidated contacts skip them). Their bodies keep holding
  the pocket open, so a settling pile can never close the space the
  replacement needs — the loss mechanism is structurally gone.
- `PendingReplacement` now carries `aId`/`bId`. `processDeferred()` re-resolves
  each pending against the **live pair** (midpoint recomputed every retry),
  and commits atomically: both sources removed + exactly one replacement
  created in ONE frame. There is never a frame where the merge's balls are
  missing.
- Emergency fallback (`MERGE.pendingEmergencyMs = 900`) unchanged; with the
  sources excluded from the obstacle list their own pocket is the
  least-penetrating spot, so aged pendings resolve *into* the pair's space.

### Behavioral note (QA bound updated)

With the sources retained, a wedged pair's replacement claims the pair's exact
space, so a crowded core can legitimately nudge a few more neighbors than the
old remove-first flow (which left a void). The safety bounds are unchanged and
now *measured* rather than inferred: `MergeLocalityRecord.maxPushPx` records
the largest single displacement, and `verify-merge-locality.mjs` asserts every
push ≤ 60 px (`MAX_PUSH`, unit-enforced) instead of the old "≤ 3 neighbors per
merge" count observation.

### New QA plumbing (DEV-only, read-only)

- `MergeSystem.pendingSnapshot()` → `{ pending, mergingIds }`, exposed as
  `__brScene.mergePending()` — lets browser tests observe the live pending
  window and verify the locked sources remain in the world.

### Regression tests

- **Unit** — `src/game/systems/merge-pending.test.ts` (5 new tests, 205 total):
  - a jammed interior merge keeps BOTH sources in the world while pending
    (the pending window is genuinely exercised — guarded, not assumed), then
    resolves atomically;
  - **per-frame exact accounting invariant**: `countBefore − countAfter ===
    Δ mergesCompleted` every frame (any lost merge or duplicate replacement
    breaks the equality), plus `replacementsCreated === mergesCompleted` and
    `sourcesRemoved === 2 × mergesCompleted`;
  - nearly full container (5 offset rows), merges near the TOP (left/right)
    and DEEP near both walls — all under the accounting invariant, with
    end-state no-bury scans (`worstPairOverlap ≤ 2.5`).
- **Browser** — `qa/phase2133.mjs` §1: the same four crowded cases in the
  real game; per-sample accounting (live count may only drop by the number of
  newly completed merges), `mergePending()`-verified source visibility during
  pending windows, tier-6 replacement always appears.

### Evidence

- `qa/screens/p2133/01-crowded-{top-left,top-right,deep-left-wall,deep-right-wall}.png`
- `qa/verify-merge-loss.mjs` → **NO MERGE LOSS**; worst deferral 925 ms
  (aged pendings resolve via the emergency path by design).
- `qa/verify-merge-locality.mjs` (3 consecutive runs) → VERIFIED; worst
  locality within the 320 px ring bound; max single push 60.0 px (exactly the
  enforced cap); no buries, no teleports.

---

## §2 Genuine comic-book discovery screen

### Root cause (design)

The 2.13.2 panel used two tier-color horizontal lines + a circular orange
halftone ring — a clean but generic "reveal card", not a comic-book
illustration.

### Fix (`src/game/rendering/DiscoveryOverlay.ts`)

Full rewrite of the presentation as a **full-screen comic illustration**
(all geometry is viewport fractions; the UIScene camera is 1:1 with the
viewport, so it covers every pixel at every size):

- **Three slanted sections**: bold comic red left, bright yellow→orange
  vertical-gradient center, bold comic blue right, with angled dividers and
  deep-tone lower bands (panel energy, no plain vertical splits).
- **Black tapered radial ink lines** — 26 manga-style wedges radiating from
  the character (thin near the center, bold toward the edges; two alternating
  inner radii). Base widths scale with the viewport (`vw/1170`, clamped) so a
  phone screen keeps the same section/ray proportions (fixed 16–34 px widths
  drowned a 390 px screen — found and fixed during browser verification).
- **Dense halftone dot field** — hex-packed grid across the whole screen,
  dot size and ink density graded by distance from the character, with a
  clearing around the discovery for readability.
- **Cream 12-spike starburst** with ink outline backs the character; the
  character is drawn through the SHARED appearance pipeline (the exact ball
  that was spawned — face, outline, special tiers 8/9 included), centered.
- **Bold yellow `NEW BALL DISCOVERED!`** title with a thick black stroke and
  drop shadow at the top; `Tier N` label below the character.
- **Entrance**: the panel SLAMS in (scale 1.12 → 1, Back.easeOut) with a
  one-shot white impact flash; the character pops; a short impact shake
  (skipped under reduced motion). Exit fade and the gameplay step gate are
  unchanged.
- Removed: the horizontal bars, the circular halftone ring, the diamond
  accents, and the per-frame line-flash driver (`update()` is now an
  intentional no-op — the illustration is static after the entrance).

### Evidence (pngjs pixel verification — no visual inspection claimed)

- `qa/screens/p2133/02-comic-discovery.png` (1170×658) and
  `03-comic-discovery-mobile.png` (390×844):
  - red left section (100% red at 0.11w) / blue right section (100% blue at
    0.89w) / warm yellow-orange center (8 warm + 3 cream of 15 grid points,
    0 side-section bleed);
  - black tapered radial ink lines (12/120 ring samples ink);
  - dense halftone field (319 dot-core px in a 70×50 red-zone patch);
  - cream starburst (24/72 ring samples), centered tier-4 character (147 red
    samples), yellow title (9160 px) with black outline (3626 ink px);
  - full-bleed: all four corners comic-covered (no inset rect).
- Functional contract preserved: panel appears for first-time tier 4, exits
  cleanly and gameplay resumes, repeat tier-4 merges never re-trigger the
  panel (a following T5 discovery is legitimate), tiers 1–3 never trigger.
- Responsive: mobile pass at 390×844 (sections, center, character all
  verified).

---

## Suite updates

- `qa/phase2133.mjs` (new, 33 checks) — both fixes, desktop + mobile.
- `qa/phase2131.mjs` §3 and `qa/phase2132.mjs` §3 — discovery pixel checks
  rewritten for the comic composition (the two-lines / orange-burst /
  dim-corners expectations were obsolete by design change). Both suites pass
  in full (2131: ALL CHECKS PASSED, 2132: 39/39).
- `qa/verify-merge-locality.mjs` — push bound now measures the true per-push
  cap (`maxPushPx ≤ 60`) instead of the neighbor-count observation.
- **Retired**: `qa/phase2122-discovery.mjs` — already failing before this
  phase (its T1+T1→T2 modal premise was superseded by the tiers-1-3-known
  change), and its dim-edge scans are invalid under the full-bleed comic
  design. Full-bleed coverage is now asserted in 2131/2132/2133 corner
  checks. Left on disk as the 2.12.2 historical record.

## Gates

- Tests: **205/205** (5 new in `merge-pending.test.ts`)
- `tsc --noEmit`: clean · `eslint`: clean · `npm run build`: ✓ (pre-existing
  chunk-size warning only)
- Browser: phase2133 **33/33** · phase2131 **ALL PASSED** · phase2132 **39/39**
  · verify-merge-loss **NO MERGE LOSS** (worst deferral 925 ms) ·
  verify-merge-locality **VERIFIED** (3 runs) · phase2121-pixels ·
  phase2121-viewports · progression-viewports-2132 — all pass.

## Files changed

- `src/game/systems/MergeSystem.ts` — pending carries the locked pair;
  sources retained on deferral; atomic resolution; `pendingSnapshot()`;
  `maxPushPx` in locality records.
- `src/game/systems/merge-pending.test.ts` — new regression suite.
- `src/game/rendering/DiscoveryOverlay.ts` — full comic-book rewrite.
- `src/game/scenes/PlaygroundScene.ts` — `mergePending()` DEV hook.
- `qa/phase2133.mjs` (new), `qa/phase2131.mjs`, `qa/phase2132.mjs`,
  `qa/verify-merge-locality.mjs` — updated/new suites.

## Limitations

- The supplied reference composition image was not machine-inspected; the
  illustration was built from the written description (sections, rays,
  halftone, title, centered character).
- Aged-pending emergency spawns may touch neighbors (the soft solver
  separates them within a few frames); worst observed locality stays within
  the 320 px ring bound.
- Emergency-resolution counts reported by `verify-merge-loss.mjs` are
  cumulative session stats, not per-case.
- All screenshot verification is pngjs pixel analysis (image viewing is
  filtered in this environment); screenshots are on disk for human review.
