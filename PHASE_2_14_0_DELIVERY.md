# Phase 2.14.0 — Merge Immediacy + Start Screen

Two deliverables:

1. **§1 MERGE DELAY (priority)** — merges had a huge visible delay before the
   new ball appeared. Root cause found and removed; normal merges now commit
   on the frame they fire.
2. **§2 START SCREEN** — a polished main menu in the game's own universe:
   START / LEADERBOARD / JOURNAL / SETTINGS / COLLECTION, persistent
   discovery journal with per-run tier-8/9 variants, local leaderboard, theme
   pinning. Gameplay UI untouched.

---

## §1 Merge delay — exact root cause and fix

### Root cause (traced through the full reserve → placement → replacement lifecycle)

Pair touches → reserve both → **strict** placement search (clear midpoint →
clear ring → bounded squeeze with ≤60px pushes that must bury no one). In a
crowded pile the strict search **cannot** succeed — neighbors cannot be
shoved 60px without burying a third ball — so the merge **deferred**.
Retries failed every frame because a genuinely full pile never relaxes on
its own, and at age ≥ 900ms the **emergency** path committed at the
least-penetrating local spot: *exactly the result frame 1 would have
produced, minus the 900ms*. The transaction logs proved it: every crowded
merge completed at `pending=900/917/925/942ms, emergency=true`. The wait
bought nothing — the visible delay was entirely the deferral window.

### The fix (no workaround — the placement policy itself changed)

`placeMergedBall` gained an overlap **policy** (`strict | bounded | always`)
instead of the boolean aged-emergency flag:

- **`bounded` (fresh merges + every retry)** — the **no-swallow rule**: when
  the strict paths fail, commit **immediately** at the least-penetrating
  local candidate whenever the worst overlap keeps both centers outside each
  other's envelopes (`overlapPx ≤ min(rNew, overlapR) + 1`). The soft-body
  contact solver separates the touching balls over the next frames — exactly
  what the aged emergency produced, minus the wait. Never a teleport (the
  candidate comes from the bounded ring search), nothing shoved.
- **`always` (aged pendings, the 2.13.2 backstop)** — unchanged: a jammed
  pile can never lose a replacement.
- **`strict`** — preserved for tests; identical to the 2.10.2 behavior.

Measured reality that shaped the rule: in a packed pile the natural
equilibrium overlap is 47–133px (a fixed 48–60px budget still waited 900ms),
while "swallowing" starts only when one center enters the other's envelope.
The no-swallow rule is the physically meaningful boundary.

Every commit now records `overlapPx`/`overlapR`; the transaction log carries
`overlapPx` so QA can prove the bound.

### Evidence (real browser, transaction-logged)

- **`qa/phase2140.mjs` §1 — 20/20.** Repeated merges at the crowded top of a
  nearly full container (3 rounds, restart between): every dropped pair
  completed within **≤58ms** (vs 900–942ms before), **zero emergency
  commits**, no unaccounted loss, renderer visibility intact, worst locality
  173px. Deep interior merge: immediate (0ms), nothing dropped.
- **`verify-merge-loss` — NO MERGE LOSS; worst deferral 58ms, 0 emergency
  resolutions** (was 942ms pre-fix).
- **`verify-merge-locality` — verified** (no teleports, no buries).
- Unit: new `Phase 2.14.0` describe in `merge-pending.test.ts` — crowded top
  merges commit within a few frames and never touch the emergency deadline
  (the exact user-facing contract); a genuinely impossible crush (full-width
  T3/T4 lattice) still defers, keeps both sources in the world, and resolves
  bounded via the backstop. The old "jammed interior" checkerboard no longer
  defers — its lattice gaps now admit an immediate no-swallow commit, which is
  the fix working as intended — so the retention tests moved to the crush.
- `merge-placement.test.ts`: new no-swallow policy test (the 2.13.2 jam now
  commits immediately at 17px overlap); aged-guarantee tests updated to the
  policy API.
- Settle tolerance in crowded-case tests moved 2.5 → 8px: immediate overlap
  commits leave a small resting squish in a genuinely overpacked pile that
  the solver takes a long time to squeeze out (still nothing like a bury —
  smallest ball radius there is 62px).

---

## §2 Start screen

### What was built

**`src/game/scenes/TitleScene.ts`** — a Phaser scene rendered above
everything (last in the scene list), launched once per game boot by
PlaygroundScene:

- **Menu**: dusk veil (0.62) over the live themed background — the game
  universe shows through; "BALL RUSH" in the game's display font (yellow +
  ink stroke); a blinking, bobbing tier-5 mascot; 8 floating ball characters
  (tiers 1–7) drawn through the exact gameplay appearance pipeline
  (`restContour` + tier fill + ink outline + face), sine-driven bob/sway.
- **Buttons**: the HUD's own `CartoonButton` — START (green, larger),
  LEADERBOARD (yellow), JOURNAL (blue), SETTINGS (purple), COLLECTION
  (orange), with hand-drawn white icons in the ability-button style.
- **JOURNAL**: all 10 tiers as cards — discovered ones colored with their
  face, undiscovered as dark silhouettes with '?', tier 10 as the locked
  final secret. **Tiers 8–9 collect their per-run VARIANTS** as chips
  (collected = drawn with that variant's look; missing = dashed '?').
- **COLLECTION**: the full tier gallery with a progress bar (N/10
  discovered) and FOUND/'?' cards.
- **LEADERBOARD**: top-10 runs (medal cards, best-tier ball badge, score,
  date) from the persistent save; personality empty state.
- **SETTINGS**: theme pinning (AUTO / LIGHT / SPACE / JUNGLE / FANTASY —
  applies to the live background and survives reloads; AUTO keeps run
  progression), lifetime stats, and a two-press RESET PROGRESS (wipe).
- **START**: fade-out, gameplay input unlocks via `gameBus 'ui:start'`; the
  scene stops itself for good — restarts and Play Again never re-show it.

**`src/game/state/save.ts`** — versioned localStorage save (`ballrush.save.v1`):
best score, leaderboard, discovered tiers (pre-seeds 1–3), tier-8/9 variant
collection, settings, lifetime stats. Fully guarded (private mode / blocked
storage / corrupted JSON degrade to in-memory). Game over records the run
(leaderboard entry + best score); the HUD BEST now seeds from the save.

**`src/game/state/runVariant.ts`** — per-run variant identity for tiers 8–9:
a run seed rolled at every run start; `variantIdFor(tier)` = stable hash → 8
variants each. T8 = rainbow ring rotation + wedge count; T9 = body/horn/mane
palette + star accents. The same variant renders everywhere a ball can
appear: world renderer, discovery overlay, crane, next-ball preview, and the
menu chips. Every T8/T9 ball in one run shares the look; the next run rolls
a new one — and first-time discoveries record the variant in the journal.

**Input gating** — while the menu is up, `session.menuActive` gates drops,
swap, raise and R-restart (the same gate style as game-over/discovery);
pointer input is disabled via the existing `InputController.setEnabled`.
START re-enables it with the existing 400ms drop-suppression window (the
START click must not also drop a ball). **`?fastboot=1`** (dev-only) never
launches the menu — the QA suites' default URLs now include it.

### Evidence

**`qa/phase2140-menu.mjs` — 48/48** (desktop 1170×658 + mobile 390×844):

- Menu mounts at boot; composition verified in pixels (dusk veil, yellow
  title, 3/3 floating-character spots colorful); five buttons in order with
  real rects.
- Every panel opens and returns via BACK (journal fresh-state probes:
  tier-1 colored, tier-4 silhouette + '?'; collection 3/10 progress bar).
- SETTINGS theme pinning visibly switches the background (space = deep dark)
  and AUTO restores it.
- Clicks while the menu is up drop nothing; after START a real pointer drop
  spawns a ball; restart never re-shows the menu.
- **Persistence across reload**: a T3+T3 merge records tier 4 (journal shows
  it colored after reload); a T7+T7 merge records **tier 8 + its per-run
  variant** (`8:1` style keys); a genuine overflow (touched ball beyond the
  wall band, below the tops — the exact config/gameOver.ts rule) records a
  leaderboard entry (score 16, bestTier 4) and the best score; the
  leaderboard row renders after reload.
- Mobile: all five buttons fit, journal single-column, BACK and START work.

### Files changed

- `src/game/systems/mergePlacement.ts` — overlap policy (`strict/bounded/
  always`), `overlapPx`/`overlapR`, no-swallow immediate commit.
- `src/game/systems/MergeSystem.ts` — policy threading (fresh/retry =
  bounded, aged = always), `overlapPx` in the transaction record.
- `src/game/systems/merge-pending.test.ts`, `merge-placement.test.ts` —
  new-contract tests + crush scenario for the retention contract.
- `src/game/scenes/TitleScene.ts` (new), `src/game/state/save.ts` (new),
  `src/game/state/runVariant.ts` (new), `src/game/state/session.ts` (new).
- `src/game/scenes/PlaygroundScene.ts` — menu input gating, `ui:start`,
  persistence recording (discovery/variant/run end), best score from save,
  run-seed roll per run, pinned-theme respect, leaderboard best-tier
  tracking.
- `src/game/scenes/BackgroundScene.ts` — pinned theme at boot.
- `src/game/rendering/BallAppearance.ts` — variant parameters for
  `drawRainbowBall`/`drawFantasyBall` (variant 0 = original look).
- `src/game/rendering/SoftBallRenderer.ts`, `DiscoveryOverlay.ts`,
  `src/ui/NextBall.ts`, `src/ui/DropClaw.ts` — pass the run variant.
- `src/game/GameRoot.ts` (TitleScene registered), `src/game/events/gameBus.ts`
  (`ui:start`).
- `qa/phase2140.mjs` (§1), `qa/phase2140-menu.mjs` (§2/§3); all existing QA
  suite default URLs now use `?fastboot=1`.

### Gates

- Unit: **209/209** · typecheck clean · lint clean · build ✓
- Browser: phase2140 20/20, phase2140-menu 48/48, phase2134 39/39,
  phase2133 39/39, phase2132 40/40, phase2131 ALL PASSED, phase2121-pixels
  ALL PASSED, progression-viewports-2132 verified, verify-merge-loss
  NO MERGE LOSS (worst 58ms), verify-merge-locality verified.
- Evidence: `qa/screens/p2140/`, `qa/screens/p2140-menu/`.

### Known limitations

- Emergency replacements may touch neighbors in a genuinely impossible jam
  (by definition); the soft solver separates them — unchanged from 2.13.2.
- The QA crush scenario is deliberately overpack-lattice-scaled; real
  gameplay should essentially never defer after this change (the browser
  evidence shows zero deferrals >58ms in the crowded scenarios).
- Leaderboard is local-only (per-browser, no backend); Settings has no audio
  controls (the game has no sound system yet).
- Tier 10 remains the intentionally locked placeholder (silhouette + '???'
  in journal/collection).
