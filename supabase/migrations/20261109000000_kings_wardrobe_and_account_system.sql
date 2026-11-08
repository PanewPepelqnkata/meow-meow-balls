-- ============================================================================
-- THE KING'S WARDROBE — Account Identity, Customization, Achievements, Titles,
-- Lifetime Statistics, and Account Management.
-- Additive, non-destructive migration preserving all existing data.
-- ============================================================================

-- 1. Extend public.profiles with authoritative identity & customization columns
alter table public.profiles
  add column if not exists username_changed_at timestamptz,
  add column if not exists selected_avatar_id text not null default 'core:1',
  add column if not exists active_title_id text,
  add column if not exists favorite_ball_ids jsonb not null default '[]'::jsonb;

-- Backfill any null avatar or favorite_ball_ids safely
update public.profiles
set selected_avatar_id = 'core:1'
where selected_avatar_id is null or btrim(selected_avatar_id) = '';

update public.profiles
set favorite_ball_ids = '[]'::jsonb
where favorite_ball_ids is null or jsonb_typeof(favorite_ball_ids) <> 'array';

-- Deduplicate any legacy case-insensitive username collisions before adding unique index
with ranked as (
  select id, username,
         row_number() over (partition by lower(btrim(username)) order by created_at asc, id asc) as rn
  from public.profiles
  where username is not null and btrim(username) <> ''
)
update public.profiles p
set username = p.username || '_' || substr(replace(p.id::text, '-', ''), 1, 4)
from ranked r
where p.id = r.id and r.rn > 1;

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(btrim(username)))
  where username is not null and btrim(username) <> '';

-- 2. Canonical Ball Rush character identifier validation
create or replace function public.canonical_ball_id_valid(p_ball_id text)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_ball_id is null then
    return false;
  end if;
  return p_ball_id in (
    'core:1', 'core:2', 'core:3', 'core:4', 'core:5', 'core:6', 'core:7', 'core:8',
    'collectible:9:shark', 'collectible:9:pig', 'collectible:9:drunko', 'collectible:9:robo', 'collectible:9:pirate',
    'collectible:10:crab'
  );
end;
$$;
revoke all on function public.canonical_ball_id_valid(text) from public;
grant execute on function public.canonical_ball_id_valid(text) to anon, authenticated, service_role;

create or replace function public.favorite_ball_ids_valid(p_favorites jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_len integer;
  v_item text;
  v_seen text[] := array[]::text[];
begin
  if p_favorites is null or jsonb_typeof(p_favorites) <> 'array' then
    return false;
  end if;
  v_len := jsonb_array_length(p_favorites);
  if v_len > 3 then
    return false;
  end if;
  for v_item in
    select case when jsonb_typeof(elem) = 'string' then elem #>> '{}' else null end
    from jsonb_array_elements(p_favorites) elem
  loop
    if v_item is null or not public.canonical_ball_id_valid(v_item) then
      return false;
    end if;
    if v_item = any(v_seen) then
      return false;
    end if;
    v_seen := array_append(v_seen, v_item);
  end loop;
  return true;
end;
$$;
revoke all on function public.favorite_ball_ids_valid(jsonb) from public;
grant execute on function public.favorite_ball_ids_valid(jsonb) to anon, authenticated, service_role;

-- Ensure existing rows satisfy constraints before adding them
update public.profiles
set selected_avatar_id = 'core:1'
where not public.canonical_ball_id_valid(selected_avatar_id);

update public.profiles
set favorite_ball_ids = '[]'::jsonb
where not public.favorite_ball_ids_valid(favorite_ball_ids);

alter table public.profiles drop constraint if exists profiles_selected_avatar_valid;
alter table public.profiles
  add constraint profiles_selected_avatar_valid
  check (public.canonical_ball_id_valid(selected_avatar_id));

alter table public.profiles drop constraint if exists profiles_favorite_balls_valid;
alter table public.profiles
  add constraint profiles_favorite_balls_valid
  check (public.favorite_ball_ids_valid(favorite_ball_ids));

-- 3. Achievement Definitions & User Achievements tables
create table if not exists public.achievement_definitions (
  id text primary key,
  category text not null check (category in ('gameplay', 'merge', 'collection', 'score', 'milestone')),
  name text not null,
  description text not null,
  unlock_condition text not null,
  metric_key text not null check (metric_key in ('runs', 'merges', 'collection_count', 'best_score', 'best_tier')),
  target_value integer not null check (target_value > 0),
  reward_title_id text unique,
  reward_title_name text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.achievement_definitions enable row level security;

drop policy if exists "Achievement definitions are viewable by everyone" on public.achievement_definitions;
create policy "Achievement definitions are viewable by everyone"
  on public.achievement_definitions for select
  to anon, authenticated
  using (true);

create table if not exists public.user_achievements (
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_id text not null references public.achievement_definitions(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
alter table public.user_achievements enable row level security;
create index if not exists idx_user_achievements_user_unlocked
  on public.user_achievements (user_id, unlocked_at desc);

drop policy if exists "Users can view own achievements" on public.user_achievements;
create policy "Users can view own achievements"
  on public.user_achievements for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Seed structured achievement catalog and connected player titles
insert into public.achievement_definitions (
  id, category, name, description, unlock_condition, metric_key, target_value, reward_title_id, reward_title_name, sort_order
) values
  ('first_run', 'gameplay', 'First Run', 'Step into the royal chamber and complete your first game.', 'Complete 1 game', 'runs', 1, 'royal_initiate', 'Royal Initiate', 10),
  ('regular_player', 'gameplay', 'Regular Player', 'Prove your dedication to the realm across fifty completed runs.', 'Complete 50 games', 'runs', 50, null, null, 20),
  ('veteran', 'gameplay', 'Veteran', 'Stand tested across two hundred and fifty completed battles.', 'Complete 250 games', 'runs', 250, 'kingdom_veteran', 'Kingdom Veteran', 30),
  ('dedicated', 'gameplay', 'Dedicated', 'Complete one thousand runs inside the royal machine.', 'Complete 1,000 games', 'runs', 1000, 'the_unstoppable', 'The Unstoppable', 40),

  ('first_merge', 'merge', 'First Merge', 'Combine two matching slimes for the very first time.', 'Complete 1 merge', 'merges', 1, null, null, 50),
  ('merge_apprentice', 'merge', 'Merge Apprentice', 'Master the basics with one hundred successful merges.', 'Complete 100 merges', 'merges', 100, null, null, 60),
  ('merge_expert', 'merge', 'Merge Expert', 'Forge five hundred merges in the royal crucible.', 'Complete 500 merges', 'merges', 500, null, null, 70),
  ('merge_master', 'merge', 'Merge Master', 'Command the arena with two thousand lifetime merges.', 'Complete 2,000 merges', 'merges', 2000, 'master_merger', 'Master Merger', 80),

  ('first_discovery', 'collection', 'First Discovery', 'Uncover your first new ball beyond the starter trio.', 'Unlock 4 balls in Collection', 'collection_count', 4, null, null, 90),
  ('growing_collection', 'collection', 'Growing Collection', 'Fill the royal archives with eight distinct characters.', 'Unlock 8 balls in Collection', 'collection_count', 8, null, null, 100),
  ('collector', 'collection', 'Collector', 'Discover twelve characters across core and themed runs.', 'Unlock 12 balls in Collection', 'collection_count', 12, 'the_collector', 'The Collector', 110),
  ('full_collection', 'collection', 'Full Collection', 'Discover every Ball Rush character currently available in the kingdom.', 'Unlock all 14 available balls', 'collection_count', 14, 'grand_curator', 'Grand Curator', 120),

  ('first_record', 'score', 'First Record', 'Reach one thousand points in a single run.', 'Reach 1,000 points', 'best_score', 1000, null, null, 130),
  ('high_scorer', 'score', 'High Scorer', 'Score ten thousand points in a single royal run.', 'Reach 10,000 points', 'best_score', 10000, 'ball_champion', 'Ball Champion', 140),
  ('legendary_run', 'score', 'Legendary Run', 'Achieve a legendary twenty-five thousand point run.', 'Reach 25,000 points', 'best_score', 25000, 'royal_champion', 'Royal Champion', 150),

  ('tier_climber', 'milestone', 'Tier Climber', 'Merge your way up to Tier 5 in a run.', 'Reach Tier 5', 'best_tier', 5, null, null, 160),
  ('dragon_tamer', 'milestone', 'Dragon Tamer', 'Unlock a Tier 9 collectible champion during a run.', 'Reach Tier 9', 'best_tier', 9, 'dragon_tamer', 'Dragon Tamer', 170),
  ('maximum_merge', 'milestone', 'Maximum Merge', 'Reach Tier 10, the highest playable merge tier in the realm.', 'Reach Tier 10', 'best_tier', 10, 'legendary_adventurer', 'Legendary Adventurer', 180)
on conflict (id) do update set
  category = excluded.category,
  name = excluded.name,
  description = excluded.description,
  unlock_condition = excluded.unlock_condition,
  metric_key = excluded.metric_key,
  target_value = excluded.target_value,
  reward_title_id = excluded.reward_title_id,
  reward_title_name = excluded.reward_title_name,
  sort_order = excluded.sort_order;

-- 4. Table & column privilege hardening
-- Revoke direct UPDATE on public.profiles from anon/authenticated so all profile mutations
-- must pass through guarded SECURITY DEFINER RPCs (enforcing one-time username change,
-- unlocked avatar check, unlocked favorites check, and earned title check).
revoke all on table public.profiles from public, anon, authenticated;
grant select (id, username, display_name, avatar_url, selected_avatar_id, active_title_id, favorite_ball_ids, username_changed_at, created_at, updated_at)
  on table public.profiles to anon, authenticated;

drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;

revoke all on table public.achievement_definitions from public, anon, authenticated;
grant select on table public.achievement_definitions to anon, authenticated;

revoke all on table public.user_achievements from public, anon, authenticated;
grant select on table public.user_achievements to authenticated;

-- Update handle_new_user trigger so new accounts get default avatar & clean username
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := nullif(btrim(coalesce(new.raw_user_meta_data->>'username', '')), '');
  v_display text := nullif(btrim(coalesce(new.raw_user_meta_data->>'display_name', v_username, '')), '');
begin
  insert into public.profiles (
    id, username, display_name, avatar_url, email, selected_avatar_id, favorite_ball_ids
  )
  values (
    new.id,
    v_username,
    v_display,
    'core:1',
    new.email,
    'core:1',
    '[]'::jsonb
  )
  on conflict (id) do update set
    email = coalesce(excluded.email, public.profiles.email);
  return new;
end;
$$;

-- 5. Helper: Check if a user has unlocked a canonical ball character ID
create or replace function public.user_has_unlocked_ball(
  p_user_id uuid,
  p_ball_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_discovered jsonb := '{}'::jsonb;
  v_variants jsonb := '{}'::jsonb;
  v_best_tier integer := 1;
  v_max_score_tier integer := 1;
  v_tier integer;
  v_theme text;
  v_prefix text;
  v_key text;
  v_val jsonb;
begin
  if p_user_id is null or not public.canonical_ball_id_valid(p_ball_id) then
    return false;
  end if;

  -- Starter tiers 1..3 are always unlocked for every player
  if p_ball_id in ('core:1', 'core:2', 'core:3') then
    return true;
  end if;

  select
    coalesce(up.discovered, '{}'::jsonb),
    coalesce(up.variants, '{}'::jsonb),
    coalesce((up.stats->>'bestTier')::integer, 1)
  into v_discovered, v_variants, v_best_tier
  from public.user_progress up
  where up.user_id = p_user_id;

  select coalesce(max(s.tier_reached), 1)
  into v_max_score_tier
  from public.scores s
  where s.user_id = p_user_id;

  v_best_tier := greatest(coalesce(v_best_tier, 1), coalesce(v_max_score_tier, 1));

  if p_ball_id like 'core:%' then
    v_tier := (split_part(p_ball_id, ':', 2))::integer;
    if v_tier <= v_best_tier then
      return true;
    end if;
    if v_discovered ? (v_tier::text) then
      return true;
    end if;
    return false;
  end if;

  if p_ball_id like 'collectible:%' then
    v_tier := (split_part(p_ball_id, ':', 2))::integer;
    v_theme := split_part(p_ball_id, ':', 3);
    v_prefix := v_tier::text || ':' || v_theme || ':';

    -- Check lifetime variants map in user_progress
    for v_key, v_val in select * from jsonb_each(v_variants) loop
      if v_key like (v_prefix || '%') and jsonb_typeof(v_val) = 'number' and (v_val::text)::numeric > 0 then
        return true;
      end if;
    end loop;

    -- Also check verified run collectibles in public.scores
    if exists (
      select 1
      from public.scores s,
           jsonb_array_elements(coalesce(s.collectibles, '[]'::jsonb)) item
      where s.user_id = p_user_id
        and (item->>'tier')::integer = v_tier
        and btrim(item->>'theme') = v_theme
    ) then
      return true;
    end if;
  end if;

  return false;
end;
$$;
revoke all on function public.user_has_unlocked_ball(uuid, text) from public, anon, authenticated;

-- 6. Helper: Count unlocked canonical balls for a user (out of 14 implemented characters)
create or replace function public.count_user_unlocked_balls(p_user_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ball_id text;
  v_count integer := 0;
  v_all text[] := array[
    'core:1', 'core:2', 'core:3', 'core:4', 'core:5', 'core:6', 'core:7', 'core:8',
    'collectible:9:shark', 'collectible:9:pig', 'collectible:9:drunko', 'collectible:9:robo', 'collectible:9:pirate',
    'collectible:10:crab'
  ];
begin
  if p_user_id is null then
    return 0;
  end if;
  foreach v_ball_id in array v_all loop
    if public.user_has_unlocked_ball(p_user_id, v_ball_id) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.count_user_unlocked_balls(uuid) from public, anon, authenticated;

-- 7. Helper: Evaluate and grant server-verified achievements for a user
create or replace function public.evaluate_user_achievements(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_runs integer := 0;
  v_merges integer := 0;
  v_best_score integer := 0;
  v_best_tier integer := 0;
  v_collection_count integer := 0;
  v_prog_runs integer := 0;
  v_prog_merges integer := 0;
  v_prog_best integer := 0;
  v_prog_tier integer := 0;
  v_newly_unlocked jsonb := '[]'::jsonb;
  r record;
  v_metric_val integer;
  v_inserted_id text;
begin
  if p_user_id is null then
    return '[]'::jsonb;
  end if;

  -- Ensure profile row exists before recording achievements
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return '[]'::jsonb;
  end if;

  select
    count(*)::integer,
    coalesce(sum(s.balls_merged), 0)::integer,
    coalesce(max(s.score), 0)::integer,
    coalesce(max(s.tier_reached), 0)::integer
  into v_runs, v_merges, v_best_score, v_best_tier
  from public.scores s
  where s.user_id = p_user_id;

  select
    coalesce((up.stats->>'runs')::integer, 0),
    coalesce((up.stats->>'merges')::integer, 0),
    coalesce(up.best_score, 0),
    coalesce((up.stats->>'bestTier')::integer, 0)
  into v_prog_runs, v_prog_merges, v_prog_best, v_prog_tier
  from public.user_progress up
  where up.user_id = p_user_id;

  v_runs := greatest(v_runs, v_prog_runs);
  v_merges := greatest(v_merges, v_prog_merges);
  v_best_score := greatest(v_best_score, v_prog_best);
  v_best_tier := greatest(v_best_tier, v_prog_tier);
  v_collection_count := public.count_user_unlocked_balls(p_user_id);

  for r in
    select ad.*
    from public.achievement_definitions ad
    order by ad.sort_order asc
  loop
    v_metric_val := case r.metric_key
      when 'runs' then v_runs
      when 'merges' then v_merges
      when 'collection_count' then v_collection_count
      when 'best_score' then v_best_score
      when 'best_tier' then v_best_tier
      else 0
    end;

    if v_metric_val >= r.target_value then
      insert into public.user_achievements (user_id, achievement_id, unlocked_at)
      values (p_user_id, r.id, now())
      on conflict (user_id, achievement_id) do nothing
      returning achievement_id into v_inserted_id;

      if found and v_inserted_id is not null then
        v_newly_unlocked := v_newly_unlocked || jsonb_build_array(jsonb_build_object(
          'id', r.id,
          'name', r.name,
          'reward_title_id', r.reward_title_id,
          'reward_title_name', r.reward_title_name
        ));
      end if;
    end if;
  end loop;

  return v_newly_unlocked;
end;
$$;
revoke all on function public.evaluate_user_achievements(uuid) from public, anon, authenticated;

-- 8. Update boss_sync_user_progress_internal & sync_user_progress so achievement evaluation
-- happens automatically whenever a run or progress sync completes.
create or replace function public.boss_sync_user_progress_internal(
  target_user_id uuid,
  strict_from_scores boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max_score integer := 0;
  v_max_tier integer := 0;
  v_run_count integer := 0;
  v_total_merges integer := 0;
  v_coins numeric(12, 1) := 0;
  v_coin_revision bigint := 0;
  v_upgrades jsonb := '{"wallDuration":0,"shakeDuration":0,"shakeIntensity":0}'::jsonb;
  v_leaderboard jsonb := '[]'::jsonb;
  v_existing public.user_progress%rowtype;
  v_has_existing boolean := false;
  v_had_existing boolean := false;
  v_won_insert boolean := false;
  v_settled numeric(20, 1) := 0;
  v_meta_progress jsonb := null;
  v_discovered jsonb := '{}'::jsonb;
  v_variants jsonb := '{}'::jsonb;
  v_settings jsonb := '{"theme":"auto"}'::jsonb;
  v_stats jsonb;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_t integer;
begin
  select *
  into v_existing
  from public.user_progress up
  where up.user_id = target_user_id
  for update;
  v_had_existing := found;
  if not v_had_existing then
    insert into public.user_progress (user_id) values (target_user_id)
    on conflict (user_id) do nothing
    returning * into v_existing;
    v_won_insert := found;
    if not v_won_insert then
      select *
      into v_existing
      from public.user_progress up
      where up.user_id = target_user_id
      for update;
    end if;
  end if;
  v_has_existing := v_had_existing or not v_won_insert;

  select coalesce(max(s.score), 0), coalesce(max(s.tier_reached), 0), count(*)::integer,
    coalesce(sum(s.balls_merged), 0)::integer
  into v_max_score, v_max_tier, v_run_count, v_total_merges
  from public.scores s
  where s.user_id = target_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'score', sub.score, 'bestTier', sub.tier_reached,
    'at', (extract(epoch from sub.created_at) * 1000)::bigint
  ) order by sub.score desc, sub.created_at desc), '[]'::jsonb)
  into v_leaderboard
  from (
    select s.score, s.tier_reached, s.created_at
    from public.scores s
    where s.user_id = target_user_id
    order by s.score desc, s.created_at desc
    limit 10
  ) sub;

  select u.raw_user_meta_data->'ballrush_progress'
  into v_meta_progress
  from auth.users u
  where u.id = target_user_id;

  if v_has_existing then
    v_discovered := coalesce(v_existing.discovered, '{}'::jsonb);
    v_variants := coalesce(v_existing.variants, '{}'::jsonb);
    v_settings := coalesce(v_existing.settings, '{"theme":"auto"}'::jsonb);
    v_coins := coalesce(v_existing.coins, 0);
    v_coin_revision := coalesce(v_existing.coin_revision, 0);
    v_upgrades := coalesce(v_existing.upgrades,
      '{"wallDuration":0,"shakeDuration":0,"shakeIntensity":0}'::jsonb);
    if not strict_from_scores then
      v_max_score := greatest(v_max_score, coalesce(v_existing.best_score, 0));
      v_run_count := greatest(v_run_count, coalesce((v_existing.stats->>'runs')::integer, 0));
      v_total_merges := greatest(v_total_merges, coalesce((v_existing.stats->>'merges')::integer, 0));
      v_max_tier := greatest(v_max_tier, coalesce((v_existing.stats->>'bestTier')::integer, 0));
    end if;
  elsif v_meta_progress is not null and jsonb_typeof(v_meta_progress) = 'object' then
    v_discovered := coalesce(v_meta_progress->'discovered', '{}'::jsonb);
    v_variants := coalesce(v_meta_progress->'variants', '{}'::jsonb);
    v_settings := coalesce(v_meta_progress->'settings', '{"theme":"auto"}'::jsonb);
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
  end loop;

  v_settled := public.boss_settle_final_score_coins(target_user_id);
  v_coins := greatest(0, least(99999999999.9, coalesce(v_coins, 0) + v_settled));
  if v_settled > 0 then
    v_coin_revision := coalesce(v_coin_revision, 0) + 1;
  end if;
  v_stats := jsonb_build_object('runs', v_run_count, 'merges', v_total_merges, 'bestTier', v_max_tier);
  insert into public.user_progress (
    user_id, best_score, coins, coin_revision, upgrades,
    discovered, variants, stats, leaderboard, settings, updated_at
  )
  values (
    target_user_id, v_max_score, v_coins, v_coin_revision, v_upgrades,
    v_discovered, v_variants, v_stats, v_leaderboard, v_settings, now()
  )
  on conflict (user_id) do update set
    best_score = excluded.best_score,
    coins = excluded.coins,
    coin_revision = excluded.coin_revision,
    upgrades = excluded.upgrades,
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
      'coins', v_coins,
      'coinRevision', v_coin_revision,
      'discovered', v_discovered,
      'variants', v_variants,
      'stats', v_stats,
      'leaderboard', v_leaderboard,
      'settings', v_settings,
      'updatedAt', v_now_ms
    )
  )
  where id = target_user_id;

  perform public.evaluate_user_achievements(target_user_id);
end;
$$;
revoke all on function public.boss_sync_user_progress_internal(uuid, boolean) from public, anon, authenticated;

create or replace function public.sync_user_progress(
  p_save jsonb,
  p_coin_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_existing public.user_progress%rowtype;
  v_has_existing boolean := false;
  v_coins numeric(12, 1);
  v_coin_revision bigint;
  v_settled numeric(20, 1) := 0;
  v_upgrades jsonb := '{"wallDuration":0,"shakeDuration":0,"shakeIntensity":0}'::jsonb;
  v_best integer;
  v_discovered jsonb;
  v_variants jsonb;
  v_stats jsonb;
  v_leaderboard jsonb;
  v_settings jsonb;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_t integer;
  v_tier integer;
  v_new_achievements jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
  if p_save is null or jsonb_typeof(p_save) <> 'object' then
    raise exception 'Save payload is required';
  end if;
  if p_save ? 'coins' or p_save ? 'coinRevision' or p_save ? 'pendingCoins' then
    raise exception 'Client coin fields are not accepted by sync_user_progress';
  end if;
  if p_coin_revision is not null and p_coin_revision < 0 then
    raise exception 'Invalid coin revision';
  end if;

  select *
  into v_existing
  from public.user_progress up
  where up.user_id = v_uid
  for update;
  v_has_existing := found;
  if not v_has_existing then
    insert into public.user_progress (user_id) values (v_uid)
    on conflict (user_id) do nothing;
    select *
    into v_existing
    from public.user_progress up
    where up.user_id = v_uid
    for update;
    v_has_existing := true;
  end if;

  v_settled := public.boss_settle_final_score_coins(v_uid);
  v_best := greatest(0, coalesce((p_save->>'best')::integer, 0));
  v_discovered := coalesce(p_save->'discovered', '{}'::jsonb);
  v_variants := coalesce(p_save->'variants', '{}'::jsonb);
  v_stats := coalesce(p_save->'stats', '{"runs":0,"merges":0,"bestTier":0}'::jsonb);
  v_leaderboard := coalesce(p_save->'leaderboard', '[]'::jsonb);
  v_settings := coalesce(p_save->'settings', '{"theme":"auto"}'::jsonb);

  v_discovered := jsonb_build_object('1', v_now_ms, '2', v_now_ms, '3', v_now_ms) || v_discovered;
  v_tier := greatest(3, coalesce((v_stats->>'bestTier')::integer, 0));
  for v_t in 1..least(12, v_tier) loop
    if not (v_discovered ? v_t::text) then
      v_discovered := v_discovered || jsonb_build_object(v_t::text, v_now_ms);
    end if;
  end loop;

  if v_has_existing then
    v_coins := coalesce(v_existing.coins, 0) + v_settled;
    v_coin_revision := coalesce(v_existing.coin_revision, 0);
    v_upgrades := coalesce(v_existing.upgrades, v_upgrades);
    if v_settled > 0 then v_coin_revision := v_coin_revision + 1; end if;
    v_best := greatest(v_best, coalesce(v_existing.best_score, 0));
    v_discovered := v_discovered || coalesce(v_existing.discovered, '{}'::jsonb);
    v_variants := v_variants || coalesce(v_existing.variants, '{}'::jsonb);
    v_leaderboard := (select coalesce(jsonb_agg(elem), '[]'::jsonb) from (
      select elem from jsonb_array_elements(v_leaderboard) elem
      limit 10
    ) q);
  else
    v_coins := v_settled;
    v_coin_revision := 0;
    if v_settled > 0 then v_coin_revision := v_coin_revision + 1; end if;
  end if;
  v_coins := greatest(0, least(99999999999.9, round(v_coins, 1)));

  insert into public.user_progress (
    user_id, best_score, coins, coin_revision, upgrades, discovered,
    variants, stats, leaderboard, settings, updated_at
  )
  values (
    v_uid, v_best, v_coins, v_coin_revision, v_upgrades, v_discovered,
    v_variants, v_stats, v_leaderboard, v_settings, now()
  )
  on conflict (user_id) do update set
    best_score = excluded.best_score,
    coins = excluded.coins,
    coin_revision = excluded.coin_revision,
    upgrades = excluded.upgrades,
    discovered = excluded.discovered,
    variants = excluded.variants,
    stats = excluded.stats,
    leaderboard = excluded.leaderboard,
    settings = excluded.settings,
    updated_at = excluded.updated_at;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'ballrush_progress', jsonb_build_object(
      'version', 1, 'best', v_best, 'coins', v_coins,
      'coinRevision', v_coin_revision, 'discovered', v_discovered,
      'variants', v_variants, 'stats', v_stats, 'leaderboard', v_leaderboard,
      'settings', v_settings, 'updatedAt', v_now_ms
    )
  )
  where id = v_uid;

  v_new_achievements := public.evaluate_user_achievements(v_uid);

  return jsonb_build_object(
    'coins', v_coins,
    'coin_revision', v_coin_revision,
    'upgrades', v_upgrades,
    'settled_coins', v_settled,
    'newly_unlocked_achievements', v_new_achievements
  );
end;
$$;
revoke all on function public.sync_user_progress(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.sync_user_progress(jsonb, bigint) to authenticated;

-- 9. Username Normalization & Validation
create or replace function public.normalize_and_validate_username(p_raw text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_trimmed text;
  v_lower text;
  v_compact text;
  v_reserved text[] := array[
    'admin', 'administrator', 'root', 'system', 'support', 'moderator', 'mod',
    'ballrush', 'ball_rush', 'official', 'staff', 'owner', 'developer', 'dev',
    'null', 'undefined', 'anonymous', 'guest', 'king', 'royal_admin', 'supabase'
  ];
  v_prohibited text[] := array[
    'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'pussy', 'cock',
    'nigger', 'nigga', 'faggot', 'fag', 'retard', 'whore', 'slut', 'bastard',
    'nazi', 'hitler', 'rape', 'rapist', 'pedo', 'pedophile', 'kike', 'chink', 'spic'
  ];
  v_word text;
begin
  if p_raw is null then
    raise exception 'Username is required' using errcode = '22023';
  end if;

  v_trimmed := btrim(p_raw);
  if char_length(v_trimmed) < 3 or char_length(v_trimmed) > 20 then
    raise exception 'Username must be between 3 and 20 characters' using errcode = '22023';
  end if;

  if v_trimmed !~ '^[A-Za-z0-9_]+$' then
    raise exception 'Username may only contain letters, numbers, and underscores' using errcode = '22023';
  end if;

  if v_trimmed ~ '^_' or v_trimmed ~ '_$' or v_trimmed ~ '__' then
    raise exception 'Username cannot start or end with an underscore or contain consecutive underscores' using errcode = '22023';
  end if;

  v_lower := lower(v_trimmed);
  if v_lower = any(v_reserved) then
    raise exception 'This username is reserved' using errcode = '22023';
  end if;

  v_compact := translate(v_lower, '0134578@$', 'oieastbas');
  foreach v_word in array v_prohibited loop
    if position(v_word in v_lower) > 0 or position(v_word in v_compact) > 0 then
      raise exception 'Username contains prohibited language' using errcode = '22023';
    end if;
  end loop;

  return v_trimmed;
end;
$$;
revoke all on function public.normalize_and_validate_username(text) from public;
grant execute on function public.normalize_and_validate_username(text) to anon, authenticated;

-- 10. One-Time Permanent Username Change RPC
create or replace function public.change_username_once(p_new_username text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_clean text;
  v_profile public.profiles%rowtype;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if (select auth.jwt()->>'is_anonymous') = 'true' then
    raise exception 'Registered account required' using errcode = '42501';
  end if;

  v_clean := public.normalize_and_validate_username(p_new_username);

  select * into v_profile
  from public.profiles p
  where p.id = v_uid
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if v_profile.username_changed_at is not null then
    raise exception 'Username has already been changed once for this account' using errcode = '22023';
  end if;

  if lower(coalesce(v_profile.username, '')) = lower(v_clean) and coalesce(v_profile.username, '') = v_clean then
    raise exception 'New username must be different from your current username' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.profiles other
    where other.id <> v_uid
      and other.username is not null
      and lower(btrim(other.username)) = lower(v_clean)
  ) then
    raise exception 'Username is already taken' using errcode = '23505';
  end if;

  begin
    update public.profiles
    set username = v_clean,
        display_name = v_clean,
        username_changed_at = v_now,
        updated_at = v_now
    where id = v_uid
    returning * into v_profile;
  exception when unique_violation then
    raise exception 'Username is already taken' using errcode = '23505';
  end;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'username', v_clean,
    'display_name', v_clean
  )
  where id = v_uid;

  return jsonb_build_object(
    'username', v_profile.username,
    'display_name', v_profile.display_name,
    'username_changed_at', v_profile.username_changed_at,
    'updated_at', v_profile.updated_at
  );
end;
$$;
revoke all on function public.change_username_once(text) from public, anon, authenticated;
grant execute on function public.change_username_once(text) to authenticated;

-- 11. Set Selected Leaderboard Avatar RPC
create or replace function public.set_selected_avatar(p_avatar_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_avatar text := btrim(coalesce(p_avatar_id, ''));
  v_profile public.profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if (select auth.jwt()->>'is_anonymous') = 'true' then
    raise exception 'Registered account required' using errcode = '42501';
  end if;

  if not public.canonical_ball_id_valid(v_avatar) then
    raise exception 'Invalid ball character identifier' using errcode = '22023';
  end if;

  if not public.user_has_unlocked_ball(v_uid, v_avatar) then
    raise exception 'Character has not been unlocked by this account' using errcode = '42501';
  end if;

  update public.profiles
  set selected_avatar_id = v_avatar,
      avatar_url = v_avatar,
      updated_at = now()
  where id = v_uid
  returning * into v_profile;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'selected_avatar_id', v_profile.selected_avatar_id,
    'avatar_url', v_profile.avatar_url,
    'updated_at', v_profile.updated_at
  );
end;
$$;
revoke all on function public.set_selected_avatar(text) from public, anon, authenticated;
grant execute on function public.set_selected_avatar(text) to authenticated;

-- 12. Save Three Favorite Balls RPC
create or replace function public.save_favorite_balls(p_favorite_ball_ids jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item text;
  v_profile public.profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if (select auth.jwt()->>'is_anonymous') = 'true' then
    raise exception 'Registered account required' using errcode = '42501';
  end if;

  if not public.favorite_ball_ids_valid(p_favorite_ball_ids) then
    raise exception 'Favorite balls must be an array of up to 3 unique valid character IDs' using errcode = '22023';
  end if;

  for v_item in
    select elem #>> '{}'
    from jsonb_array_elements(p_favorite_ball_ids) elem
  loop
    if not public.user_has_unlocked_ball(v_uid, v_item) then
      raise exception 'Cannot select a locked character as a favorite' using errcode = '42501';
    end if;
  end loop;

  update public.profiles
  set favorite_ball_ids = p_favorite_ball_ids,
      updated_at = now()
  where id = v_uid
  returning * into v_profile;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'favorite_ball_ids', v_profile.favorite_ball_ids,
    'updated_at', v_profile.updated_at
  );
end;
$$;
revoke all on function public.save_favorite_balls(jsonb) from public, anon, authenticated;
grant execute on function public.save_favorite_balls(jsonb) to authenticated;

-- 13. Set Active Player Title RPC
create or replace function public.set_active_title(p_title_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_title text := nullif(btrim(coalesce(p_title_id, '')), '');
  v_profile public.profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if (select auth.jwt()->>'is_anonymous') = 'true' then
    raise exception 'Registered account required' using errcode = '42501';
  end if;

  -- Ensure achievements are up-to-date before checking title eligibility
  perform public.evaluate_user_achievements(v_uid);

  if v_title is not null then
    if not exists (
      select 1
      from public.achievement_definitions ad
      where ad.reward_title_id = v_title
    ) then
      raise exception 'Unknown player title' using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.user_achievements ua
      join public.achievement_definitions ad on ad.id = ua.achievement_id
      where ua.user_id = v_uid
        and ad.reward_title_id = v_title
    ) then
      raise exception 'Player title has not been unlocked yet' using errcode = '42501';
    end if;
  end if;

  update public.profiles
  set active_title_id = v_title,
      updated_at = now()
  where id = v_uid
  returning * into v_profile;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'active_title_id', v_profile.active_title_id,
    'updated_at', v_profile.updated_at
  );
end;
$$;
revoke all on function public.set_active_title(text) from public, anon, authenticated;
grant execute on function public.set_active_title(text) to authenticated;

-- 14. Aggregate King's Wardrobe Overview RPC (single request loads full royal chamber state)
create or replace function public.get_kings_wardrobe_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
  v_user_created_at timestamptz;
  v_providers jsonb := '[]'::jsonb;
  v_newly_unlocked jsonb := '[]'::jsonb;
  v_unlocked_balls jsonb := '[]'::jsonb;
  v_achievements jsonb := '[]'::jsonb;
  v_earned_titles jsonb := '[]'::jsonb;
  v_score_runs integer := 0;
  v_score_merges integer := 0;
  v_score_best integer := 0;
  v_score_tier integer := 0;
  v_score_playtime_ms bigint := 0;
  v_score_avg integer := 0;
  v_prog_runs integer := 0;
  v_prog_merges integer := 0;
  v_prog_best integer := 0;
  v_prog_tier integer := 0;
  v_coins_earned numeric(20, 1) := 0;
  v_current_coins numeric(12, 1) := 0;
  v_ball_id text;
  v_all_balls text[] := array[
    'core:1', 'core:2', 'core:3', 'core:4', 'core:5', 'core:6', 'core:7', 'core:8',
    'collectible:9:shark', 'collectible:9:pig', 'collectible:9:drunko', 'collectible:9:robo', 'collectible:9:pirate',
    'collectible:10:crab'
  ];
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_profile
  from public.profiles p
  where p.id = v_uid;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  -- Evaluate achievements on load so historical progress immediately grants earned medals & titles
  v_newly_unlocked := public.evaluate_user_achievements(v_uid);

  select u.created_at
  into v_user_created_at
  from auth.users u
  where u.id = v_uid;

  select coalesce(jsonb_agg(distinct i.provider), '["email"]'::jsonb)
  into v_providers
  from auth.identities i
  where i.user_id = v_uid;

  foreach v_ball_id in array v_all_balls loop
    if public.user_has_unlocked_ball(v_uid, v_ball_id) then
      v_unlocked_balls := v_unlocked_balls || to_jsonb(v_ball_id);
    end if;
  end loop;

  select
    count(*)::integer,
    coalesce(sum(s.balls_merged), 0)::integer,
    coalesce(max(s.score), 0)::integer,
    coalesce(max(s.tier_reached), 0)::integer,
    coalesce(sum(greatest(0, s.duration_ms)::bigint), 0)::bigint,
    case when count(*) > 0 then round(avg(s.score))::integer else 0 end
  into v_score_runs, v_score_merges, v_score_best, v_score_tier, v_score_playtime_ms, v_score_avg
  from public.scores s
  where s.user_id = v_uid;

  select
    coalesce((up.stats->>'runs')::integer, 0),
    coalesce((up.stats->>'merges')::integer, 0),
    coalesce(up.best_score, 0),
    coalesce((up.stats->>'bestTier')::integer, 0),
    coalesce(up.coins, 0)
  into v_prog_runs, v_prog_merges, v_prog_best, v_prog_tier, v_current_coins
  from public.user_progress up
  where up.user_id = v_uid;

  select coalesce(sum(cs.credited_coins), 0)
  into v_coins_earned
  from public.coin_settlements cs
  where cs.user_id = v_uid and cs.settled_at is not null;

  v_coins_earned := greatest(coalesce(v_coins_earned, 0), coalesce(v_current_coins, 0));

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ad.id,
      'category', ad.category,
      'name', ad.name,
      'description', ad.description,
      'unlock_condition', ad.unlock_condition,
      'metric_key', ad.metric_key,
      'target_value', ad.target_value,
      'reward_title_id', ad.reward_title_id,
      'reward_title_name', ad.reward_title_name,
      'sort_order', ad.sort_order,
      'unlocked', (ua.achievement_id is not null),
      'unlocked_at', ua.unlocked_at
    ) order by ad.sort_order asc
  ), '[]'::jsonb)
  into v_achievements
  from public.achievement_definitions ad
  left join public.user_achievements ua
    on ua.achievement_id = ad.id and ua.user_id = v_uid;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ad.reward_title_id,
      'name', ad.reward_title_name,
      'achievement_id', ad.id,
      'achievement_name', ad.name,
      'unlocked', (ua.achievement_id is not null),
      'unlocked_at', ua.unlocked_at
    ) order by ad.sort_order asc
  ), '[]'::jsonb)
  into v_earned_titles
  from public.achievement_definitions ad
  left join public.user_achievements ua
    on ua.achievement_id = ad.id and ua.user_id = v_uid
  where ad.reward_title_id is not null;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'username', v_profile.username,
      'display_name', coalesce(v_profile.display_name, v_profile.username),
      'selected_avatar_id', v_profile.selected_avatar_id,
      'active_title_id', v_profile.active_title_id,
      'favorite_ball_ids', v_profile.favorite_ball_ids,
      'username_changed_at', v_profile.username_changed_at,
      'created_at', coalesce(v_user_created_at, v_profile.created_at),
      'updated_at', v_profile.updated_at
    ),
    'auth_providers', v_providers,
    'unlocked_ball_ids', v_unlocked_balls,
    'total_available_balls', 14,
    'achievements', v_achievements,
    'titles', v_earned_titles,
    'newly_unlocked_achievements', v_newly_unlocked,
    'statistics', jsonb_build_object(
      'games_played', greatest(v_score_runs, v_prog_runs),
      'total_merges', greatest(v_score_merges, v_prog_merges),
      'highest_tier', greatest(1, v_score_tier, v_prog_tier),
      'total_playtime_ms', v_score_playtime_ms,
      'total_coins_earned', round(v_coins_earned, 1),
      'current_coins', round(v_current_coins, 1),
      'average_score', v_score_avg,
      'best_score', greatest(v_score_best, v_prog_best),
      'verified_runs_count', v_score_runs
    )
  );
end;
$$;
revoke all on function public.get_kings_wardrobe_overview() from public, anon, authenticated;
grant execute on function public.get_kings_wardrobe_overview() to authenticated;

-- 15. Trusted Self-Service Account Deletion RPC
-- Requires explicit confirmation text 'DELETE'. Cleans up auth.users (cascading to profiles,
-- scores, user_progress, user_achievements, economy_ledger, game_sessions) while retaining
-- immutable coin_settlements tombstones so deleted score IDs can never be re-settled.
create or replace function public.delete_own_account(p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if (select auth.jwt()->>'is_anonymous') = 'true' then
    raise exception 'Registered account required' using errcode = '42501';
  end if;
  if btrim(coalesce(p_confirmation, '')) <> 'DELETE' then
    raise exception 'Explicit DELETE confirmation is required' using errcode = '22023';
  end if;

  delete from public.scores where user_id = v_uid;
  delete from public.user_progress where user_id = v_uid;
  delete from public.user_achievements where user_id = v_uid;
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;

  return jsonb_build_object('deleted', true, 'deleted_user_id', v_uid);
end;
$$;
revoke all on function public.delete_own_account(text) from public, anon, authenticated;
grant execute on function public.delete_own_account(text) to authenticated;