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
