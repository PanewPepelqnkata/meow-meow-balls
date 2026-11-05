-- Secure boss dashboard coin editing and protect admin coin adjustments from stale client saves.
-- This migration runs after 20261105210000_boss_coin_admin.sql and replaces its authenticated-only RPCs.

create table if not exists public.boss_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.boss_admins enable row level security;
revoke all on table public.boss_admins from public, anon, authenticated;

grant select on table public.boss_admins to authenticated;
drop policy if exists boss_admins_select_self on public.boss_admins;
create policy boss_admins_select_self on public.boss_admins
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.boss_require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.boss_admins where user_id = (select auth.uid())
  ) then
    raise exception 'Boss administrator access required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.boss_require_admin() from public, anon, authenticated;
grant execute on function public.boss_require_admin() to authenticated;

create or replace function public.boss_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.boss_admins where user_id = (select auth.uid())
  );
$$;
revoke all on function public.boss_is_admin() from public, anon, authenticated;
grant execute on function public.boss_is_admin() to authenticated;

alter table public.user_progress
  add column if not exists coin_revision bigint not null default 0;

update public.user_progress up
set coin_revision = greatest(
  up.coin_revision,
  coalesce((u.raw_user_meta_data->'ballrush_progress'->>'coinRevision')::bigint, 0)
)
from auth.users u
where u.id = up.user_id
  and up.coin_revision = 0
  and (u.raw_user_meta_data->'ballrush_progress'->>'coinRevision') ~ '^[0-9]+$'
  and coalesce((u.raw_user_meta_data->'ballrush_progress'->>'coinRevision')::bigint, 0) > 0;

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
  v_leaderboard jsonb := '[]'::jsonb;
  v_existing public.user_progress%rowtype;
  v_has_existing boolean := false;
  v_meta_progress jsonb := null;
  v_discovered jsonb := '{}'::jsonb;
  v_variants jsonb := '{}'::jsonb;
  v_settings jsonb := '{"theme":"auto"}'::jsonb;
  v_stats jsonb;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_t integer;
begin
  select * into v_existing from public.user_progress up where up.user_id = target_user_id for update;
  v_has_existing := found;

  select coalesce(max(s.score), 0), coalesce(max(s.tier_reached), 0), count(*)::integer,
    coalesce(sum(s.balls_merged), 0)::integer
  into v_max_score, v_max_tier, v_run_count, v_total_merges
  from public.scores s where s.user_id = target_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'score', sub.score, 'bestTier', sub.tier_reached,
    'at', (extract(epoch from sub.created_at) * 1000)::bigint
  ) order by sub.score desc, sub.created_at desc), '[]'::jsonb)
  into v_leaderboard
  from (
    select s.score, s.tier_reached, s.created_at from public.scores s
    where s.user_id = target_user_id order by s.score desc, s.created_at desc limit 10
  ) sub;

  select u.raw_user_meta_data->'ballrush_progress' into v_meta_progress
  from auth.users u where u.id = target_user_id;

  if v_has_existing then
    v_discovered := coalesce(v_existing.discovered, '{}'::jsonb);
    v_variants := coalesce(v_existing.variants, '{}'::jsonb);
    v_settings := coalesce(v_existing.settings, '{"theme":"auto"}'::jsonb);
    v_coins := coalesce(v_existing.coins, 0);
    v_coin_revision := coalesce(v_existing.coin_revision, 0);
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
    v_coins := case
      when (v_meta_progress->>'coins') ~ '^[0-9]{1,11}(\.[0-9])?$'
        then greatest(0, (v_meta_progress->>'coins')::numeric)
      else 0
    end;
    v_coin_revision := case
      when (v_meta_progress->>'coinRevision') ~ '^[0-9]+$'
        then greatest(0, (v_meta_progress->>'coinRevision')::bigint)
      else 0
    end;
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

  v_stats := jsonb_build_object('runs', v_run_count, 'merges', v_total_merges, 'bestTier', v_max_tier);
  insert into public.user_progress (user_id, best_score, coins, coin_revision, discovered, variants, stats, leaderboard, settings, updated_at)
  values (target_user_id, v_max_score, v_coins, v_coin_revision, v_discovered, v_variants, v_stats, v_leaderboard, v_settings, now())
  on conflict (user_id) do update set
    best_score = excluded.best_score,
    coins = excluded.coins,
    coin_revision = excluded.coin_revision,
    discovered = excluded.discovered,
    variants = excluded.variants,
    stats = excluded.stats,
    leaderboard = excluded.leaderboard,
    settings = excluded.settings,
    updated_at = excluded.updated_at;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('ballrush_progress',
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
    ))
  where id = target_user_id;
end;
$$;
revoke all on function public.boss_sync_user_progress_internal(uuid, boolean) from public, anon, authenticated;

create or replace function public.boss_update_user_coins(
  target_user_id uuid,
  operation text,
  amount numeric
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current numeric(12, 1);
  v_amount numeric(12, 1);
  v_next numeric(12, 1);
  v_coin_revision bigint;
  v_meta jsonb;
begin
  perform public.boss_require_admin();
  if target_user_id is null then
    raise exception 'Target user is required';
  end if;
  if operation not in ('increase', 'decrease', 'set') then
    raise exception 'Invalid coin operation';
  end if;
  if amount is null or amount < 0 or amount > 99999999999.9 then
    raise exception 'Coin amount must be between 0 and 99999999999.9';
  end if;

  v_amount := round(amount, 1);

  select up.coins, up.coin_revision
  into v_current, v_coin_revision
  from public.user_progress up
  where up.user_id = target_user_id
  for update;

  if not found then
    perform public.boss_sync_user_progress_internal(target_user_id, false);
    select up.coins, up.coin_revision
    into v_current, v_coin_revision
    from public.user_progress up
    where up.user_id = target_user_id
    for update;
  end if;

  if v_current is null then v_current := 0; end if;
  if v_coin_revision is null then v_coin_revision := 0; end if;

  v_next := case operation
    when 'increase' then v_current + v_amount
    when 'decrease' then v_current - v_amount
    else v_amount
  end;
  v_next := greatest(0, least(99999999999.9, round(v_next, 1)));
  v_coin_revision := v_coin_revision + 1;

  update public.user_progress
  set coins = v_next, coin_revision = v_coin_revision, updated_at = now()
  where user_id = target_user_id;

  if not found then
    raise exception 'User progress record not found';
  end if;

  select raw_user_meta_data->'ballrush_progress' into v_meta
  from auth.users where id = target_user_id;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'ballrush_progress',
    (case when jsonb_typeof(v_meta) = 'object' then v_meta else '{}'::jsonb end)
      || jsonb_build_object('coins', v_next, 'coinRevision', v_coin_revision)
  )
  where id = target_user_id;

  return v_next;
end;
$$;
revoke all on function public.boss_update_user_coins(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.boss_update_user_coins(uuid, text, numeric) to authenticated;

create or replace function public.boss_get_dashboard_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform public.boss_require_admin();
  select jsonb_build_object(
    'profiles', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'username', p.username, 'display_name', p.display_name,
        'email', coalesce(p.email, u.email), 'avatar_url', p.avatar_url,
        'created_at', p.created_at, 'updated_at', p.updated_at, 'last_sign_in_at', u.last_sign_in_at
      ) order by p.created_at desc), '[]'::jsonb)
      from public.profiles p left join auth.users u on u.id = p.id
    ),
    'scores', (select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc), '[]'::jsonb) from public.scores s),
    'progress', (select coalesce(jsonb_agg(to_jsonb(up)), '[]'::jsonb) from public.user_progress up),
    'guest_profiles', (select coalesce(jsonb_agg(to_jsonb(gp) order by gp.last_seen_at desc), '[]'::jsonb) from public.guest_profiles gp),
    'guest_scores', (select coalesce(jsonb_agg(to_jsonb(gs) order by gs.created_at desc), '[]'::jsonb) from public.guest_scores gs),
    'generated_at', now()
  ) into result;
  return result;
end;
$$;
revoke all on function public.boss_get_dashboard_data() from public, anon, authenticated;
grant execute on function public.boss_get_dashboard_data() to authenticated;

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
set search_path = ''
as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_discovered jsonb := jsonb_build_object('1', v_now_ms, '2', v_now_ms, '3', v_now_ms);
  v_variants jsonb := '{}'::jsonb;
  v_leaderboard jsonb := '[]'::jsonb;
  v_settings jsonb := '{"theme": "auto"}'::jsonb;
  v_stats jsonb;
  v_coins numeric(12, 1) := 0;
  v_coin_revision bigint := 0;
  v_clamped_tier integer := greatest(0, least(12, coalesce(new_best_tier, 0)));
  v_t integer;
begin
  perform public.boss_require_admin();

  update public.profiles
  set
    username = coalesce(nullif(btrim(new_username), ''), username),
    display_name = coalesce(nullif(btrim(new_display_name), ''), display_name),
    updated_at = now()
  where id = target_user_id;

  select
    coalesce(up.coins, 0),
    coalesce(up.coin_revision, 0),
    coalesce(up.discovered, v_discovered),
    coalesce(up.variants, '{}'::jsonb),
    coalesce(up.leaderboard, '[]'::jsonb),
    coalesce(up.settings, '{"theme": "auto"}'::jsonb)
  into v_coins, v_coin_revision, v_discovered, v_variants, v_leaderboard, v_settings
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
    coins,
    coin_revision,
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
    greatest(0, least(99999999999.9, v_coins)),
    v_coin_revision,
    v_discovered,
    v_variants,
    v_stats,
    v_leaderboard,
    v_settings,
    now()
  )
  on conflict (user_id) do update set
    best_score = excluded.best_score,
    coins = excluded.coins,
    coin_revision = excluded.coin_revision,
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
      'coins', greatest(0, least(99999999999.9, v_coins)),
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
end;
$$;
revoke all on function public.boss_update_user(uuid, text, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.boss_update_user(uuid, text, text, integer, integer, integer, integer) to authenticated;

create or replace function public.sync_user_progress(
  p_save jsonb,
  p_coins_earned numeric,
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
  v_meta jsonb;
  v_coins numeric(12, 1);
  v_coin_revision bigint;
  v_earned numeric(12, 1);
  v_best integer;
  v_discovered jsonb;
  v_variants jsonb;
  v_stats jsonb;
  v_leaderboard jsonb;
  v_settings jsonb;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_t integer;
  v_tier integer;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
  if p_save is null or jsonb_typeof(p_save) <> 'object' then
    raise exception 'Save payload is required';
  end if;
  if p_save ? 'coins' or p_save ? 'coinRevision' then
    raise exception 'Client coin fields are not accepted by sync_user_progress';
  end if;

  v_earned := greatest(0, least(99999999999.9, round(coalesce(p_coins_earned, 0), 1)));
  v_coin_revision := greatest(0, coalesce(p_coin_revision, 0));
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

  select * into v_existing from public.user_progress up where up.user_id = v_uid for update;
  v_has_existing := found;

  if v_has_existing then
    v_coins := coalesce(v_existing.coins, 0) + v_earned;
    v_coin_revision := greatest(v_coin_revision, coalesce(v_existing.coin_revision, 0));
    if v_earned > 0 then
      v_coin_revision := v_coin_revision + 1;
    end if;
    v_best := greatest(v_best, coalesce(v_existing.best_score, 0));
    v_discovered := v_discovered || coalesce(v_existing.discovered, '{}'::jsonb);
    v_variants := v_variants || coalesce(v_existing.variants, '{}'::jsonb);
    v_leaderboard := v_leaderboard || coalesce(v_existing.leaderboard, '[]'::jsonb);
  else
    v_coins := v_earned;
    if v_earned > 0 then
      v_coin_revision := v_coin_revision + 1;
    end if;
  end if;

  v_coins := greatest(0, least(99999999999.9, round(v_coins, 1)));

  insert into public.user_progress (user_id, best_score, coins, coin_revision, discovered, variants, stats, leaderboard, settings, updated_at)
  values (v_uid, v_best, v_coins, v_coin_revision, v_discovered, v_variants, v_stats, v_leaderboard, v_settings, now())
  on conflict (user_id) do update set
    best_score = excluded.best_score,
    coins = excluded.coins,
    coin_revision = excluded.coin_revision,
    discovered = excluded.discovered,
    variants = excluded.variants,
    stats = excluded.stats,
    leaderboard = excluded.leaderboard,
    settings = excluded.settings,
    updated_at = excluded.updated_at;

  select raw_user_meta_data->'ballrush_progress' into v_meta
  from auth.users where id = v_uid;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'ballrush_progress',
    (case when jsonb_typeof(v_meta) = 'object' then v_meta else '{}'::jsonb end)
      || jsonb_build_object(
        'version', 1,
        'best', v_best,
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
  where id = v_uid;

  return jsonb_build_object('coins', v_coins, 'coin_revision', v_coin_revision);
end;
$$;
revoke all on function public.sync_user_progress(jsonb, numeric, bigint) from public, anon, authenticated;
grant execute on function public.sync_user_progress(jsonb, numeric, bigint) to authenticated;

-- No user is automatically granted admin status. Add the intended UUID explicitly in SQL Editor:
-- insert into public.boss_admins (user_id) values ('<trusted-auth-user-uuid>');
