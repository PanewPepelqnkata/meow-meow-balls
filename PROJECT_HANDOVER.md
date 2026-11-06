# PROJECT_HANDOVER.md — Ball Rush

> Compact, code-verified project reference. Updated from repository state and clarified intent.
> Source of truth for ongoing work: runtime code + this file. When they conflict, pause and clarify before changing behavior.

## 1. Game Summary

Ball Rush is a browser-based Suika-style soft-body merge game. Players drop balls into an open-top container; same-tier balls merge into the next tier, awarding score and coins. The run ends when a ball escapes the container. The game targets desktop and mobile browsers with a shared portrait-first layout.

- Repo: `https://github.com/PanewPepelqnkata/meow-meow-balls`
- Branch: `main`
- Verified HEAD: `868a157`
- Logical stage: `720×1280` design pixels
- Render DPR cap: `2×`

## 2. Technology Stack

| Layer | Technology | Version |
| --- | --- | --- |
| Runtime | Node.js | v26.0.0 |
| Package manager | npm | 11.12.1 |
| Language | TypeScript | ^6.0.3 (strict, noEmit, verbatimModuleSyntax) |
| Game engine | Phaser | ^4.2.1 (custom slimmed vendor build) |
| Physics | matter-js | ^0.20.0 (standalone) |
| UI framework | React | ^19.3.0 |
| Build tool | Vite | ^8.3.4 |
| Test runner | Vitest | ^5.0.3 |
| Linter | ESLint | ^10.12.0 (flat config) |
| Formatter | Prettier | ^3.9.10 |
| Backend | Supabase | @supabase/supabase-js ^2.118.0 |
| Icons | lucide-static | ^1.61.0 |
| E2E/QA | Playwright | ^1.64.0 |

Custom Phaser build: `vendor/phaser-slim/` excludes Matter.js, Tilemaps, Sound, Curves, and other unused modules. Vite aliases `phaser` → `vendor/phaser-slim/index.js`. `treeshake: false` is required because Phaser uses CJS side-effects.

## 3. Commands

```bash
npm install
npm run dev          # local dev server
npm run dev:lan      # LAN-accessible dev server
npm run build        # tsc --noEmit && vite build
npx tsc --noEmit     # TypeScript type check
npm run lint         # ESLint
npx vitest run       # unit tests
npm run format       # prettier --write .
```

QA regression guards (Playwright-based, require running dev server):

```bash
npm run qa:tier8
npm run qa:containment
npm run qa:merge
npm run qa:tier8cycle
npm run qa:wallraise
npm run qa:fear
npm run qa:gameoverpanic
npm run qa:fearplay
npm run qa:themebake
npm run qa:savewrite
npm run qa:proddiag
npm run qa:discsize
npm run qa:card
npm run qa:reveal
npm run qa:wallperf
```

Dev-only query parameters:

| Param | Effect |
| --- | --- |
| `?test=<tier>` | Deal that tier ball |
| `?theme=pig\|shark\|drunko\|robo` | Force collectible theme |
| `?discovery=wind` | Force wind discovery banner |
| `?softbody=1` | Enable SoftBallScene dev testbed |
| `?arrangement=1` | Dev-only spawn arrangement (P key) |

## 4. Environment

File: `.env`

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |

Supabase client is disabled on the `/drunko` sandbox route (`src/lib/supabase.ts`).

## 5. Architecture

```text
React Shell (main.tsx → App.tsx)
  ├── GameCanvas (Phaser host, src/react/GameCanvas.tsx)
  │   ├── BackgroundScene (unzoomed camera, BackgroundTheme)
  │   ├── PlaygroundScene (world camera, 720×1280 stage)
  │   │   ├── PhysicsWorld (Matter.js 120Hz fixed-step)
  │   │   ├── SoftBallManager → SoftBall (particle ring + pressure solver)
  │   │   ├── MergeSystem → mergePlacement
  │   │   ├── InputSystem → inputMath
  │   │   ├── ScoreSystem
  │   │   ├── GameOverWatch
  │   │   ├── WallAnimator / ShakeManager (abilities)
  │   │   ├── BallEmotion (visual panic)
  │   │   └── Rendering: SoftBallRenderer, ContainerView, ScoreFeedback…
  │   ├── UIScene (1:1 viewport camera, renders ON TOP)
  │   │   ├── UiRoot → ResponsiveLayout
  │   │   ├── GameOverView / DiscoveryOverlay / DiscoveryBanner
  │   │   └── AuthModal
  │   ├── TitleScene (menu, collection, store, leaderboard)
  │   ├── StartIntroScene (vending machine intro)
  │   └── PauseScene (overlay)
  └── BossDashboard (React admin, /boss route)
```

Communication: `gameBus` (typed events, no framework deps)

- `PlaygroundScene` publishes to `UIScene` / `TitleScene`
- `UIScene` publishes to `PlaygroundScene` (`ui:swap`, `ui:raise`, `ui:restart`)

Persistence:

- `localStorage` (`save.ts`: `SaveDataV1`) ↔ cloud sync (`auth.ts` `AuthService`)
- Supabase (`lib/supabase.ts`) → auth, scores, leaderboard, boss analytics

### Key Directories

| Directory | Purpose |
| --- | --- |
| `src/game/scenes/` | Phaser scenes |
| `src/game/systems/` | Headless game logic |
| `src/game/rendering/` | Pure draw modules |
| `src/game/state/` | Persistence and run identity |
| `src/game/events/` | `gameBus.ts` |
| `src/config/` | Single-source-of-truth tables |
| `src/services/` | Supabase integration |
| `src/ui/` | Phaser UI components |
| `src/boss/` | React admin dashboard |
| `src/lib/` | Supabase client factory |
| `src/react/` | Phaser React wrapper |
| `src/utils/` | Viewport/layout fitting |
| `qa/` | Playwright regression guards + throwaway scripts |
| `supabase/migrations/` | SQL migrations |
| `vendor/phaser-slim/` | Custom slimmed Phaser build |

## 6. Gameplay Design

### Core Mechanics

- Soft-body physics: Matter-native particle ring + rim constraints + spokes + gas-pressure area preservation. No hidden rigid body.
- Merge: same-tier balls merge into next tier. Chain window `400ms`, cooldown `120ms`, pending emergency `900ms`.
- Drop: player drops balls from top; aim clamped to container width; cooldown between drops.
- Game over: ball dwells outside container walls past grace period.
- Scoring: tier base points × chain depth doubling (capped `8×`).
- Coins: guest wallets earn locally at `score / 1000`; guest score rows do not settle directly. Signup may copy them into account `scores` only if the account has no existing score rows; copied rows earn account coins only when they meet finalized-score eligibility. The local guest wallet balance is never transferred. Account wallets settle eligible rows once via durable receipts.

### Abilities

- All ability activation (including Swap) and store purchases require a registered account; guest abilities remain disabled. Once-per-run charges are unchanged.
- Raise Walls: gameplay duration is `15s + 1s per wall-duration upgrade level` (`900ms` animation).
- Shake/Earthquake: `5s + 0.5s per duration level`; impulse strength increases by 10% per intensity level. Debris, dust, ball impulses; no physical lid.

### Visual Identity

- Hand-drawn cartoon aesthetic with ink outlines (`INK = 0x1a1a1a`).
- Blue/red palette: navy backdrop, red machine, blue accents.
- Lucide icons via `lucide-static` + `LucideIcon.ts`.
- Uiverse-style DOM buttons for menu (`UiverseDomButtons.ts`).
- Default visual baseline: existing shipped game look. Change only when explicitly specified.

## 7. Tier System

### Implemented Tiers

- Tiers 1–8: standard balls, always available. Tier 8 has RGB color cycling.
- Tier 9: collectible tier with implemented themes `shark`, `pig`, `drunko`, `robo`.
- Tier 10: `crab` theme configured and tier marked `playable: true`; nearby comments in `ballTiers.ts` still label tiers 10–12 reserved, contradicting that flag.
- Tiers 11–12: currently `playable: false` and without implemented themes.

### Collectible Model (Intended)

- Tiers 9–12 are the collectible tiers.
- Each collectible tier rolls one theme per run.
- The rolled theme is fixed for the entire run.
- Merges stay tier-consistent within the run’s theme.
- Per-run visual identity is seed-deterministic via `runVariant.ts`.

### Current Implementation Gap

- Theme configuration exists only for tier 9 and tier 10 in `collectibleThemes.ts`.
- Run variants are generated only for tiers 9 and 10 in `runVariant.ts`.
- Collection UI reserves slots for tiers 9–12, but tiers 11–12 have no playable path or configured themes yet.

## 8. Progression and Economy

### Intended Direction

- Primary progression focus: collection and rewards loop.
- Economy model: free earnable upgrades funded by coins earned through play; the account-only upgrade shop is implemented.
- No ads or IAP unless explicitly approved later.

- Account wallets hydrate from `user_progress` and receive server settlement credits only for eligible finalized score rows; client payloads contain no coin delta or protected wallet fields.
- Store: three account-only upgrades are purchasable with server-priced, revision-checked RPCs. Wall duration: 10 levels, 10 coins + 10 per owned level; shake duration: 10 levels, same price progression; shake intensity: 5 levels, 20 coins + 20 per owned level. The store is a hand-drawn merchant stall with illustrated ability objects, segmented stage bars, current/next/max effect previews, guest account gating, and portrait paging for short viewports.
- Upgrade levels are authoritative in `user_progress.upgrades` and snapshotted at ability activation. All abilities, including Swap, and purchases require a registered account; once-per-run charges remain unchanged.

## 9. Supabase Backend

### Tables

| Table | Purpose |
| --- | --- |
| `profiles` | Registered-account profile data |
| `scores` | Registered run scores with stable run IDs |
| `user_progress` | Authoritative account wallet, upgrades, and progress |
| `coin_settlements` | Immutable final-score receipts; run-ID tombstones prevent replay after score deletion |
| `guest_profiles` | Anonymous player profiles |
| `guest_scores` | Anonymous run scores with stable run IDs |
| `boss_admins` | Admin authorization allowlist |

### Security-Critical RPCs

- `sync_user_progress(p_save jsonb, p_coin_revision bigint) → jsonb`
  - Rejects client attempts to send protected wallet fields; revision is not a client authority.
  - Settles eligible finalized scores through durable receipts; no client-selected coin amount.
  - Returns authoritative `{ coins, coin_revision, upgrades, settled_coins }`.
  - Wallet/upgrades hydrate only from `user_progress`; editable auth metadata is a non-authoritative cache.
- `purchase_ability_upgrade(p_upgrade text, p_expected_level integer, p_coin_revision bigint) → jsonb`
  - Registered accounts only; locks the wallet row and checks exact level/revision, server price, affordability, and cap atomically.
- `boss_update_user_coins(target_user_id uuid, operation text, amount numeric) → numeric`
  - Requires `boss_require_admin()`; supports bounded increase/decrease/set and increments wallet revision.
- `boss_require_admin() → void`
  - Checks `auth.uid()` exists in `boss_admins`; raises `42501` otherwise.
- `boss_get_dashboard_data() → jsonb`
  - Requires `boss_require_admin()`; returns user progress, scores, guest data, and collectible metadata.
- `record_user_score` / `record_guest_score` require stable run IDs; finalized registered rows settle once with allowlisted final reasons and immutable receipts.

### Known Backend Risks

- The server normalizes submitted scores but does not prove gameplay simulation; a modified client can fabricate scores. Settlement is replay-safe, not anti-cheat proof.
- Deployment prerequisite: apply `20261105222811_add_ability_upgrades_and_purchase.sql` before deploying the matching client; it replaces the old three-argument `sync_user_progress` contract. Hosted deployment has not been performed.
- SQL integration suites `supabase/tests/ability_upgrades.sql` and `supabase/tests/collectible_run_metadata.sql` are present but unexecuted; run `npx supabase test db` against the local Supabase stack (Docker required).
- Legacy registered score rows without run IDs may settle using score-ID-only receipts; newly submitted registered runs require stable run IDs and use user/run tombstones.

## 10. Roadmap

### Current Priority

- Collection and rewards loop.

### Near-Term Work

- Extend collectible themes: add further tier 10 themes and implement tier 11–12 themes, playable merge paths, visuals, and discovery flow.

### Deferred / Backlog

- CI/CD pipeline.
- `.env.example`.
- Remove diagnostic-only `check_interruption_reason.sql` from migrations.

## 11. Known Issues

- Top-left corner iris glitch during intro animation is not fully resolved.
- Tier 10 has a configured crab theme and is marked playable, but `ballTiers.ts` still contains reserved-placeholder comments for tiers 10–12.
- Tiers 11–12 are presented as collectible tiers in UI and metadata validation but are not yet playable or themed.

## 12. Working Conventions

- Preserve current architecture boundaries: React shell, Phaser scenes, `gameBus`, headless systems, config authority, Supabase services.
- Default visual style: existing game look. Do not change art direction without explicit task guidance.
- Collectible model: one theme per tier per run.
- Verification default: focused runtime verification plus relevant automated tests.
- Ask before implementing when a change would alter player-visible behavior, economy rules, or stated design intent.
- Do not rebuild existing functionality.
- Do not change working systems without a clear reason.
- Make focused, testable changes and verify them.
