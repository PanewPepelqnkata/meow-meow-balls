-- User progress table: stores per-account game progress
-- Ties progression (best score, tier unlocks, variants, career stats, personal runs, settings)
-- directly to the user's account so it persists across sessions and devices.

create table if not exists public.user_progress (
  user_id uuid references public.profiles(id) on delete cascade primary key,
  best_score integer not null default 0,
  discovered jsonb not null default '{}'::jsonb,
  variants jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{"runs": 0, "merges": 0, "bestTier": 0}'::jsonb,
  leaderboard jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{"theme": "auto"}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.user_progress add column if not exists leaderboard jsonb not null default '[]'::jsonb;
alter table public.user_progress add column if not exists settings jsonb not null default '{"theme": "auto"}'::jsonb;

-- Enable RLS
alter table public.user_progress enable row level security;

-- Users can only read their own progress
drop policy if exists "Users can view own progress" on public.user_progress;
create policy "Users can view own progress"
  on public.user_progress for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Users can insert their own progress
drop policy if exists "Users can insert own progress" on public.user_progress;
create policy "Users can insert own progress"
  on public.user_progress for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- Users can update their own progress
drop policy if exists "Users can update own progress" on public.user_progress;
create policy "Users can update own progress"
  on public.user_progress for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
