-- Boss Admin & Analytics Dashboard schema, backfill, and RPC functions
-- All RPCs require an authenticated user ((select auth.uid()) is not null)
-- and revoke execution from public/anon.

-- 1. Ensure user_progress exists with all columns and RLS
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

alter table public.user_progress enable row level security;

drop policy if exists "Authenticated users can view all progress" on public.user_progress;
create policy "Authenticated users can view all progress"
  on public.user_progress for select
  to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Users can insert own progress" on public.user_progress;
create policy "Users can insert own progress"
  on public.user_progress for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own progress" on public.user_progress;
create policy "Users can update own progress"
  on public.user_progress for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 2. Internal helper to recalculate and synchronize a user's progress from scores + existing state
create or replace function public.boss_sync_user_progress_internal(
  target_user_id uuid,
  strict_from_scores boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_max_score integer := 0;
  v_max_tier integer := 0;
  v_run_count integer := 0;
  v_total_merges integer := 0;
  v_leaderboard jsonb := '[]'::jsonb;
  v_existing public.user_progress%rowtype;
  v_has_existing boolean := false;
  v_meta_progress jsonb := null;
  v_discovered jsonb := '{}'::jsonb;
  v_variants jsonb := '{}'::jsonb;
  v_settings jsonb := '{"theme": "auto"}'::jsonb;
  v_stats jsonb;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_t integer;
begin
  select
    coalesce(max(s.score), 0),
    coalesce(max(s.tier_reached), 0),
    count(*)::integer,
    coalesce(sum(s.balls_merged), 0)::integer
  into v_max_score, v_max_tier, v_run_count, v_total_merges
  from public.scores s
  where s.user_id = target_user_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'score', sub.score,
        'bestTier', sub.tier_reached,
        'at', (extract(epoch from sub.created_at) * 1000)::bigint
      )
      order by sub.score desc, sub.created_at desc
    ),
    '[]'::jsonb
  )
  into v_leaderboard
  from (
    select s.score, s.tier_reached, s.created_at
    from public.scores s
    where s.user_id = target_user_id
    order by s.score desc, s.created_at desc
    limit 10
  ) sub;

  select * into v_existing
  from public.user_progress up
  where up.user_id = target_user_id;
  v_has_existing := found;

  select u.raw_user_meta_data->'ballrush_progress'
  into v_meta_progress
  from auth.users u
  where u.id = target_user_id;

  if v_has_existing then
    v_discovered := coalesce(v_existing.discovered, '{}'::jsonb);
    v_variants := coalesce(v_existing.variants, '{}'::jsonb);
    v_settings := coalesce(v_existing.settings, '{"theme": "auto"}'::jsonb);
    if not strict_from_scores then
      v_max_score := greatest(v_max_score, coalesce(v_existing.best_score, 0));
      v_run_count := greatest(v_run_count, coalesce((v_existing.stats->>'runs')::integer, 0));
      v_total_merges := greatest(v_total_merges, coalesce((v_existing.stats->>'merges')::integer, 0));
      v_max_tier := greatest(v_max_tier, coalesce((v_existing.stats->>'bestTier')::integer, 0));
    end if;
  elsif v_meta_progress is not null and jsonb_typeof(v_meta_progress) = 'object' then
    v_discovered := coalesce(v_meta_progress->'discovered', '{}'::jsonb);
    v_variants := coalesce(v_meta_progress->'variants', '{}'::jsonb);
    v_settings := coalesce(v_meta_progress->'settings', '{"theme": "auto"}'::jsonb);
    if not strict_from_scores then
      v_max_score := greatest(v_max_score, coalesce((v_meta_progress->>'best')::integer, 0));
      v_run_count := greatest(v_run_count, coalesce((v_meta_progress->'stats'->>'runs')::integer, 0));
      v_total_merges := greatest(v_total_merges, coalesce((v_meta_progress->'stats'->>'merges')::integer, 0));
      v_max_tier := greatest(v_max_tier, coalesce((v_meta_progress->'stats'->>'bestTier')::integer, 0));
    end if;
  end if;

  if strict_from_scores then
    v_discovered := jsonb_build_object('1', v_now_ms, '2', v_now_ms, '3', v_now_ms);
  else
    v_discovered := jsonb_build_object('1', v_now_ms, '2', v_now_ms, '3', v_now_ms) || v_discovered;
  end if;

  for v_t in 1..least(12, greatest(3, v_max_tier)) loop
    if not (v_discovered ? v_t::text) then
      v_discovered := v_discovered || jsonb_build_object(v_t::text, v_now_ms);
    end if;
    if v_t >= 9 and not exists (
      select 1
      from jsonb_object_keys(v_variants) k
      where k like (v_t::text || ':%')
    ) then
      v_variants := v_variants || jsonb_build_object(v_t::text || ':0', v_now_ms);
    end if;
  end loop;

  v_stats := jsonb_build_object(
    'runs', v_run_count,
    'merges', v_total_merges,
    'bestTier', v_max_tier
  );

  insert into public.user_progress (
    user_id,
    best_score,
    discovered,
    variants,
    stats,
    leaderboard,
    settings,
    updated_at
  )
  values (
    target_user_id,
    v_max_score,
    v_discovered,
    v_variants,
    v_stats,
    v_leaderboard,
    v_settings,
    now()
  )
  on conflict (user_id) do update set
    best_score = excluded.best_score,
    discovered = excluded.discovered,
    variants = excluded.variants,
    stats = excluded.stats,
    leaderboard = excluded.leaderboard,
    settings = excluded.settings,
    updated_at = excluded.updated_at;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'ballrush_progress',
    jsonb_build_object(
      'version', 1,
      'best', v_max_score,
      'discovered', v_discovered,
      'variants', v_variants,
      'stats', v_stats,
      'leaderboard', v_leaderboard,
      'settings', v_settings,
      'updatedAt', v_now_ms
    )
  )
  where id = target_user_id;
end;
$$;

revoke all on function public.boss_sync_user_progress_internal(uuid, boolean) from public, anon, authenticated;

-- Backfill user_progress for all existing profiles
do $$
declare
  r record;
begin
  for r in select id from public.profiles loop
    perform public.boss_sync_user_progress_internal(r.id, false);
  end loop;
end;
$$;

-- 3. Dashboard overview RPC (returns profiles, scores, and user_progress for authenticated boss user)
create or replace function public.boss_get_dashboard_data()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_profiles jsonb;
  v_scores jsonb;
  v_progress jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'display_name', p.display_name,
        'email', coalesce(p.email, u.email),
        'avatar_url', p.avatar_url,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'last_sign_in_at', u.last_sign_in_at
      )
      order by p.created_at desc
    ),
    '[]'::jsonb
  )
  into v_profiles
  from public.profiles p
  left join auth.users u on u.id = p.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'user_id', s.user_id,
        'score', s.score,
        'tier_reached', s.tier_reached,
        'balls_merged', s.balls_merged,
        'duration_ms', s.duration_ms,
        'created_at', s.created_at
      )
      order by s.created_at desc
    ),
    '[]'::jsonb
  )
  into v_scores
  from public.scores s;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', up.user_id,
        'best_score', up.best_score,
        'discovered', up.discovered,
        'variants', up.variants,
        'stats', up.stats,
        'leaderboard', up.leaderboard,
        'settings', up.settings,
        'updated_at', up.updated_at
      )
    ),
    '[]'::jsonb
  )
  into v_progress
  from public.user_progress up;

  return jsonb_build_object(
    'profiles', v_profiles,
    'scores', v_scores,
    'progress', v_progress,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.boss_get_dashboard_data() from public, anon;
grant execute on function public.boss_get_dashboard_data() to authenticated;

-- 4. Update an existing score run and synchronize user progress
create or replace function public.boss_update_score(
  target_score_id bigint,
  new_score integer,
  new_tier integer,
  new_merges integer,
  new_duration_ms integer
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  update public.scores
  set
    score = greatest(0, new_score),
    tier_reached = greatest(1, least(12, new_tier)),
    balls_merged = greatest(0, new_merges),
    duration_ms = greatest(0, new_duration_ms)
  where id = target_score_id
  returning user_id into v_user_id;

  if v_user_id is null then
    raise exception 'Score record not found';
  end if;

  perform public.boss_sync_user_progress_internal(v_user_id, true);
end;
$$;

revoke all on function public.boss_update_score(bigint, integer, integer, integer, integer) from public, anon;
grant execute on function public.boss_update_score(bigint, integer, integer, integer, integer) to authenticated;

-- 5. Create a new score run for a player and synchronize user progress
create or replace function public.boss_create_score(
  target_user_id uuid,
  new_score integer,
  new_tier integer,
  new_merges integer,
  new_duration_ms integer
)
returns bigint
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_new_id bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  insert into public.scores (user_id, score, tier_reached, balls_merged, duration_ms)
  values (
    target_user_id,
    greatest(0, new_score),
    greatest(1, least(12, new_tier)),
    greatest(0, new_merges),
    greatest(0, new_duration_ms)
  )
  returning id into v_new_id;

  perform public.boss_sync_user_progress_internal(target_user_id, false);
  return v_new_id;
end;
$$;

revoke all on function public.boss_create_score(uuid, integer, integer, integer, integer) from public, anon;
grant execute on function public.boss_create_score(uuid, integer, integer, integer, integer) to authenticated;

-- 6. Delete a score run and synchronize user progress
create or replace function public.boss_delete_score(target_score_id bigint)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  delete from public.scores
  where id = target_score_id
  returning user_id into v_user_id;

  if v_user_id is null then
    raise exception 'Score record not found';
  end if;

  perform public.boss_sync_user_progress_internal(v_user_id, true);
end;
$$;

revoke all on function public.boss_delete_score(bigint) from public, anon;
grant execute on function public.boss_delete_score(bigint) to authenticated;

-- 7. Update user profile and/or override career progression stats
create or replace function public.boss_update_user(
  target_user_id uuid,
  new_username text,
  new_display_name text,
  new_best_score integer,
  new_runs integer,
  new_merges integer,
  new_best_tier integer
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_discovered jsonb := jsonb_build_object('1', v_now_ms, '2', v_now_ms, '3', v_now_ms);
  v_variants jsonb := '{}'::jsonb;
  v_leaderboard jsonb := '[]'::jsonb;
  v_settings jsonb := '{"theme": "auto"}'::jsonb;
  v_stats jsonb;
  v_clamped_tier integer := greatest(0, least(12, coalesce(new_best_tier, 0)));
  v_t integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  update public.profiles
  set
    username = coalesce(nullif(btrim(new_username), ''), username),
    display_name = coalesce(nullif(btrim(new_display_name), ''), display_name),
    updated_at = now()
  where id = target_user_id;

  select
    coalesce(up.discovered, v_discovered),
    coalesce(up.variants, '{}'::jsonb),
    coalesce(up.leaderboard, '[]'::jsonb),
    coalesce(up.settings, '{"theme": "auto"}'::jsonb)
  into v_discovered, v_variants, v_leaderboard, v_settings
  from public.user_progress up
  where up.user_id = target_user_id;

  v_discovered := jsonb_build_object('1', v_now_ms, '2', v_now_ms, '3', v_now_ms);
  for v_t in 1..greatest(3, v_clamped_tier) loop
    v_discovered := v_discovered || jsonb_build_object(v_t::text, v_now_ms);
  end loop;

  v_stats := jsonb_build_object(
    'runs', greatest(0, coalesce(new_runs, 0)),
    'merges', greatest(0, coalesce(new_merges, 0)),
    'bestTier', v_clamped_tier
  );

  insert into public.user_progress (
    user_id,
    best_score,
    discovered,
    variants,
    stats,
    leaderboard,
    settings,
    updated_at
  )
  values (
    target_user_id,
    greatest(0, coalesce(new_best_score, 0)),
    v_discovered,
    v_variants,
    v_stats,
    v_leaderboard,
    v_settings,
    now()
  )
  on conflict (user_id) do update set
    best_score = excluded.best_score,
    discovered = excluded.discovered,
    stats = excluded.stats,
    updated_at = excluded.updated_at;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'username', coalesce(nullif(btrim(new_username), ''), raw_user_meta_data->>'username'),
    'display_name', coalesce(nullif(btrim(new_display_name), ''), raw_user_meta_data->>'display_name'),
    'ballrush_progress',
    jsonb_build_object(
      'version', 1,
      'best', greatest(0, coalesce(new_best_score, 0)),
      'discovered', v_discovered,
      'variants', v_variants,
      'stats', v_stats,
      'leaderboard', v_leaderboard,
      'settings', v_settings,
      'updatedAt', v_now_ms
    )
  )
  where id = target_user_id;
end;
$$;

revoke all on function public.boss_update_user(uuid, text, text, integer, integer, integer, integer) from public, anon;
grant execute on function public.boss_update_user(uuid, text, text, integer, integer, integer, integer) to authenticated;

-- 8. Reset all scores and progression for a user back to 0
create or replace function public.boss_reset_user_progress(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  delete from public.scores where user_id = target_user_id;
  delete from public.user_progress where user_id = target_user_id;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'ballrush_progress'
  where id = target_user_id;

  perform public.boss_sync_user_progress_internal(target_user_id, true);
end;
$$;

revoke all on function public.boss_reset_user_progress(uuid) from public, anon;
grant execute on function public.boss_reset_user_progress(uuid) to authenticated;

-- 9. Delete a user account completely (scores, progress, profile, sessions, auth.users)
create or replace function public.boss_delete_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if (select auth.uid()) = target_user_id then
    raise exception 'Cannot delete the currently logged-in account';
  end if;

  delete from public.scores where user_id = target_user_id;
  delete from public.user_progress where user_id = target_user_id;
  delete from public.profiles where id = target_user_id;
  delete from auth.users where id = target_user_id;
end;
$$;

revoke all on function public.boss_delete_user(uuid) from public, anon;
grant execute on function public.boss_delete_user(uuid) to authenticated;
