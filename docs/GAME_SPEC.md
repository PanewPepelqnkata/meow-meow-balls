# BALL RUSH — Game Specification

Version: 0.2 (updated for menu + gameplay reference screenshots — awaiting user review)
Status: Implementation in progress; review checkpoints in IMPLEMENTATION_CHECKLIST.md.

---

## 1. Overview

Ball Rush is a free, browser-based ball-merging arcade game for desktop and mobile.
Players drop balls into a container; matching balls merge into the next tier, scoring
points and triggering chain reactions. The run ends when a ball escapes the container.

- Platform: Browser (desktop + mobile), responsive layout.
- Price: Free. No ads. No paid gameplay features.
- Multiplayer: None at launch. Asynchronous friend competitions may come later.
  Real-time multiplayer is explicitly out of scope for the initial release.

## 2. Core Gameplay Loop

1. An upcoming ball is displayed (tier determined by spawn rules, see §4).
2. The player aims (left/right pointer movement, or drag on mobile) and releases to drop.
3. The ball falls under physics, collides with balls and walls.
4. If two balls of the same tier collide, they merge into one ball of the next tier
   at the collision midpoint, awarding score.
5. Merges may cause further same-tier collisions → chain merges.
6. Repeat until a ball falls out of the container → run over.

### End-of-run rule (locked)

- A ball falling out of the container (below the bottom / off the sides past the
  container opening) **ends the run**.
- Crossing the danger line alone does **not** end the run. The danger line is a
  visual/warning element only.

## 3. Ball Tiers (locked: exactly 12)

- Exactly 12 tiers are planned. Tiers 1–8 use the core collection spread.
- **Tiers 1–7**: predictable progression; each has a fixed size, color, and score. Two balls of tier N merge into tier N+1 where the destination is playable.
- **Tier 8**: the cycling RGB ball, a playable merge destination.
- **Tiers 9–12**: collectible tiers with eight unrelated character slots each. A run rolls one implemented character per configured collectible tier and keeps it for the run. Palette variations do not count as separate characters.
- Current implemented characters are Tier 9 shark/pig/Drunk'o Ball (`drunko`) and Tier 10 crab. Tiers 11–12 and unfinished character slots remain locked until their artwork/configuration is implemented.
- Ordinary Tier 9 balls draw the run's theme, including Drunko in normal play; shark, pig and Drunko currently have equal roll weights. Character and palette are fixed for the run, not rerolled per ball.
- Drunko has a tilted stitched cap, grey beard, sleepy half-closed eyes, drool and a green bottle. Shared idle expressions include blink, wink, grin and tongue; fear opens the eyes, lowers the bottle, hides the drool and adds sweat.
- Collection history stores `${tier}:${character}:${palette}` in the existing variants map. The book renders the recorded character and first-discovered palette independently of the current run.
- Older Tier 9 numeric records contain only a palette, not a character identity; they are preserved as unidentified finds rather than arbitrarily assigned a character. Legacy crab records can be recovered because Tier 10 had only crab.

## 4. Spawning Rules

- The upcoming (next) ball is drawn from the lower tiers only (tiers 1–3 as the
  initial default; tunable in config).
- The "Swap" power-up rerolls the upcoming ball.
- Exact spawn distribution is centralized in config for tuning.

## 5. Power-Ups (locked: 3, once per run each)

| Power-up      | Effect |
|---------------|--------|
| Extend Walls  | Temporarily extends the side walls **upward**; container width unchanged. Timed effect with clear visual state and countdown. |
| Shake         | Applies a controlled physical impulse to all balls (tuned magnitude/angle so it is helpful, not chaotic). |
| Swap          | Rerolls the upcoming ball. |

- Each power-up: exactly **one use per run**.
- UI must show availability (available / used).

## 6. Scoring & Progression

- Score: awarded per merge; higher tiers award more (exact curve in `ballTiers` config).
- Chain merges award additional score (multiplier or escalating bonus — tunable, to be
  fixed during implementation and recorded here after tuning).
- Tracked data:
  - Score (per run)
  - Personal best
  - Lifetime statistics (e.g., total merges, total runs, highest tier reached,
    total drops, play time)
  - Run history

## 7. Accounts, Leaderboards, Backend

- **Supabase anonymous authentication** at launch (no email/social login initially).
  - Anonymous UID is the player identity; a lightweight local player profile row is
    created on first run.
- Leaderboards: **daily, weekly, all-time**.
- Run submission must be **secure** (server-validated, see ARCHITECTURE.md §Security).
- Postponed: friend competitions (async), cosmetics. Both noted as future work; nothing
  in the data model should block them.

## 8. Audio

- Sound effects: drop, merge (pitch scales with tier), chain bonus, power-up use,
  game over, UI clicks.
- Optional background music with a toggle.
- Global mute control, persisted locally.

## 9. Platform & Deployment

- Vercel deployment (static build of the Vite app).
- Free to play, no monetization, no ads.
- Desktop: mouse input. Mobile: touch input. Both must work without mode switches.
- `/drunko` is an isolated character-test route: both queue slots, every drop,
  refill and Swap stay Tier 9 Drunk'o Ball, regardless of query overrides.
  Local saves, collection progress, leaderboards, analytics and production
  statistics remain untouched; in-run score and merges still work normally.
  The sandbox skips the Supabase runtime import and auth initialization entirely:
  even the SDK's module-level storage probe must not run. Browser QA requires
  zero attempted localStorage mutations, with no key exemptions, from title boot
  through drops, Swap, merges, game over, restarts and lifecycle flushes.

## 10. Visual Direction (summary — details in ART_DIRECTION.md)

- Colorful 2D cartoon arcade look. Original Ball Rush visual identity (the user's
  reference images — menu screen and gameplay screen — are art direction only, not
  assets to copy).
- Cute expressive balls: large eyes, simple facial expressions, thick black outlines,
  white highlights, playful cartoon shading.
- Exaggerated squash-and-stretch, wobble, splash effects on merge.
- Light gray grid play background; black-and-white striped container with a clear
  bottom and side walls.
- Bold, readable arcade UI.
- Physics must remain physically convincing (Matter.js rigid bodies) even though the
  rendering is cartoon-deformed. This is **not** soft-body simulation.
- Avoid: photorealism, generic 3D spheres, excessive gradients, sterile corporate UI,
  reproducing another game's characters/logos/UI.

## 10A. Screen Specifications (from menu + gameplay reference screenshots)

Two user-provided reference screenshots define the overall composition: a
starting/menu screen and an active gameplay screen. Ball Rush follows this
*direction* with an original design, **and removes all commercial clutter**
(ads, deals/promo timers, shop/purchase buttons, premium currency, offer walls,
monetization panels, decorative clutter). Full layout specs in ART_DIRECTION.md §6A;
acceptance criteria in IMPLEMENTATION_CHECKLIST.md (Phases 7, 11) and TEST_PLAN §5.

### 10A.1 Home screen (required elements)
- Light gray grid background.
- Prominent, colorful ball-merging machine/container illustration featuring cute
  cartoon balls with faces and thick outlines.
- One large Play button — the dominant action.
- Compact player profile / personal-best area.
- Clear leaderboard entry point.
- Settings button (audio, future options).
- Nothing else required. Fastest possible path from load → playing.

### 10A.2 Active gameplay screen (required elements)
- Light gray grid background.
- Large centered container: thick black-and-white diagonal stripes on outer walls
  and bottom; open top for drops. **The container is the visual focus.**
- Bright cartoon balls (thick outlines, highlights, expressive faces).
- Clearly visible upcoming-ball preview.
- Score display + personal-best display.
- Horizontal ball-progression indicator near the bottom.
- Three prominent power-up buttons: Extend Walls, Shake, Swap.
- Danger indicator near the top of the container (warning only — never ends run).
- Small pause/settings control that never obstructs gameplay.
- No sidebars, ads, shop icons, currencies, or unrelated menus during a run.

### 10A.3 Locked behavior re-confirmed
All §2–§5 mechanics are unchanged by this update (merges, chains, 12 tiers,
tiers 1–7 predictable, tiers 8–10 playable with the implemented themes in §3,
tiers 11–12 locked, power-ups ×1/run, ball-out ends run,
danger line does not). Visual deformation stays purely in the render layer;
rigid-body physics is never deformed.

## 11. Non-Goals (launch)

- Real-time multiplayer
- Ads / IAP
- Cosmetics
- Accounts with email/social login
- Native apps

## 12. Open Items

See "Unresolved Decisions" at the end of this planning deliverable. The most critical:

1. **Remaining collectible character slots and tiers 11–12 need artwork/configuration; implemented theme rolls stay fixed per run (§3).**
2. Exact tier size/score tuning values (config, tune during implementation).
3. Chain-merge scoring formula (proposed in ART/ARCH docs, needs sign-off).
4. Leaderboard anti-cheat strictness (server-side validation depth).
5. Logical stage size: **resolved for the scaffold — 720×1280**, calculation-based
   (see docs/STAGE_SIZE.md), centralized in `src/config/stage.ts`; to be confirmed
   on physical devices before Phase 10.
