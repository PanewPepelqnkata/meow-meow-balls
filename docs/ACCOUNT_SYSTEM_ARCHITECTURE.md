# ACCOUNT SYSTEM ARCHITECTURE & SECURITY BOUNDARIES

## 1. Database Schema (`supabase/migrations/20261109000000_kings_wardrobe_and_account_system.sql`)

### 1.1 `public.profiles` Extensions
- `username_normalized text`: Lowercase trimmed username with a partial unique index `profiles_username_normalized_unique_idx` enforcing case-insensitive uniqueness across all accounts.
- `username_changed_at timestamptz`: Server timestamp of the player's single lifetime username change (`NULL` until used).
- `selected_avatar_id text NOT NULL DEFAULT 'tier_1'`: Constrained to the 14 canonical Ball Rush character IDs.
- `favorite_ball_ids text[] NOT NULL DEFAULT '{}'::text[]`: Constrained to at most 3 distinct canonical character IDs.
- `active_title_id text`: Currently equipped Royal Title ID (`NULL` or verified unlocked title).
- `created_at timestamptz NOT NULL DEFAULT now()`: Account creation timestamp.

### 1.2 New Tables
- **`public.username_change_history`**: Immutable audit log of username changes (`user_id`, `old_username`, `new_username`, `changed_at`).
- **`public.player_unlocked_balls`**: Server-authoritative record of unlocked character IDs per user (`PRIMARY KEY (user_id, ball_id)`), automatically seeded with `tier_1`, `tier_2`, and `tier_3`.
- **`public.player_statistics`**: Server-authoritative lifetime statistics (`games_played`, `total_merges`, `highest_tier`, `total_playtime_ms`, `total_coins_earned`, `total_score`, `best_score`).
- **`public.achievement_definitions`** & **`public.player_achievements`**: Server catalog of the 18 achievements + 11 Royal Titles and per-user unlock ledger (`PRIMARY KEY (user_id, achievement_id)`).
- **`public.account_deletion_log`**: Minimal non-PII audit log (`deleted_user_id_hash`, `deleted_at`) written upon account deletion.

### 1.3 Public Leaderboard View (`public.leaderboard_profiles`)
Exposes `id`, `display_name`, `best_score`, `updated_at`, `selected_avatar_id`, `active_title_id`, and `favorite_ball_ids` so leaderboard rows render each player's chosen canonical ball avatar and Royal Title without exposing private columns.

---

## 2. Server-Authoritative RPCs & Triggers

### 2.1 Profile Protection Trigger (`public.enforce_profile_Write_rules`)
Even if a client calls PostgREST `UPDATE public.profiles` directly:
- Modifying `username` / `display_name` when `OLD.username_changed_at IS NOT NULL` raises `USERNAME_CHANGE_LIMIT_REACHED`.
- Modifying `selected_avatar_id` to an locked character raises `AVATAR_NOT_UNLOCKED`.
- Modifying `favorite_ball_ids` with >3 items, duplicates, or locked characters raises `FAVORITE_BALL_NOT_UNLOCKED` / `INVALID_FAVORITE_BALLS`.
- Modifying `active_title_id` to a title whose achievement is not unlocked in `public.player_achievements` raises `TITLE_NOT_UNLOCKED`.

### 2.2 `public.change_username_once(p_new_username text)`
- Locks the caller's `public.profiles` row (`FOR UPDATE`).
- Enforces `username_changed_at IS NULL` (lifetime limit of 1 change).
- Validates format (`^[A-Za-z0-9_]{3,15}$`), reserved words, profanity filter, and case-insensitive uniqueness (`lower(btrim(p_new_username))`).
- Atomically updates `username`, `display_name`, `username_normalized`, sets `username_changed_at = now()`, and inserts into `public.username_change_history`.

### 2.3 `public.set_selected_avatar(p_ball_id text)` & `public.set_favorite_balls(p_ball_ids text[])`
- Validates canonical character IDs and verifies ownership in `public.player_unlocked_balls` before updating `public.profiles`.

### 2.4 `public.set_active_title(p_title_id text)`
- Verifies that `p_title_id` is unlocked via `public.player_achievements` joined with `public.achievement_definitions` before equipping.

### 2.5 `public.record_verified_run_wardrobe_stats(...)` & `public.evaluate_player_achievements(p_user_id uuid)`
- Updates lifetime counters (`games_played`, `total_merges`, `highest_tier`, `total_playtime_ms`, `total_coins_earned`, `total_score`, `best_score`), unlocks newly reached ball tiers in `public.player_unlocked_balls`, and evaluates all 18 achievement thresholds server-side.

### 2.6 `public.delete_my_account(p_confirmation text)`
- Requires `p_confirmation === 'DELETE'` and an authenticated user (`auth.uid()`).
- Records a SHA-256 hash of the user ID in `public.account_deletion_log`.
- Deletes the user's `public.profiles` and `auth.users` rows (`ON DELETE CASCADE` removes all dependent game sessions, unlocks, achievements, stats, and history).
