# BALL RUSH — Game Specification

Version: 0.2 (updated for menu + gameplay reference screenshots — awaiting user review)
Status: PLANNING ONLY. No code has been implemented.

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

- Exactly 12 tiers are planned (Phase 2.16.2: total raised from 10; tiers 10–12
  are reserved placeholders — their designs are not yet made).
- **Tiers 1–7**: predictable progression (each tier = a fixed size, color, and score
  value; merging two of tier N produces tier N+1). Exact size/score curve to be
  tuned in implementation, governed by `ballTiers` config (see ARCHITECTURE.md).
- **Tiers 8–9**: playable merge destinations (rainbow / fantasy identities,
  per-run variants).
- **Tiers 10–12 — DEFERRED / UNRESOLVED**: not yet made; the merge chain ends at
  tier 9 until the user specifies their design and the randomization behavior.

> ⚠️ **UNRESOLVED REQUIREMENT — DO NOT IMPLEMENT**
> Tier 8–10 randomization behavior has not been specified by the user.
> No mechanic for tiers 8–10 may be invented or implemented until the user explains
> the intended behavior. The spec, architecture, and checklist preserve this as an
> explicit open item. Placeholder: tiers 8–10 exist in the tier table with reserved
> size/color/score entries only.

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
tiers 1–7 predictable, tiers 8–9 playable, tiers 10–12 unspecified, power-ups ×1/run, ball-out ends run,
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

1. **Tier 8–10 randomization mechanic — user must explain before any implementation.**
2. Exact tier size/score tuning values (config, tune during implementation).
3. Chain-merge scoring formula (proposed in ART/ARCH docs, needs sign-off).
4. Leaderboard anti-cheat strictness (server-side validation depth).
5. Logical stage size: **resolved for the scaffold — 720×1280**, calculation-based
   (see docs/STAGE_SIZE.md), centralized in `src/config/stage.ts`; to be confirmed
   on physical devices before Phase 10.
