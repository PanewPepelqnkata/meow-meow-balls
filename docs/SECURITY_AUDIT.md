# Ball Rush Security Audit, Threat Model & Anti-Cheat Architecture Plan

## 1. Executive Summary
Ball Rush currently operates a client-authoritative gameplay loop backed by Supabase Postgres RPCs. While recent migrations (`20261105222811_add_ability_upgrades_and_purchase.sql` and `20261107000000_fix_boss_runs_and_guest_telemetry.sql`) hardened wallet balances (`coins`, `coin_revision`), upgrade purchases (`purchase_ability_upgrade`), and score settlement receipts (`coin_settlements`), critical vulnerabilities remain across client-side runtime globals, unverified score/telemetry RPC inputs, overly permissive RLS policies, and unauthenticated guest telemetry endpoints.

## 2. Client-Side Exploit Surface
- **Exposed Production Globals (`src/game/diag.ts`, `src/game/GameRoot.ts`)**: `installDiag(game)` unconditionally attaches `window.__ballrushGame` and `window.__ballrushDiag`, granting console access to `PlaygroundScene` and `UIScene`.
- **Physics, Drop & Game-Over Tampering (`src/game/scenes/PlaygroundScene.ts`, `src/game/systems/GameOverWatch.ts`, `src/game/systems/InputSystem.ts`)**: Attackers can override `gameOverWatch.observe = () => false`, set `inputController.opts.cooldownMs = 0`, or force high-tier spawns (`currentTier` / `nextTier`).
- **Client-Enforced Ability Cooldowns & Durations (`src/ui/AbilityBar.ts`, `src/game/systems/WallAnimator.ts`, `src/game/systems/ShakeManager.ts`)**: Cooldowns (`cooldownUntil`) and durations (`holdMs`, `durationMs`, `amplitudeScale`) are mutable in memory.

## 3. Backend, RLS & RPC Vulnerabilities
- **Unverified Score & Collectible Payloads (`record_user_score`, `record_guest_score`, `sync_user_progress`)**: The server trusts client-supplied `p_score`, `p_tier_reached`, `p_balls_merged`, `p_duration_ms`, and `p_collectibles`, allowing instant coin minting (`score / 1000`) upon run finalization.
- **Public Profile Email Exposure & Default Grants (`001_initial_schema.sql`, `003_add_email.sql`, `005_boss_dashboard.sql`)**: `profiles` allows public `SELECT` via `using (true)` (exposing `email`), default schema privileges grant table access unless explicitly revoked, and `boss_get_dashboard_data()` lacks `boss_require_admin()`.
- **Guest Telemetry Spoofing & Conversion Abuse (`006_guest_telemetry.sql`, `link_guest_to_user`)**: Anonymous callers can poison arbitrary `guest_id` records or link forged guest runs into a new account.

## 4. Target Anti-Cheat Architecture
1. **Database Hardening**: Revoke default privileges, restrict `profiles.email`, enforce `boss_require_admin()` on all `boss_*` RPCs, and add `game_sessions`, `game_events`, and `economy_ledger` tables.
2. **Server-Authoritative Session Lifecycle**: Issue seeded sessions via `start-game-session`, validate ability activations and upgrades server-side, and verify run event logs and plausibility bounds in `submit-game-session` before settling coins.
3. **Client Hardening**: Gate `installDiag` behind `import.meta.env.DEV`, integrate session tokens and event recording, and enforce strict CSP and HTTP security headers in `vercel.json`.