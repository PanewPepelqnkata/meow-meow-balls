# Ball Rush — Security & Anti-Cheat Test Plan

## 1. Overview

This test plan covers attacker-style simulation tests across both the TypeScript client/service layer (Vitest) and the PostgreSQL database/RLS/RPC layer (`supabase/tests/*.sql`).

---

## 2. Attack Scenarios & Expected Outcomes

| Category | Attack Scenario | Target Layer | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **Score Manipulation** | Submit positive score (`50,000`) with `0` merges | DB (`validate_run_metrics`) | Rejected with `Positive score requires at least one merge` (`22023`) |
| **Score Manipulation** | Submit impossible score-to-merge ratio (`500,000` score on `5` merges) | DB (`validate_run_metrics`) | Rejected with `Score exceeds maximum plausible merge ratio` (`22023`) |
| **Score Manipulation** | Replay finalized `run_id` with higher score (`9999`) after settlement | DB (`record_user_score`) | Ignored; existing settled score row and coin balance remain unchanged |
| **Score Manipulation** | Direct REST `INSERT` / `UPDATE` on `public.scores` | DB Grants & RLS | Rejected with `insufficient_privilege` (`42501`) |
| **Coin Manipulation** | Modify `localStorage` (`ballrush.save.v1`) `coins: 999999` before sync | Client (`AuthService`) + DB (`sync_user_progress`) | Overwritten by authoritative server `coins` and `coin_revision`; 0 coins minted |
| **Coin Manipulation** | Spoof `auth.users.raw_user_meta_data.ballrush_progress.coins = 999999` | DB (`boss_sync_user_progress_internal`) | Ignored; `user_progress.coins` remains authoritative |
| **Coin Manipulation** | Direct REST `UPDATE public.user_progress SET coins = 999999` | DB Grants & RLS | Rejected with `insufficient_privilege` (`42501`) |
| **Upgrade Tampering** | Mutate `localStorage` upgrades to `{ wallDuration: 10, shakeDuration: 10, shakeIntensity: 5 }` | Client (`AuthService`) + DB (`sync_user_progress`) | Server ignores client upgrades payload and restores authoritative levels |
| **Upgrade Tampering** | Replay `purchase_ability_upgrade` with stale `p_coin_revision` or `p_expected_level` | DB (`purchase_ability_upgrade`) | Rejected with concurrency exception; balance debited only once |
| **Upgrade Tampering** | Purchase upgrade when `coins < cost` or `level >= maxLevel` | Client + DB (`purchase_ability_upgrade`) | Rejected; balance and upgrade levels unchanged |
| **Ability Manipulation** | Pass `Infinity` or `999999999` duration or level `999` to `WallAnimator.activate` / `ShakeManager.activate` | Client (`WallAnimator`, `ShakeManager`) | Clamped to hard maximums (`25,000 ms` wall hold, `10,000 ms` shake duration, `1.5x` impulse) |
| **Ability Manipulation** | Emit `ui:swap`, `ui:raise`, or `ui:shake` repeatedly on `gameBus` in a single run | Client (`PlaygroundScene`) + DB (`activate_session_ability`) | Latched per run (`swapUsed`, `raiseUsed`, `shakeUsed`); backend rejects second call with `Ability already used in this session` |
| **Ability Manipulation** | Trigger abilities as an anonymous guest | Client (`PlaygroundScene`) + DB (`activate_session_ability`) | Blocked by `guestAbilityBlocked()` on client and rejected with `42501` on backend |
| **Session Tampering** | Submit another player's `session_id` or expired session | DB (`submit_game_session`) | Rejected with `42501` / `Game session has expired` |
| **Admin Escalation** | Non-admin authenticated user calls `boss_get_dashboard_data`, `boss_delete_user`, or `boss_update_score` | DB (`boss_require_admin`) | Rejected with `Admin access required` (`42501`) |
| **Privacy / PII Leak** | Anonymous or authenticated user runs `SELECT email FROM public.profiles` | DB Column Grants | Rejected with `permission denied for table profiles` (`42501`); username login continues working via `resolve_username_email` |

---

## 3. Automated Test Locations

1. **Client & Service Attacker Tests (Vitest):**
   - `src/services/anti-cheat.test.ts` — Attacker-style tests covering localStorage coin/upgrade tampering, ability duration/cooldown tampering (`Infinity`, `NaN`, level `999`), replay/duplicate purchase prevention, session ability latching, and username email resolution fallback.
   - `src/services/auth-session.test.ts` — Wallet hydration, concurrent purchase serialization, stale revision rejection, and auth race conditions.
   - `src/services/auth-runs.test.ts` — Run receipt idempotency, sandbox route isolation, and guest-to-user run linking.
2. **Database Security & Anti-Cheat SQL Tests:**
   - `supabase/tests/security_anti_cheat.sql` — End-to-end PostgreSQL role-switching test suite verifying table/column privilege revocations, `profiles.email` protection, `boss_*` admin guards, `game_sessions` lifecycle, `activate_session_ability` one-use enforcement, `validate_run_metrics` bounds, and `economy_ledger` audit entries.
   - `supabase/tests/ability_upgrades.sql` — Atomic upgrade pricing, caps, revision checks, and settlement idempotency.
   - `supabase/tests/collectible_run_metadata.sql` — Run metadata integrity and RPC permission checks.

---

## 4. How to Run Verification

```bash
# Run all unit and attacker-style security tests
npm test

# Run TypeScript typechecking and ESLint boundary checks
npm run typecheck
npm run lint

# Build production bundle and verify no source maps or debug globals leak
npm run build
```
