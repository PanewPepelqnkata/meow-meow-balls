# BALL RUSH — Architecture

Version: 0.2 (updated for menu + gameplay reference screenshots — awaiting user review)

---

## 1. High-Level Shape

Two runtime worlds with a strict boundary:

```
┌─────────────────────────────────────────────────┐
│  React app (UI shell, menus, HUD overlays)      │
│  - React 18 + TypeScript + Vite                 │
│  - Owns: screens, HUD, power-up bar, settings   │
└───────────────┬─────────────────────────────────┘
                │ typed event bus / store bridge
┌───────────────▼─────────────────────────────────┐
│  Phaser game (single Phaser.Game instance)      │
│  ┌───────────────┐  ┌────────────────────────┐  │
│  │ Scenes        │  │ Systems (services)     │  │
│  │ BootScene     │  │ PhysicsSystem(Matter)  │  │
│  │ MenuScene     │  │ BallManager            │  │
│  │ GameScene     │  │ MergeSystem            │  │
│  │ GameOverScene │  │ ScoreSystem            │  │
│  └───────────────┘  │ PowerUpSystem          │  │
│                     │ SpawnSystem            │  │
│  ┌───────────────┐  │ GameOverDetector       │  │
│  │ Rendering     │  │ InputSystem            │  │
│  │ BallRenderer  │  │ ResponsiveScaler       │  │
│  │ ScoreFeedback │  │ AudioManager           │  │
│  │ ContainerView │  └────────────────────────┘  │
│  └───────────────┘                               │
└─────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────┐
│  Services layer (framework-agnostic TS modules) │
│  - supabaseClient, authService                  │
│  - profileService, runService (submission)      │
│  - leaderboardService                           │
│  - statsStore (lifetime stats, run history)     │
└─────────────────────────────────────────────────┘
```

**Rule:** React never touches Phaser/Matter objects directly, and Phaser never
imports React. All communication flows through a typed event bus + a small
state bridge (see §6).

## 2. Repository Structure (proposed)

```
ball_rush/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json            # strict mode
├── vercel.json              # (only if non-default config needed)
├── public/
│   └── favicon.svg
├── src/
│   ├── main.tsx             # React entry
│   ├── App.tsx
│   ├── react/               # React UI
│   │   ├── screens/         # Menu, Settings, Stats, Leaderboard, GameOver
│   │   ├── hud/             # Score, NextBall, PowerUpBar, DangerIndicator
│   │   ├── hooks/           # useGameBridge, useLeaderboard, ...
│   │   └── components/      # shared UI primitives
│   ├── game/                # Phaser world
│   │   ├── GameRoot.ts      # Phaser.Game factory + boot config
│   │   ├── scenes/
│   │   ├── systems/
│   │   │   ├── PhysicsSystem.ts
│   │   │   ├── BallManager.ts
│   │   │   ├── MergeSystem.ts
│   │   │   ├── ScoreSystem.ts
│   │   │   ├── PowerUpSystem.ts
│   │   │   ├── SpawnSystem.ts
│   │   │   ├── GameOverDetector.ts
│   │   │   ├── InputSystem.ts
│   │   │   └── AudioManager.ts
│   │   ├── entities/
│   │   │   └── Ball.ts
│   │   ├── rendering/
│   │   │   ├── BallRenderer.ts
│   │   │   ├── ContainerView.ts
│   │   └── events/
│   │       └── gameBus.ts        # typed event emitter
│   ├── config/
│   │   ├── physics.ts       # centralized Matter settings
│   │   ├── ballTiers.ts     # 12 tiers; tiers 10–12 RESERVED (see note)
│   │   ├── powerUps.ts
│   │   └── spawn.ts
│   ├── services/            # Supabase + persistence
│   │   ├── supabaseClient.ts
│   │   ├── authService.ts
│   │   ├── profileService.ts
│   │   ├── runService.ts
│   │   ├── leaderboardService.ts
│   │   └── localStore.ts    # mute, personal best fallback, run history
│   ├── types/               # shared TS types
│   └── utils/
├── assets/                  # generated / drawn art (see ART_DIRECTION.md §9)
│   ├── balls/
│   ├── ui/
│   └── audio/
├── supabase/
│   └── migrations/          # SQL migrations (added in backend phase)
└── docs/
    ├── GAME_SPEC.md
    ├── ARCHITECTURE.md
    ├── ART_DIRECTION.md
    ├── IMPLEMENTATION_CHECKLIST.md
    └── TEST_PLAN.md
```

Note: planning docs will be created at the repo root for this task and can be
moved under `docs/` when the project scaffolds.

## 3. Module Boundaries & Responsibilities

### 3.1 React application (`src/react`)
- Screens: menu (home), settings (audio, future options), stats/history,
  leaderboards, game over.
- **Home screen** (spec: ART_DIRECTION §6A.1): React owns logo, Play button,
  PB/profile chip, leaderboard entry, settings button. The hero "merging machine"
  illustration is rendered by `MenuScene` in the canvas behind/inside the React
  layout, reusing the gameplay ball-rendering pipeline (one art source).
- **Gameplay HUD** (spec: ART_DIRECTION §6A.2): score + personal best, NEXT
  preview frame, ball-progression indicator, three power-up buttons, pause
  control, danger warning strip. All React DOM; container/balls/effects stay in
  canvas. HUD reserves top and bottom layout bands so it never overlaps the
  container (see §3.11).
- HUD overlays rendered as React components positioned above the canvas.
- Reads game state via the bridge; sends intents (drop, use power-up, restart)
  via the bus. Never imports Phaser or Matter.

### 3.2 Phaser game lifecycle (`src/game/GameRoot.ts`)
- Creates a single `Phaser.Game` mounted into a container div.
- Scene registry: `BootScene` (load assets, config validation) → `MenuScene`
  (home-screen hero illustration only; menu chrome is React) →
  `GameScene` → `GameOverScene`.
- Owns the game loop; systems are instantiated per `GameScene` and receive
  dependencies via constructor injection (easy to test/mocked).

### 3.3 Physics (`systems/PhysicsWorld.ts`)
- Implemented in Phase 1 as a **framework-free `PhysicsWorld`** (owns the Matter
  engine, fixed 60 Hz accumulator with bounded catch-up, container static bodies,
  reset/dispose) wrapped by thin scene glue. Tests exercise `PhysicsWorld`
  headlessly. Standalone `Matter.Engine` stepped by Phaser's frame delta — the
  single authoritative update path; Phaser's Matter factory is not used.
- All tunables (gravity, restitution, friction, slop, iteration counts, wall
  thickness, container geometry in `config/container.ts`) live in `src/config/`.
  No magic numbers in systems.

### 3.4 Ball entities (`entities/Ball.ts`, `systems/BallManager.ts`)
- `Ball` = pure model: id, tier, position/velocity refs, state (idle, merging, dead),
  visual state (squash, wobble phase).
- `BallManager` owns creation/removal, maps Matter bodies ↔ Ball models, and
  emits collision events (batched per physics step).
- Collision body = plain Matter circle per tier radius. Rendering is independent
  (see 3.8) — the body is always a rigid circle.

### 3.5 Merge detection & chains (`systems/MergeSystem.ts`)
- Listens to collision-start events from `BallManager`.
- Guard rules: both balls same tier, both alive, neither already flagged for
  merge this step, cooldown to prevent double-merge races.
- On merge: schedule next-tier ball at midpoint with inherited momentum (average),
  award score via `ScoreSystem`, emit `merge` event for FX/audio, **then re-scan
  for chains** within the same step (BFS over new collisions) until stable.
  Chains bounded per step to avoid infinite loops.

### 3.6 Score tracking (`systems/ScoreSystem.ts`)
- Merge base score from `ballTiers[tier].score`; chain depth applies the chain
  bonus formula (TBD, see Unresolved Decisions).
- Publishes score updates to the bridge; on game over finalizes the run and
  hands the result to `services/runService`.

### 3.7 Power-ups (`systems/PowerUpSystem.ts`)
- Strategy pattern: each power-up implements `apply(scene)`.
  - Extend Walls: reposition/extend wall bodies upward for T seconds (T in config),
    with a visual "grown wall" state; timer restores original geometry.
  - Shake: applies tuned impulses to all ball bodies (magnitude/angle ranges in config).
  - Swap: asks `SpawnSystem` to reroll; purely logical, no physics.
- Enforces one-use-per-run per power-up; state exposed to HUD.

### 3.8 Character rendering & deformation (`rendering/BallRenderer.ts`)
- Custom rendering decoupled from physics bodies: each visual ball reads its
  body's transform, then applies cartoon deformation (squash-and-stretch from
  velocity/impacts, wobble from a damped spring per ball, face state machine:
  idle / blink / happy / startled).
- Implementation candidates: Phaser Graphics-redrawn textures per tier (runtime
  generated) OR pre-drawn vector art baked to textures. Decision at implementation
  start (see ART_DIRECTION.md §9).
- **Explicitly a visual layer on rigid bodies — not a soft-body simulation.**

### 3.9 Effects (`rendering/ScoreFeedback.ts`)
- Merge splash (colored ring + confetti per tier palette), ring pop,
  score popup floaters. Popup count capped so mega-chains can't stack
  dozens of tweens.

### 3.10 Game-over detection (`systems/GameOverDetector.ts`)
- A sensor zone below/behind the container opening. Any ball body entering it →
  run over. Danger line crossing alone does NOT trigger (locked requirement);
  the line only drives HUD warning state.

### 3.11 Input & responsive scaling (`systems/InputSystem.ts`, `ResponsiveScaler`)
- Pointer/touch aiming: horizontal aim clamped to container interior; release/tap
  to drop; drop cooldown.
- Fixed logical stage: **720×1280** (decided in Phase 0, rationale in
  docs/STAGE_SIZE.md, values in `src/config/stage.ts`) with `Phaser.Scale.FIT`,
  uniform scaling, container never cropped or stretched. The React HUD reserves
  top/bottom layout bands matched to the stage geometry; on desktop, wide margins
  let the HUD sit beside the container.
- Mobile: `touch-action: none` on the game area, safe-area insets respected,
  overscroll contained. Desktop: mouse aim/drop, same rules as touch.
- HUD is DOM/React and reflows independently of canvas scale.

### 3.12 Audio (`systems/AudioManager.ts`)
- Web Audio via Phaser sound. SFX palette per event; music loop optional;
  mute persisted in `localStore`.

### 3.13 Services layer (`src/services`)
- `authService`: Supabase anonymous sign-in on first launch; session persistence.
- `profileService`: create/fetch player profile row.
- `runService`: submits finished runs (see Security below).
- `leaderboardService`: fetch daily/weekly/all-time boards (views/RPCs in Supabase).
- `localStore`: mute prefs, offline personal best, run history cache.
- Services are plain TS modules injected where needed — no React/Phaser imports.

## 4. Configuration (`src/config`)

- `physics.ts`: gravity, restitution, friction, air, engine iterations, wall specs.
- `ballTiers.ts`: array of 10 entries — radius, colors, face style, score,
  physics overrides (e.g., mass scale). **Tiers 8–10 entries exist but are marked
  reserved pending the user's randomization mechanic.**
- `powerUps.ts`: durations, impulse ranges, cooldowns.
- `spawn.ts`: upcoming-ball tier distribution.

All game-balance changes happen here, never inside systems.

## 5. Data Model (Supabase — planned, not yet created)

```
profiles        (id uuid pk = auth.users.id, created_at, display_name?, cosmetic_* future)
runs            (id, player_id fk, score, max_tier, merges, duration_ms, ended_at,
                 client_version)
leaderboards    = views/RPCs over runs:
                  daily   (runs in current UTC day, best per player)
                  weekly  (ISO week)
                  alltime (best per player)
```

RLS on everything; leaderboard reads via security-definer SQL functions.

## 6. React ↔ Phaser Bridge

- `gameBus`: typed EventEmitter (discriminated event union) shared by both worlds.
  - React → game: `intent:drop`, `intent:powerup`, `intent:restart`,
    `intent:pause`, `intent:quitToMenu`, `prefs:mute`.
  - Game → React: `state:score`, `state:best`, `state:nextBall`,
    `state:powerups`, `state:danger`, `state:progression` (tiers reached),
    `run:over`, `fx:...`.
- A tiny `GameBridge` store (observable) mirrors the HUD-relevant subset of game
  state so React can render with `useSyncExternalStore`.
- Next-ball preview art: Phaser texture pipeline renders each tier to a cached
  image (data-URL) that React displays inside the NEXT frame — one art source,
  no Phaser object access from React.

## 7. Security (run submission)

- Client submits: score, max tier, merges, duration, version.
- Server-side validation (Postgres function invoked by client with the user's JWT):
  - plausibility checks (score ≤ theoretical max per merge count/time),
  - rate limiting (e.g., one run per X seconds),
  - run rows inserted server-side only; clients have no direct INSERT on `runs`.
- Accepted residual risk: determined clients can spoof values within plausibility
  bounds. Full server-authoritative simulation is out of scope at launch
  (noted in Unresolved Decisions).

## 8. Error Handling & Resilience

- Auth/network failures degrade gracefully: game is fully playable offline;
  submission retries/queues; leaderboards show cached or "unavailable" state.
- Config validation in `BootScene` fails fast with a readable error.

## 9. Performance Notes

- Target 60 fps desktop, stable 60 (or locked 60→30 fallback) on mid-tier mobile.
- Cap active particles; pool balls/effects; remove off-screen bodies.
- Physics step fixed at 60 Hz with accumulator; render interpolation optional
  (decide during implementation, keep deterministic for tests).


# BALL RUSH — Art Direction

Version: 0.2 (updated for menu + gameplay reference screenshots — awaiting user review)

---

## 1. Visual Identity Statement

Ball Rush is a bright, bouncy cartoon arcade game. Balls are living characters —
soft, expressive, and eager — inside a bold striped machine. The look is hand-drawn
2D with thick outlines and flat playful shading. Original identity: the user's
reference image sets the *direction* (cute balls, thick outlines, striped container,
grid backdrop); Ball Rush's characters, palette, container design, logo, and UI are
its own.

**Never do:** photorealism, generic 3D spheres, heavy gradients, sterile corporate UI,
or any resemblance to another game's specific characters/logo/art.

## 2. Palette

### 2.1 Ball tiers (10) — bright, instantly distinguishable hues

| Tier | Name (working)  | Base color            | Accent/shade        | Notes |
|------|-----------------|-----------------------|---------------------|-------|
| 1    | Pip             | Sunny Yellow `#FFD93B`| `#E8A200`           | Smallest, wide innocent eyes |
| 2    | Berry           | Coral Red `#FF6B57`   | `#D43D2A`           | Cheerful grin |
| 3    | Sprout          | Leaf Green `#5BC236`  | `#3E8E1F`           | |
| 4    | Splash          | Sky Blue `#3FB4F6`    | `#1F7FBF`           | |
| 5    | Grape           | Violet `#9B5DE5`      | `#6F3BB0`           | |
| 6    | Peachy          | Bubblegum Pink `#FF7EB6` | `#D14E8C`        | |
| 7    | Ember           | Tangerine `#FF8C2E`   | `#D65F0A`           | Largest predictable tier |
| 8    | *(reserved)*    | TBD                   | TBD                 | Awaiting tier 8–10 mechanic from user |
| 9    | *(reserved)*    | TBD                   | TBD                 | |
| 10   | *(reserved)*    | TBD                   | TBD                 | |

Rules:
- Adjacent tiers must not be confusable at a glance (hue distance check).
- One tier = one hue family; never two tiers sharing a hue with different shades only.
- Tiers 8–10 colors are **reserved placeholders** until the user explains the
  tier 8–10 randomization mechanic. Do not finalize or implement.

### 2.2 Environment

| Element            | Color |
|--------------------|-------|
| Page/background    | Off-white `#F4F4F2` with light gray grid lines `#E0E0DE` |
| Container stripes  | Pure black `#1A1A1A` / white `#FFFFFF` diagonal barber stripes |
| Container glass    | Clear panels, subtle white sheen, 15–20% tint only |
| Danger line        | Warm red `#E5484D`, dashed, pulses when balls approach |
| UI primary         | Ink black `#1A1A1A` on cream `#FFF8E7`, accent yellow `#FFD93B` |
| Score popups       | White with black outline, tier-colored accents |

Accessibility: verify tier hue distinctiveness under common color-vision
deficiencies during implementation (contrast/deuteranopia spot check).

## 3. Character Design — the Balls

### 3.1 Construction (vector-style, per tier)
- Perfect circle silhouette (matches the physics body exactly).
- **Thick black outline**: ~4–6 px at base tier, scaling with radius (constant
  visual weight relative to size; never thinner than 3 px on screen).
- Body: flat base color fill + one simple darker crescent shade at bottom-right +
  one white specular highlight blob at top-left (two shapes, no gradients).
- Face: two large oval eyes (white sclera optional — prefer solid dark pupils for
  small tiers, white+pupil for larger tiers), tiny mouth.

### 3.2 Expressions (state machine per ball)
| State     | Trigger                          | Face |
|-----------|----------------------------------|------|
| Idle      | default                          | Neutral-cute; slow blink every 3–6 s |
| Anticipate| a same-tier ball nearby          | Eyes widen slightly |
| Happy     | merge imminent / just merged     | ^ ^ eyes or big smile, brief |
| Startled  | hard impact                      | O mouth, eyes wide, 300 ms |
| Worried   | stack near danger line           | Eyes look up, squiggle mouth |
| Dizzy     | after Shake power-up             | Swirl eyes, 1 s |

Faces are drawn as separate eye/mouth layers so expressions swap without redrawing
the body. Blink = scaleY 0 on eyes for 100 ms.

### 3.3 Personality per tier (subtle, not new characters)
- Same face construction across tiers; vary eye size ratio, pupil size, and
  default mouth so big balls read as "sleepy heavyweights" and small ones as
  "hyper gremlins."

## 4. Container & Environment

- **Container**: a bold arcade machine vibe — black-and-white diagonal striped
  outer frame on side walls; play area enclosed by *clear* panels (bottom and side
  walls visible as glass with a white sheen line and subtle corner screws/rivets).
  Top is open (that's where balls escape — glass rim visually emphasizes the rim).
- **Backdrop**: light gray fine grid (like graph paper), very low contrast; may
  scroll subtly or stay static — static for v1.
- **Danger line**: dashed warm-red line near the top of the container interior,
  with a small skull-free warning glyph (exclamation triangle) at its ends.
  Pulses only when a ball is above it.
- **Drop zone indicator**: subtle vertical guide line / ghost ball showing where
  the upcoming ball will fall.
- **Extend Walls power-up visual**: the striped walls visibly slide upward with a
  ratchet sound and a "clunk" at full extension; they retract with a countdown
  shimmer before they lower.

## 5. Animation Principles

- **Squash & stretch (exaggerated but convincing)**: on landing/impact, balls
  squash along the impact normal up to ~20–25% deformation, recovering with 2–3
  overshoot bounces (damped spring, ~400 ms settle). Stretch while falling fast
  (≤10% elongation). Deformation is *visual only* — the physics body stays a
  rigid circle (explicit: not soft-body simulation).
- **Wobble**: idle stacked balls breathe subtly (1–2% scale oscillation, staggered
  phases) so stacks feel alive.
- **Merge animation (the signature moment)**:
  1. Both balls lock eyes and lean toward each other (50 ms).
  2. Squash together with an inward splash of tier-colored droplets.
  3. New ball pops out at 130% scale, overshoots down to 100% with a jelly wobble.
  4. Ring shockwave + 6–10 droplet particles + score popup floats up.
  5. Chain merges stack a rising pitch and slightly larger ring per chain depth.
- **Dropping**: brief wind-up stretch of the upcoming ball, slight anticipation
  pause (60–80 ms) on release for game feel.
- **Game over**: ball that falls out gets a startled face, camera shake, slow-mo
  200 ms, then container "lights out" dim while UI slides in.
- Easing: springs and back-overs everywhere; almost no linear tweens.
- Mobile budgets: ≤ 60 particles on screen, effect durations clipped to essentials.

## 6. UI Direction

- **Style**: bold arcade cartoon — chunky rounded rectangles, 3–4 px black
  outlines, hard drop shadows (no blur), cream/yellow fills, ink-black text.
- **Typography**: one display font for numbers/logo (rounded, ultra-bold, e.g.,
  a free arcade face like Baloo/Fredoka-family or custom-drawn) + one clean
  support font for body text. Both must be open-licensed.
- **Buttons**: pill or rounded-square, press animation (squash down 5%, shadow
  collapses). Power-up buttons show character-styled icons + a "USED" strike state.
- **Game over screen**: big score count-up, "NEW BEST!" burst if applicable,
  stats row, retry + menu buttons.
- Everything readable at arm's length on a phone; minimum touch target 44 px.
- **Non-monetized by design**: the interface contains no shop, currency, ads,
  deals, timers, or promo surfaces anywhere. Cleanliness is a requirement, not a
  polish item.

## 6A. Screen Layouts (from menu + gameplay reference screenshots)

The two reference screenshots set the composition. Ball Rush adopts the overall
layout with its own original art and strips every commercial element. Both screens
share the grid backdrop, outlined cartoon style, and arcade button language of §6.

### 6A.1 Home screen

Composition, top to bottom (original arrangement — not a copy):

```
┌──────────────────────────────────────┐
│            BALL RUSH (logo)          │
│                          [⚙ settings]│
│                                      │
│      ┌────────────────────────┐      │
│      │   MERCHING MACHINE     │  ← hero illustration: container
│      │   ILLUSTRATION         │    with striped frame, cute balls
│      │   (balls with faces)   │    stacked inside, expressive faces
│      └────────────────────────┘      │
│                                      │
│   ┌──────────────────────────────┐   │
│   │      ▶  P L A Y  ▶           │   │  ← dominant action, largest element
│   └──────────────────────────────┘   │
│                                      │
│  [Best: 12,480]   [🏆 Leaderboards]  │  ← compact row: PB + leaderboard entry
└──────────────────────────────────────┘
```

- **Keep from reference**: grid background; hero machine/container illustration
  with cute faced balls; big Play button; compact profile/PB area; leaderboard
  entry; settings button.
- **Removed from reference**: ads, deals/promo timers, shop & purchase buttons,
  premium currencies, offer walls, monetization panels, decorative clutter.
- Hero illustration is static in v1 (idle blink/wobble animation acceptable as
  polish); it reuses the same ball-rendering pipeline as gameplay — one source
  of truth for ball art.
- Play is reachable in one tap from load. No interstitials, ever.

### 6A.2 Active gameplay screen

The gameplay screenshot is the **primary reference** for the run screen.

```
┌──────────────────────────────────────┐
│ [⏸]      SCORE 12,480          [mute]│   ← slim top bar
│           BEST 18,220                │
│   (danger indicator)      [NEXT ●]   │   ← danger line pulses near container
│  ┌──┐──────────────────────────┐┌──┐ │      top; upcoming-ball preview
│  │▒▒│                          │▒▒│ │      top-right, always visible
│  │▒▒│      open top            │▒▒│ │
│  │▒▒│  ╎ ╎ ╎ danger line ╎ ╎ ╎ │▒▒│ │
│  │▒▒│                          │▒▒│ │   ← container: thick black/white
│  │▒▒│      play area           │▒▒│ │      diagonal stripes on outer
│  │▒▒│     balls merging        │▒▒│ │      walls + bottom, clear glass
│  │▒▒│                          │▒▒│ │      interior, open top
│  └──┘▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒└──┘ │
│   ●──●──●──●──●──●──●──○──●──●       │   ← ball-progression indicator
│                                      │      (horizontal, near bottom)
│  [🧱 Extend]  [💫 Shake]  [🔄 Swap]   │   ← 3 power-up buttons, prominent,
│         within thumb reach           │      USED state struck through
└──────────────────────────────────────┘
```

Element rules:
- **Container = visual focus.** It occupies the majority of vertical space; HUD
  elements are compact and never cover the play area interior.
- Upcoming-ball preview: bordered window with the next ball (full art, idle
  animation) + "NEXT" label.
- Score & personal best: top of screen, display font, one glance readable.
- Ball-progression indicator: all 10 tier balls in a row, smallest→largest;
  tiers reached this run are full-color, unreached tiers are dimmed silhouettes.
  Tiers 8–10 slots exist visually but stay dimmed/locked pending the user's
  mechanic (do not invent their look or behavior).
- Power-up buttons: three equal buttons, icon + short label, one-use-per-run;
  pressed/used states per §6; positioned for thumbs on mobile without covering
  the container.
- Danger indicator: the in-container dashed line (§4) plus an optional slim
  warning strip above the rim that pulses when a ball is above the line. Warning
  only — it never ends the run.
- Pause/settings: small corner button opening a React overlay (resume, restart,
  mute, quit to menu). Never obstructs the container while playing.
- **Explicitly absent during a run**: sidebars, ads, shop icons, currencies,
  unrelated menus.

### 6A.3 HUD ↔ canvas relationship

- The container, balls, effects, drop guide, and in-container danger line are
  **drawn in the Phaser canvas** (they must track physics exactly).
- All chrome — top bar, score/PB, NEXT preview frame, progression indicator,
  power-up buttons, pause, menus — is **React DOM** overlaying the canvas.
- The NEXT preview's ball art is generated by the same Phaser texture pipeline
  and handed to React as an image/data-URL per tier (cached) — one art source,
  two renderers. No Phaser objects are manipulated from React.
- The React HUD reserves layout space (top bar + bottom rows); the canvas
  scales into the remaining space so HUD never overlaps the container.

## 7. Responsive Guidance

### 7.1 Logical stage: decided — 720×1280 (Phase 0)

**Decision made in Phase 0: 720×1280** — full candidate comparison, viewport
calculations, and caveats in `docs/STAGE_SIZE.md`; values live in
`src/config/stage.ts`. Summary: identical ball scale to 720×1400 on modern
portrait phones, ~2× the vertical letterbox for the HUD (151–168 px vs 86–96 px),
~9.4% larger rendering on height-limited desktops, near-exact fill on 320×568.
Stage-internal container margins are config values, so switching to 720×1400
after on-device testing is a one-file change.

> ⚠️ Still calculation-based, not device-verified. Confirm on physical devices
> (TEST_PLAN R1–R5) before Phase 10.

- **Mobile portrait (e.g., 390×844 CSS px, iPhone 14-ish)**: stage ratio 0.5625
  is *wider* than the viewport ratio (≈0.462), so `SCALE.FIT` picks the width
  ratio: scale ≈ 390/720 ≈ 0.54 → the stage renders 390×693, leaving ~151 px of
  vertical letterbox. That spare band is exactly where the React HUD (top bar +
  bottom power-up row) lives.
  - **Implication**: the container occupies the middle ~65–70% of stage height
    (margins in `src/config/stage.ts`), keeping it clear of HUD bands on every
    viewport.
- **Mobile landscape / short screens**: portrait stage letterboxes heavily.
  Acceptable at launch (game is portrait-first); show a "rotate device" hint
  rather than re-laying-out the game.
- **Desktop (16:9, e.g., 1440×900)**: stage centers at height-fit
  (900/1280 ≈ 0.70 → 506 px wide) with large empty margins. The grid backdrop
  fills the full window behind the stage; extra horizontal space hosts the HUD
  (React) — score/PB can move beside the container, power-ups flank it — without
  stretching the container. The container itself never scales beyond a max
  on-screen size cap to avoid feeling inflated.
- Rule for all cases: **never crop the container, never stretch it unnaturally,
  never scale it past its cap**; scale is uniform; HUD reflows in DOM.

### 7.2 Mobile requirements
- Container large enough to play comfortably within the fit-scaled stage.
- Score and upcoming-ball preview readable at arm's length.
- Power-up buttons in the bottom thumb zone, clear of the container interior;
  respect safe-area insets (notch / home indicator).
- No accidental page scroll/zoom during play: `touch-action: none` on the game
  area, viewport meta with `user-scalable=no`, overscroll containment.

### 7.3 Desktop requirements
- Container centered in the available play area; extra width used by the HUD
  (not by stretching the container).
- Mouse aiming + click/hold-release dropping, same clamping rules as touch.
- Identical visual identity and gameplay rules to mobile — one design, two
  input modes, no separate "desktop skin."

## 8. Audio Direction (art-adjacent)

- SFX palette: soft "boing"/"plop" cartoon foley; merge = pop + rising pentatonic
  chime scaled by tier; chain adds sparkle layering. UI clicks = short woodblock.
- Music: light, bouncy, loopable ~90–110 BPM chiptune-lite or ukulele/kalimba
  feel. Off by default? No — music optional but ON at low volume; mute toggle
  always visible.

## 9. Asset Strategy (incremental, zero paid assets)

Phase A (prototype): **runtime vector-drawn** balls via Phaser Graphics — code-
generated textures per tier (body, shade, highlight, eyes, mouth as separate
layers). Zero external files; fast iteration on tier colors/faces; already
"original artwork by construction."
Phase B (polish): replace with custom-drawn vector art (illustrator/Figma/Inkscape
or code-authored SVG) baked to PNG @2x, if a richer look is needed. Faces stay
layered.
Phase C (juice): particle textures, container art, UI skin, fonts (open-licensed),
audio (free CC0 libraries such as Kenney/freesound CC0, or self-synthesized).
This keeps art debt low: gameplay ships on Phase A art, upgrades slot in without
code changes because rendering is isolated in `BallRenderer`/`ScoreFeedback`.


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


# Ball Rush — Logical Stage Size Decision (Phase 0)

Status: **Decided for scaffold: 720×1280.** Centralized in `src/config/stage.ts`;
changing it requires no geometry rewrites in systems (all consumers read config).
This is a calculation-based decision, **not a substitute for testing on physical
devices** — revisit after first on-device runs (tracked as an open item).

## Candidates

- A: 720×1280 (ratio 0.5625)
- B: 720×1400 (ratio 0.5143)

Scaling is uniform `Phaser.Scale.FIT`: `scale = min(viewW/stageW, viewH/stageH)`.
Letterbox bands are the vertical/horizontal leftover where the React HUD lives.

## Calculations (uniform FIT, CSS px)

### Stage A: 720×1280

| Viewport        | Limiting | Scale  | Rendered   | Letterbox (total)  | HUD bands (v)   |
|-----------------|----------|--------|------------|--------------------|-----------------|
| 320×568 phone   | height   | 0.4437 | 320×568    | 1 h × 0 v          | 0 px            |
| 390×844 phone   | width    | 0.5417 | 390×693    | 0 h × 151 v        | ~75 px top/bot  |
| 430×932 phone   | width    | 0.5972 | 430×764    | 0 h × 168 v        | ~84 px top/bot  |
| 1440×900 desktop| height   | 0.7031 | 506×900    | 934 h × 0 v        | side margins    |

### Stage B: 720×1400

| Viewport        | Limiting | Scale  | Rendered   | Letterbox (total)  | HUD bands (v)   |
|-----------------|----------|--------|------------|--------------------|-----------------|
| 320×568 phone   | height   | 0.4057 | 292×568    | 28 h × 0 v         | 0 px            |
| 390×844 phone   | width    | 0.5417 | 390×758    | 0 h × 86 v         | ~43 px top/bot  |
| 430×932 phone   | width    | 0.5972 | 430×836    | 0 h × 96 v         | ~48 px top/bot  |
| 1440×900 desktop| height   | 0.6429 | 463×900    | 977 h × 0 v        | side margins    |

## Analysis

- **Modern portrait phones (390×844, 430×932)**: width-limited for both stages —
  identical ball scale. A leaves 151–168 px vertical letterbox; B leaves only
  86–96 px. The letterbox bands are where the score/PB top bar and power-up row
  sit (ART_DIRECTION §6A.3). A gives roughly **2× the HUD room**.
- **Desktop 1440×900**: height-limited for both. A renders ~9.4% larger
  (scale 0.7031 vs 0.6429) — everything (container, balls, HUD in DOM) reads
  bigger. B's extra stage height buys nothing here.
- **Small phone 320×568**: A's ratio (0.5625) matches the viewport almost
  exactly — fills it fully. B renders 28 px narrower (smaller balls on the
  smallest supported screen).
- **Cost of A**: less built-in vertical room for the container *inside* the
  stage. Mitigation: the container is positioned/sized within the stage with
  explicit margins (top band ~120 u for drop zone + danger area, bottom band
  ~170 u for progression indicator space). These margins live in
  `src/config/stage.ts` alongside the stage size and are tunable without
  touching systems. If on-device testing shows the container feels cramped, the
  fallback is B — a one-config change.

## Decision

**720×1280** for the scaffold, with stage-internal layout margins in config.

> ⚠️ These viewport calculations are model-based, not device-verified. Validate
> on real hardware (TEST_PLAN §5, R1–R5) before locking in Phase 10.


# BALL RUSH — Test Plan

Version: 0.2 (updated for menu + gameplay reference screenshots — awaiting user review)

Testing stack is intentionally light: Vitest for logic (pure systems, config,
merge math), headless Matter world simulations for physics regression, and
manual device checklists for feel/responsive/audio. No e2e framework until the
UI shell exists (Phase 7) — then Playwright smoke tests.

---

## 1. Physics (automated where possible)

Headless Matter engine driven by the game's fixed step; assertions over body
states after N simulated seconds.

| ID | Test | Pass criteria |
|----|------|---------------|
| P1 | Stability soak: 30 balls dropped, simulate 60 s | All bodies asleep/stable; no velocity spikes > threshold; no bodies escaped container |
| P2 | Tunneling: max-tier ball dropped from max height onto thin stack | No pass-through of walls/floor |
| P3 | Rest jitter: stacked identical balls | Positional drift < 1 px/s after settling |
| P4 | Determinism: same seed + input script → identical final state twice | Bitwise-close positions (tolerance defined in test) |
| P5 | Shake impulse bounds: apply Shake config at extremes | No ball exceeds escape trajectory that a legit game-over wouldn't allow unless intended; balls stay inside with walls extended |
| P6 | Extend Walls: wall bodies restored after timer | Wall geometry equals pre-extension values (exact) |
| P7 | Engine step rate: fixed 60 Hz accumulator under frame spikes | No missed-step drift; no double-step merges |

## 2. Merge Logic (automated, pure logic + engine events)

| ID | Test | Pass criteria |
|----|------|---------------|
| M1 | Two same-tier balls collide → exactly one next-tier ball | Old bodies removed; new body at midpoint; no residue |
| M2 | Three-way simultaneous collision | Exactly one merge resolves per pair; no double-merge; final count consistent |
| M3 | Chain: engineered cascade setup | Chain depth tracked; scoring applies chain bonus per depth; loop terminates |
| M4 | Different tiers collide | No merge; normal bounce |
| M5 | Merge cooldown race: two collision events same step for same ball | Single merge only |
| M6 | Momentum inheritance | New ball velocity ≈ average of parents (tolerance in test) |
| M7 | Score accounting: scripted run of known merges | Final score == sum from `ballTiers` config (no magic numbers) |
| M8 | Tier 7 merge guard | With tiers 8–10 unspecified, a tier-7 pair must **not** silently invent tier-8 behavior — test asserts current defined behavior (no merge OR documented placeholder) until user specifies the mechanic |

## 3. Game-Over Rules (locked requirements — explicit regression tests)

| ID | Test | Pass criteria |
|----|------|---------------|
| G1 | Ball body enters out-of-container sensor | Run ends exactly once; `run:over` emitted once |
| G2 | Danger line crossing only | Run does **NOT** end; warning state shows |
| G3 | Ball above danger line then rescued (settles below) | Warning clears; run continues |
| G4 | Ball escapes over a side rim | Run ends (container opening counts as out) |

## 4. Input

| ID | Test | Pass criteria |
|----|------|---------------|
| I1 | Pointer aim clamped to container interior at all widths | Ghost indicator never outside walls |
| I2 | Drop cooldown | No double-drop within cooldown window |
| I3 | Touch drag vs tap on mobile (manual) | Aim + release works; no scroll/zoom hijacking; `touch-action` correct |
| I4 | Input during game-over/restart transitions ignored | No ghost drops |
| I5 | Power-up buttons during disabled states (used, cooldown, non-playing scene) | No-ops |

## 5. Responsive Behavior

| ID | Test | Pass criteria |
|----|------|---------------|
| R1 | Canvas scale: 320 px phone → 4K desktop | Container always fully visible; no crop; letterbox correct |
| R2 | Orientation change mid-run (manual) | Layout recovers; physics continues; HUD reflows |
| R3 | Safe-area insets on notched device (manual) | HUD clear of notch/home indicator |
| R4 | HUD overlap: smallest supported height | Power-up bar never covers container interior controls |
| R5 | DevicePixelRatio rendering (manual) | No blur on outlines at 2x/3x screens |
| R6 | Home screen layout (manual, both platforms) | Matches ART_DIRECTION §6A.1: Play, PB chip, leaderboard entry, settings, hero illustration — **no** ads/shop/promo/currency elements anywhere |
| R7 | Gameplay HUD layout (manual, both platforms) | Matches ART_DIRECTION §6A.2: score+PB, NEXT preview, progression indicator, 3 power-ups, danger strip, pause — container unobstructed; **no** commercial elements |
| R8 | Scroll/zoom hijack prevention (manual, mobile) | Dragging on the game area never scrolls or pinch-zooms the page; overscroll contained |
| R9 | Desktop wide viewport (manual, e.g., 1440×900+) | Container centered at capped size, HUD uses side/edge space, container never stretched past its max scale |
| R10 | Landscape / short screens (manual) | Portrait-first letterboxing with rotate hint; no broken or cropped layout |

## 6. Performance Budgets (manual + profiler)

| ID | Test | Pass criteria |
|----|------|---------------|
| F1 | Mid-tier mobile, 40 balls + active effects | ≥ 60 fps sustained; no > 100 ms frame |
| F2 | Particle cap | Never exceeds configured cap; no leak after 10 min soak |
| F3 | Memory soak: 15 min continuous play (manual) | No visible growth in heap/body count after garbage-collectible run end |
| F4 | Ball pool reuse | Body/model counts return to baseline after each run |

## 7. Backend & Security (Phase 8+)

| ID | Test | Pass criteria |
|----|------|---------------|
| S1 | Direct INSERT to `runs` as anon user | Blocked by RLS |
| S2 | Submit via validated function: implausible score | Rejected |
| S3 | Submit twice within rate window | Second rejected |
| S4 | Leaderboard windows | Daily = current UTC day; weekly = ISO week; all-time = best per player; anonymous players isolated |
| S5 | Session restore on reload | Same anonymous identity; profile row reused |
| S6 | Offline/failed network run end | Game finishes; submission queued/retried; no crash |

## 8. Visual/Audio Regression (manual checklist)

- [ ] All 7 live tiers distinguishable at glance (including small sizes).
- [ ] Squash-and-stretch present on impact; never deforms physics behavior.
- [ ] Merge signature moment (lean → squash → pop → ring → popup) plays, incl. chains.
- [ ] Container stripes/glass/danger line per ART_DIRECTION §4.
- [ ] Faces: blink, happy, startled, worried states reachable in normal play.
- [ ] Mute toggle persists; music toggle works; SFX pitch scales with tier.
- [ ] UI readable at phone distance; touch targets ≥ 44 px.
- [ ] **Home screen**: one tap from load to playing; hero illustration reuses ball
      art pipeline; zero commercial/decorative clutter (R6).
- [ ] **Gameplay screen**: container is the visual focus; HUD compact; progression
      indicator shows tiers 1–7 reachable and 8–10 as dimmed locked slots only (R7).

## 9. Regression Discipline

- Every bug fix ships with a test capturing the failure (automated where feasible;
  manual checklist entry otherwise).
- Locked rules with dedicated tests: **danger line ≠ game over** (G2), **ball out
  of container = game over** (G1), **3 power-ups × 1 use/run**, **exactly 12 tiers**,
  **tiers 10–12 untouched until user specifies** (M8).
