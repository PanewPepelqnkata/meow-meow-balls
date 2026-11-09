-- ============================================================================
-- CONTAINER SKINS — Royal Keep (Default) & OG Container (Store Cosmetic)
-- Server-authoritative ownership, atomic coin purchase (250 coins), and
-- equipping across public.profiles and public.user_progress.
-- ============================================================================

-- 1. Validation helpers for canonical container skin IDs
create or replace function public.container_skin_id_valid(p_skin_id text)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_skin_id is null then
    return false;
  end if;
  return p_skin_id in ('royal_keep', 'og_container');
end;
$$;
revoke all on function public.container_skin_id_valid(text) from public;
grant execute on function public.container_skin_id_valid(text) to anon, authenticated, service_role;

create or replace function public.owned_container_skins_valid(p_skins jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_item text;
  v_seen text[] := array[]::text[];
begin
  if p_skins is null or jsonb_typeof(p_skins) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_skins) < 1 or jsonb_array_length(p_skins) > 10 then
    return false;
  end if;
  for v_item in
    select case when jsonb_typeof(elem) = 'string' then elem #>> '{}' else null end
    from jsonb_array_elements(p_skins) elem
  loop
    if v_item is null or not public.container_skin_id_valid(v_item) then
      return false;
    end if;
    if v_item = any(v_seen) then
      return false;
    end if;
    v_seen := array_append(v_seen, v_item);
  end loop;
  if not ('royal_keep' = any(v_seen)) then
    return false;
  end if;
  return true;
end;
$$;
revoke all on function public.owned_container_skins_valid(jsonb) from public;
grant execute on function public.owned_container_skins_valid(jsonb) to anon, authenticated, service_role;

-- 2. Add container skin columns to public.profiles and public.user_progress
alter table public.profiles
  add column if not exists equipped_container_skin text not null default 'royal_keep',
  add column if not exists owned_container_skins jsonb not null default '["royal_keep"]'::jsonb;

alter table public.user_progress
  add column if not exists equipped_container_skin text not null default 'royal_keep',
  add column if not exists owned_container_skins jsonb not null default '["royal_keep"]'::jsonb;

update public.profiles
set equipped_container_skin = 'royal_keep'
where not public.container_skin_id_valid(equipped_container_skin);

update public.profiles
set owned_container_skins = '["royal_keep"]'::jsonb
where not public.owned_container_skins_valid(owned_container_skins);

update public.user_progress
set equipped_container_skin = 'royal_keep'
where not public.container_skin_id_valid(equipped_container_skin);

update public.user_progress
set owned_container_skins = '["royal_keep"]'::jsonb
where not public.owned_container_skins_valid(owned_container_skins);

alter table public.profiles drop constraint if exists profiles_equipped_container_skin_valid;
alter table public.profiles
  add constraint profiles_equipped_container_skin_valid
  check (public.container_skin_id_valid(equipped_container_skin));

alter table public.profiles drop constraint if exists profiles_owned_container_skins_valid;
alter table public.profiles
  add constraint profiles_owned_container_skins_valid
  check (public.owned_container_skins_valid(owned_container_skins));

alter table public.user_progress drop constraint if exists user_progress_equipped_container_skin_valid;
alter table public.user_progress
  add constraint user_progress_equipped_container_skin_valid
  check (public.container_skin_id_valid(equipped_container_skin));

alter table public.user_progress drop constraint if exists user_progress_owned_container_skins_valid;
alter table public.user_progress
  add constraint user_progress_owned_container_skins_valid
  check (public.owned_container_skins_valid(owned_container_skins));

grant select (
  id, username, display_name, avatar_url, selected_avatar_id, active_title_id,
  favorite_ball_ids, equipped_container_skin, owned_container_skins,
  username_changed_at, created_at, updated_at
) on table public.profiles to anon, authenticated;

-- 3. Ensure new accounts receive Royal Keep equipped by default
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
    id, username, display_name, avatar_url, email, selected_avatar_id,
    favorite_ball_ids, equipped_container_skin, owned_container_skins
  )
  values (
    new.id,
    v_username,
    v_display,
    'core:1',
    new.email,
    'core:1',
    '[]'::jsonb,
    'royal_keep',
    '["royal_keep"]'::jsonb
  )
  on conflict (id) do update set
    email = coalesce(excluded.email, public.profiles.email);
  return new;
end;
$$;

-- 4. Atomic Server-Authoritative Container Skin Purchase RPC
create or replace function public.purchase_container_skin(
  p_skin_id text,
  p_coin_revision bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_skin text := btrim(coalesce(p_skin_id, ''));
  v_cost numeric(12, 1);
  v_settled numeric(20, 1) := 0;
  v_current_coins numeric(12, 1);
  v_current_revision bigint;
  v_current_upgrades jsonb;
  v_owned jsonb := '["royal_keep"]'::jsonb;
  v_equipped text := 'royal_keep';
  v_next_coins numeric(12, 1);
  v_next_revision bigint;
  v_next_owned jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if (select auth.jwt()->>'is_anonymous') = 'true' then
    raise exception 'Registered account required' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid) then
    raise exception 'Registered account required' using errcode = '42501';
  end if;
  if not public.container_skin_id_valid(v_skin) then
    raise exception 'Unknown container skin' using errcode = '22023';
  end if;
  if p_coin_revision is not null and p_coin_revision < 0 then
    raise exception 'Invalid coin revision' using errcode = '22023';
  end if;

  if v_skin = 'royal_keep' then
    raise exception 'Royal Keep is already unlocked by default' using errcode = '22023';
  elsif v_skin = 'og_container' then
    v_cost := 250;
  else
    raise exception 'Unknown container skin' using errcode = '22023';
  end if;

  insert into public.user_progress (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select
    up.coins,
    up.coin_revision,
    up.upgrades,
    coalesce(up.owned_container_skins, '["royal_keep"]'::jsonb),
    coalesce(up.equipped_container_skin, 'royal_keep')
  into
    v_current_coins,
    v_current_revision,
    v_current_upgrades,
    v_owned,
    v_equipped
  from public.user_progress up
  where up.user_id = v_uid
  for update;

  if not found then
    raise exception 'User progress record not found';
  end if;

  -- Check if already owned in user_progress or profiles
  if v_owned @> to_jsonb(v_skin) or exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.owned_container_skins @> to_jsonb(v_skin)
  ) then
    raise exception 'Container skin is already owned' using errcode = '22023';
  end if;

  -- Settle any newly completed score rows before checking coin balance
  v_settled := public.boss_settle_final_score_coins(v_uid);
  if v_settled > 0 then
    v_current_coins := greatest(0, least(99999999999.9, round(coalesce(v_current_coins, 0) + v_settled, 1)));
    v_current_revision := coalesce(v_current_revision, 0) + 1;
  end if;

  if p_coin_revision is not null and coalesce(v_current_revision, 0) <> p_coin_revision and v_settled = 0 then
    raise exception 'Coin balance changed. Please try again.' using errcode = '40001';
  end if;

  if coalesce(v_current_coins, 0) < v_cost then
    raise exception 'Insufficient coins' using errcode = '22023';
  end if;

  v_next_coins := round(coalesce(v_current_coins, 0) - v_cost, 1);
  v_next_revision := coalesce(v_current_revision, 0) + 1;
  v_next_owned := v_owned || to_jsonb(v_skin);

  update public.user_progress
  set coins = v_next_coins,
      coin_revision = v_next_revision,
      owned_container_skins = v_next_owned,
      updated_at = now()
  where user_id = v_uid;

  update public.profiles
  set owned_container_skins = v_next_owned,
      updated_at = now()
  where id = v_uid;

  insert into public.economy_ledger (user_id, session_id, delta, balance_after, coin_revision, reason)
  values (v_uid, null, -v_cost, v_next_coins, v_next_revision, 'container_skin:' || v_skin);

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'ballrush_progress',
    ((case when jsonb_typeof(raw_user_meta_data->'ballrush_progress') = 'object'
      then raw_user_meta_data->'ballrush_progress' else '{}'::jsonb end)
      || jsonb_build_object('coins', v_next_coins, 'coinRevision', v_next_revision))
      - 'upgrades'
  )
  where id = v_uid;

  return jsonb_build_object(
    'coins', v_next_coins,
    'coin_revision', v_next_revision,
    'upgrades', coalesce(v_current_upgrades, '{"wallDuration":0,"shakeDuration":0,"shakeIntensity":0}'::jsonb),
    'owned_container_skins', v_next_owned,
    'equipped_container_skin', v_equipped
  );
end;
$$;
revoke all on function public.purchase_container_skin(text, bigint) from public, anon, authenticated;
grant execute on function public.purchase_container_skin(text, bigint) to authenticated;

-- 5. Server-Authoritative Equip Container Skin RPC
create or replace function public.equip_container_skin(p_skin_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_skin text := btrim(coalesce(p_skin_id, ''));
  v_owned_up jsonb := '["royal_keep"]'::jsonb;
  v_owned_prof jsonb := '["royal_keep"]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if (select auth.jwt()->>'is_anonymous') = 'true' then
    raise exception 'Registered account required' using errcode = '42501';
  end if;
  if not public.container_skin_id_valid(v_skin) then
    raise exception 'Invalid container skin identifier' using errcode = '22023';
  end if;

  insert into public.user_progress (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select coalesce(up.owned_container_skins, '["royal_keep"]'::jsonb)
  into v_owned_up
  from public.user_progress up
  where up.user_id = v_uid
  for update;

  select coalesce(p.owned_container_skins, '["royal_keep"]'::jsonb)
  into v_owned_prof
  from public.profiles p
  where p.id = v_uid
  for update;

  if v_skin <> 'royal_keep'
     and not (coalesce(v_owned_up, '["royal_keep"]'::jsonb) @> to_jsonb(v_skin))
     and not (coalesce(v_owned_prof, '["royal_keep"]'::jsonb) @> to_jsonb(v_skin)) then
    raise exception 'Container skin has not been unlocked by this account' using errcode = '42501';
  end if;

  update public.user_progress
  set equipped_container_skin = v_skin,
      updated_at = now()
  where user_id = v_uid;

  update public.profiles
  set equipped_container_skin = v_skin,
      updated_at = now()
  where id = v_uid;

  return jsonb_build_object(
    'equipped_container_skin', v_skin,
    'owned_container_skins', coalesce(v_owned_up, v_owned_prof, '["royal_keep"]'::jsonb),
    'updated_at', now()
  );
end;
$$;
revoke all on function public.equip_container_skin(text) from public, anon, authenticated;
grant execute on function public.equip_container_skin(text) to authenticated;

-- 6. Update sync_user_progress to return authoritative container skin ownership & equipment
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
  v_owned_skins jsonb := '["royal_keep"]'::jsonb;
  v_equipped_skin text := 'royal_keep';
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
    v_owned_skins := coalesce(v_existing.owned_container_skins, '["royal_keep"]'::jsonb);
    v_equipped_skin := coalesce(v_existing.equipped_container_skin, 'royal_keep');
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
    user_id, best_score, coins, coin_revision, upgrades,
    owned_container_skins, equipped_container_skin,
    discovered, variants, stats, leaderboard, settings, updated_at
  )
  values (
    v_uid, v_best, v_coins, v_coin_revision, v_upgrades,
    v_owned_skins, v_equipped_skin,
    v_discovered, v_variants, v_stats, v_leaderboard, v_settings, now()
  )
  on conflict (user_id) do update set
    best_score = excluded.best_score,
    coins = excluded.coins,
    coin_revision = excluded.coin_revision,
    upgrades = excluded.upgrades,
    owned_container_skins = excluded.owned_container_skins,
    equipped_container_skin = excluded.equipped_container_skin,
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
    'owned_container_skins', v_owned_skins,
    'equipped_container_skin', v_equipped_skin,
    'settled_coins', v_settled,
    'newly_unlocked_achievements', v_new_achievements
  );
end;
$$;
revoke all on function public.sync_user_progress(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.sync_user_progress(jsonb, bigint) to authenticated;

-- 7. Update get_kings_wardrobe_overview to include container skin ownership & equipment
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
  v_owned_skins jsonb := '["royal_keep"]'::jsonb;
  v_equipped_skin text := 'royal_keep';
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
    coalesce(up.coins, 0),
    coalesce(up.owned_container_skins, v_profile.owned_container_skins, '["royal_keep"]'::jsonb),
    coalesce(up.equipped_container_skin, v_profile.equipped_container_skin, 'royal_keep')
  into v_prog_runs, v_prog_merges, v_prog_best, v_prog_tier, v_current_coins, v_owned_skins, v_equipped_skin
  from public.user_progress up
  where up.user_id = v_uid;

  if not found then
    v_owned_skins := coalesce(v_profile.owned_container_skins, '["royal_keep"]'::jsonb);
    v_equipped_skin := coalesce(v_profile.equipped_container_skin, 'royal_keep');
  end if;

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
      'equipped_container_skin', v_equipped_skin,
      'owned_container_skins', v_owned_skins,
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
