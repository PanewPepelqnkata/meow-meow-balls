# Phase 2.13.4 — Delivery Report

**Fix disappearing merge balls + subtle-but-dramatic discovery animation.**
All changes verified in the real browser; physics and gameplay preserved.

---

## §1 CRITICAL — balls disappearing during crowded merges

### Root cause (confirmed, exact)

The suspected bug was **real**. `SoftBallRenderer.update()` skipped every ball
whose lifecycle state was not `'active'`:

```ts
// BEFORE (src/game/rendering/SoftBallRenderer.ts)
if (r.state !== 'active') continue   // ← merging balls NOT drawn
```

Since Phase 2.13.3, deferred merges lock their source balls with
`state = 'merging'` — a state that means "real ball, still in the world,
holding its pocket open until the replacement commits". The renderer's guard
made **both sources vanish visually for the entire pending window** (up to
~900ms, longer under repeated crowding): two balls touch, both disappear,
then one bigger ball pops in elsewhere.

The 2.13.3 browser verification missed this because it compared the
renderer's **registry size** (`rendererBalls`) against logical counts — and
the registry *does* include merging balls. Registry membership and actual
drawing were silently different things.

(History: the `!== 'active'` guard was a Phase 2.10.2 fix for a different
flow — back then merges removed sources first and a stale registry entry
could draw a source *beside its replacement*. That defect stays fixed by the
`'removed'` check plus the registry sync: sources are removed in the SAME
frame the replacement spawns, so a merging ball can never coexist with its
own replacement.)

### Fix

`src/game/rendering/SoftBallRenderer.ts`:

- The draw guard is now `if (r.state === 'removed') continue` — a merging
  ball is a deferred-merge source that **must** be drawn; a removed ball
  must never be.
- New per-frame draw tracking: `lastDrawnIds` (cleared and repopulated in
  `update()`), exposed as `drawnSize` and `isDrawn(id)` — QA can now prove
  what was actually drawn, not just registered.
- `visualState().rendererDrawn` reports the drawn count next to the registry
  count (must be equal).

### Transaction logging (requested instrumentation)

`src/game/systems/MergeSystem.ts` — new read-only `mergeTransactions` log
(capped 32, cleared on restart): one `MergeTransactionRecord` per accepted
pair from reservation to resolution:

- `tx` (monotonic id), `tier`, `aId`/`bId`
- `deferred`, `pendingMs`, `emergency`
- `replacementId` (once spawned), `outcome` (`pending` | `completed` | `dropped`)

The record is opened the moment a pair is reserved, threaded through the
`PendingReplacement`, and closed atomically at `commitPlacement`. The
defensive drop path marks `dropped` (unreachable in production; assert-never
in QA). Exposed as `__brScene.mergeTransactions()`; `__brScene.isDrawn(id)`
and `ballDetail().state` complete the picture (source states + renderer
visibility).

### Regression tests

`src/game/systems/merge-pending.test.ts` — new suite **"Phase 2.13.4:
REPEATED merges at the crowded top — every transaction resolves"**:

- near-full checkerboard pile, then **three consecutive merge rounds** at
  the crowded top (alternating sides), each under the per-frame exact
  accounting invariant (`countBefore − countAfter === Δ mergesCompleted`,
  `replacementsCreated === mergesCompleted`, `sourcesRemoved === 2×`);
- while any transaction is pending, **both its sources must still be in the
  world** (the browser proves they are *drawn* via `isDrawn`);
- every round's transactions complete with exactly one replacement id each
  (`expectTransactionsClean`), nothing dropped;
- bounded drain (emergency fallback) then a quiescent final state;
- no-bury check: every pair's centroid separation ≥ 0.55 × (rA + rB) — well
  above the historic "second ball inside the merged ball" burial (0–0.3),
  tolerant of this test's deliberately overpacked jam spawns (the strict
  placement no-bury guarantee is unit-tested in `merge-placement.test.ts`).

Full suite: **206/206** (was 205; +1 test), typecheck/lint/build clean.

### Browser reproduction (real, transaction-logged)

`qa/phase2134.mjs` §1 — three repetitions of the crowded-top merge scenario
(nearly full 4-row T4/T5 pile below the rim, touching T5 pair dropped at
top-left / top-right / top-center; restart between rounds so the pile never
overflows). Per-sample atomic snapshot of: ball counts, drawn counts,
transaction log with live source states + `isDrawn`, game-over state.

Results (39/39 total suite pass):

- **Every transaction completed with exactly one replacement** — 5
  completed / 0 pending / 0 dropped in the final round; each round asserted
  independently.
- **Renderer visibility during pending windows: 55/55 samples had both
  locked sources drawn** (`tx#13 … #31(merging,drawn=true)
  #34(merging,drawn=true)`) — this is the exact defect, now proven fixed
  live.
- `rendererDrawn === rendererBalls` at every sample (drawn count always
  matched the registry — merging sources included).
- No unaccounted ball loss across all three rounds (every count drop
  matches a completed merge).
- Pending durations bounded: max observed 925ms (emergency fallback at the
  900ms `pendingEmergencyMs` deadline).
- No teleporting: worst replacement locality 179px from the source midpoint.
- Transaction log excerpt (final round):
  - `tx#11 T5+T5 → #30 (tier 6), immediate`
  - `tx#12 T4+T4 → #36 (tier 5), deferred, pending 900ms, emergency`
  - `tx#13 T5+T5 → #38 (tier 6), deferred, pending 900ms, emergency`
  - `tx#15 T6+T6 → #39 (tier 7), immediate` (cascade of replacements)

Evidence: `qa/screens/p2134/01-crowded-top-*.png`.

### Behavior notes (documented, intended)

- **Game-over freezes pendings safely.** When game-over fires (genuine
  overflow), the scene intentionally stops stepping physics and merges; a
  pending merge created just before stays *safely pending* with its sources
  visible (drawn) until restart clears the world. This satisfies the
  contract ("completes OR remains safely pending with sources visible") and
  was observed live during QA iteration: frozen sources kept
  `merging, drawn=true` and the restart cleared them. The QA suite keeps
  its pile below the rim so the strict all-resolved assertions run on a
  live scene; a fifth pile row at y=730 sits above the wall top and
  triggers genuine overflow.
- A QA-spawned pair ball may legitimately merge with a *pile* ball instead
  of its partner (or rest unmerged); the per-round assertion accepts any
  resolution in which every transaction completes and no source is stuck
  merging.

---

## §2 — Discovery: subtle but dramatic

### Design change (supersedes the 2.13.3 full-bleed comic)

`src/game/rendering/DiscoveryOverlay.ts` — full rewrite:

- **The game background stays visible.** Only a gentle dim (alpha 0.42)
  covers the world — no full-screen red/yellow/blue panels, no radial burst.
- **One thick filled horizontal band across the middle**, full-width,
  colored to match the discovered ball (single source of truth: the tier
  config color), with a darker lower-third shade, 6px ink edges, a halftone
  print row inside the top edge, and short tapered ink **emphasis ticks**
  around the character (comic accents — deliberately not rays).
- **The character is centered ON the band**, on a cream spot-disc (ink
  outlined) so it pops against its own tier color; drawn through the shared
  appearance pipeline (the exact ball that was spawned).
- **Brief flashing highlights**: a white edge-highlight line along each band
  edge plus yellow 4-point sparkles at the band's thirds — one hard blink
  then settling, ~700ms.
- **Quick punch-in**: the panel (band + disc + character + ticks) snaps in
  from 0.74 scale with a Back overshoot (~240ms) plus a short impact shake
  (skipped under reduced motion); the character pops and the title slams.
- **Title** `NEW BALL DISCOVERED!` — bold yellow with black outline and
  drop shadow, readable over the dimmed scene; tier label below.
- Functional contract preserved: tiers 1–3 never trigger it, no repeats,
  clean exit, responsive (geometry recomputed on resize), update() is an
  intentional no-op.

### Verification (real browser)

`qa/phase2134.mjs` §2 + the shared composition checks (new
`qa/lib-discovery.mjs`, also used by phase2131/2132/2133 — one place for
the discovery pixel contract):

- corners show the dimmed game — no comic-saturated full-screen panels
  (quiet fractions 1.00/1.00/1.00/1.00 desktop; mobile 0.64+ with HUD
  chrome tolerated — a comic full-bleed scores ~0.0);
- the game scene is visible through the gentle dim: 32.8% (desktop) /
  37.2% (mobile) colored gameplay pixels below the band;
- one tier-colored horizontal band across the middle, full width (6/6
  sample points tier-red at both edges, desktop + mobile);
- band is thick: 188px of tier-red on a vertical scan (band height 197px)
  desktop; 222px (of 240) mobile;
- cream spot-disc (24/24 ring samples) with the character centered on it;
- bold yellow title with black outline (1656 yellow px / ~20k ink px
  desktop; 829 / 8.2k mobile);
- comic accents: halftone print row (63 dot-core samples desktop, 39
  mobile) + ink emphasis ticks (32/60 and 8/60 ring samples);
- brief flashing highlights verified in an early frame: 3/3 sparkle spots
  bright at ~230ms into the entrance;
- appears for first-time tier 4, presents tier 4, exits cleanly, repeats
  never re-trigger (a follow-up panel showed the legitimate NEW tier 5),
  tier 1–3 merges never trigger it;
- responsive mobile pass (390×844).

Evidence: `qa/screens/p2134/02-discovery-early.png` (flash mid-blink +
punch-in), `03-discovery-band.png` (settled, desktop),
`04-discovery-band-mobile.png`.

---

## Gates

- Unit: **206/206** (29 files) — includes the new repeated-top-merge
  transaction regression.
- `tsc --noEmit` clean; `eslint .` clean; production build ✓.
- Browser suites, all re-run against the new band design (their
  discovery-composition checks now live in `qa/lib-discovery.mjs`):
  - **phase2134: 39/39** (§1 transaction-logged crowded-top reproduction +
    §2 band discovery, desktop + mobile)
  - **phase2133: 39/39** (crowded merges ×4 + band discovery desktop/mobile)
  - **phase2132: 40/40** (merge loss, themes, discovery, progression)
  - **phase2131: ALL CHECKS PASSED**
  - **verify-merge-loss: NO MERGE LOSS** (worst deferral 942ms)
  - **verify-merge-locality: VERIFIED** (worst locality 174px, max push
    60.0px at cap, no teleport, no burial)
  - **phase2121-pixels: ALL CHECKS PASSED**; **phase2121-viewports: ALL
    VIEWPORTS FULLY COVERED**; **progression-viewports-2132: VERIFIED**

## Files changed

- `src/game/rendering/SoftBallRenderer.ts` — draw guard `'removed'`-only
  (the fix), per-frame `lastDrawnIds` + `drawnSize`/`isDrawn`.
- `src/game/systems/MergeSystem.ts` — `MergeTransactionRecord` +
  `mergeTransactions` log threaded through reserve → pending → commit.
- `src/game/scenes/PlaygroundScene.ts` — `mergeTransactions()`, `isDrawn()`
  DEV hooks, `rendererDrawn` in visualState, `state` in ballDetail.
- `src/game/rendering/DiscoveryOverlay.ts` — band presentation rewrite.
- `src/game/systems/merge-pending.test.ts` — repeated-top transaction
  regression (+ the no-bury centroid check).
- `qa/lib-discovery.mjs` — NEW shared discovery composition checks.
- `qa/phase2134.mjs` — NEW phase suite (transaction-logged crowded-top
  reproduction + band discovery, desktop + mobile).
- `qa/phase2131.mjs`, `qa/phase2132.mjs`, `qa/phase2133.mjs` — discovery
  sections now use the shared band checks (the 2.13.3 full-bleed comic
  expectations were obsolete by this design change).

## Known limitations

- Game-over intentionally freezes physics: pendings created just before
  game-over stay safely pending (sources visible) until restart — verified
  live, documented above.
- Emergency-resolution replacements may touch neighbors in a genuinely full
  container and stay compressed until the player makes room (the solver
  separates once there is anywhere to go).
- The QA pile spawns are deliberately overpacked (jam spawns) to force
  deferrals; their contact skins interpenetrate more than a natural pile —
  the no-bury assertion is centroid-based for that scenario.
