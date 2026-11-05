-- Per-run discoveries, separate from the lifetime variants collection.
-- NULL = legacy/unrecorded; [] = a recorded run with no collectible finds.
-- Never backfill identities from score caps, palette-only keys, or rolled themes.
alter table public.scores add column if not exists collectibles jsonb;
alter table public.guest_scores add column if not exists collectibles jsonb;

comment on column public.scores.collectibles is
  'Actual per-run discoveries [{tier,theme,variant,discoveredAt}]. NULL means legacy/unrecorded; [] means recorded none.';
comment on column public.guest_scores.collectibles is
  'Actual per-run discoveries [{tier,theme,variant,discoveredAt}]. NULL means legacy/unrecorded; [] means recorded none.';

create or replace function public.run_collectibles_valid(value jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  tier numeric;
  variant numeric;
begin
  if value is null then return true; end if;
  if jsonb_typeof(value) is distinct from 'array' then return false; end if;
  for item in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'tier') is distinct from 'number'
      or jsonb_typeof(item->'theme') is distinct from 'string'
      or jsonb_typeof(item->'variant') is distinct from 'number'
      or jsonb_typeof(item->'discoveredAt') is distinct from 'number'
    then return false; end if;
    tier := (item->>'tier')::numeric;
    variant := (item->>'variant')::numeric;
    if tier <> trunc(tier) or tier < 9 or tier > 12
      or variant <> trunc(variant) or variant < 0 or variant > 7
      or btrim(item->>'theme') = ''
      or (item->>'discoveredAt')::numeric <= 0
    then return false; end if;
  end loop;
  return true;
end;
$$;

-- Pure validation is also used by table CHECK constraints for direct inserts.
revoke all on function public.run_collectibles_valid(jsonb) from public;
grant execute on function public.run_collectibles_valid(jsonb) to anon, authenticated, service_role;

alter table public.scores drop constraint if exists scores_collectibles_valid;
alter table public.scores add constraint scores_collectibles_valid check (public.run_collectibles_valid(collectibles));
alter table public.guest_scores drop constraint if exists guest_scores_collectibles_valid;
alter table public.guest_scores add constraint guest_scores_collectibles_valid check (public.run_collectibles_valid(collectibles));

-- Union protects a newer snapshot from a slower, older live update. Identity is
-- tier + character theme + palette; its timestamp is the first observation.
create or replace function public.merge_run_collectibles(existing jsonb, incoming jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.run_collectibles_valid(existing) or not public.run_collectibles_valid(incoming) then
    raise exception 'collectibles must be null or an array of {tier,theme,variant,discoveredAt}' using errcode = '22023';
  end if;
  if existing is null and incoming is null then return null; end if;
  select coalesce(jsonb_agg(
    jsonb_build_object('tier', tier, 'theme', theme, 'variant', variant, 'discoveredAt', discovered_at)
    order by discovered_at, tier, theme, variant
  ), '[]'::jsonb)
  into result
  from (
    select (item->>'tier')::integer as tier,
      btrim(item->>'theme') as theme,
      (item->>'variant')::integer as variant,
      min((item->>'discoveredAt')::numeric) as discovered_at
    from jsonb_array_elements(coalesce(existing, '[]'::jsonb) || coalesce(incoming, '[]'::jsonb)) item
    group by (item->>'tier')::integer, btrim(item->>'theme'), (item->>'variant')::integer
  ) discoveries;
  return result;
end;
$$;
revoke all on function public.merge_run_collectibles(jsonb, jsonb) from public, anon, authenticated;

-- Preserve the existing lifetime variants map; per-run snapshots are audit
-- history, not recovery inputs (rebuilding would undo a collection reset).
-- Score/tier caps must never invent a palette or character identity.
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

  v_stats := jsonb_build_object('runs', v_run_count, 'merges', v_total_merges, 'bestTier', v_max_tier);
  insert into public.user_progress (user_id, best_score, discovered, variants, stats, leaderboard, settings, updated_at)
  values (target_user_id, v_max_score, v_discovered, v_variants, v_stats, v_leaderboard, v_settings, now())
  on conflict (user_id) do update set
    best_score = excluded.best_score, discovered = excluded.discovered, variants = excluded.variants,
    stats = excluded.stats, leaderboard = excluded.leaderboard, settings = excluded.settings, updated_at = excluded.updated_at;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('ballrush_progress',
    jsonb_build_object('version', 1, 'best', v_max_score, 'discovered', v_discovered, 'variants', v_variants,
      'stats', v_stats, 'leaderboard', v_leaderboard, 'settings', v_settings, 'updatedAt', v_now_ms))
  where id = target_user_id;
end;
$$;
revoke all on function public.boss_sync_user_progress_internal(uuid, boolean) from public, anon, authenticated;

create or replace function public.boss_sync_guest_progress_internal(
  target_guest_id uuid,
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
  v_leaderboard jsonb := '[]'::jsonb;
  v_existing public.guest_profiles%rowtype;
  v_has_existing boolean := false;
  v_discovered jsonb := '{}'::jsonb;
  v_variants jsonb := '{}'::jsonb;
  v_settings jsonb := '{"theme":"auto"}'::jsonb;
  v_stats jsonb;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_t integer;
begin
  select * into v_existing from public.guest_profiles gp where gp.guest_id = target_guest_id for update;
  v_has_existing := found;

  select coalesce(max(gs.score), 0), coalesce(max(gs.tier_reached), 0), count(*)::integer,
    coalesce(sum(gs.balls_merged), 0)::integer
  into v_max_score, v_max_tier, v_run_count, v_total_merges
  from public.guest_scores gs where gs.guest_id = target_guest_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'score', sub.score, 'bestTier', sub.tier_reached,
    'at', (extract(epoch from sub.created_at) * 1000)::bigint
  ) order by sub.score desc, sub.created_at desc), '[]'::jsonb)
  into v_leaderboard
  from (
    select gs.score, gs.tier_reached, gs.created_at from public.guest_scores gs
    where gs.guest_id = target_guest_id order by gs.score desc, gs.created_at desc limit 10
  ) sub;

  if v_has_existing then
    v_discovered := coalesce(v_existing.discovered, '{}'::jsonb);
    v_variants := coalesce(v_existing.variants, '{}'::jsonb);
    v_settings := coalesce(v_existing.settings, '{"theme":"auto"}'::jsonb);
    if not strict_from_scores then
      v_max_score := greatest(v_max_score, coalesce(v_existing.best_score, 0));
      v_run_count := greatest(v_run_count, coalesce((v_existing.stats->>'runs')::integer, 0));
      v_total_merges := greatest(v_total_merges, coalesce((v_existing.stats->>'merges')::integer, 0));
      v_max_tier := greatest(v_max_tier, coalesce((v_existing.stats->>'bestTier')::integer, 0));
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
  insert into public.guest_profiles (guest_id, best_score, discovered, variants, stats, leaderboard, settings, updated_at, last_seen_at)
  values (target_guest_id, v_max_score, v_discovered, v_variants, v_stats, v_leaderboard, v_settings, now(), now())
  on conflict (guest_id) do update set
    best_score = excluded.best_score, discovered = excluded.discovered, variants = excluded.variants,
    stats = excluded.stats, leaderboard = excluded.leaderboard, settings = excluded.settings, updated_at = excluded.updated_at;
end;
$$;
revoke all on function public.boss_sync_guest_progress_internal(uuid, boolean) from public, anon, authenticated;

-- Replace the previous signatures instead of leaving ambiguous RPC overloads.
drop function if exists public.record_guest_score(uuid, integer, integer, integer, integer, bigint, text);
create or replace function public.record_guest_score(
  p_guest_id uuid,
  p_score integer,
  p_tier_reached integer,
  p_balls_merged integer,
  p_duration_ms integer,
  p_score_id bigint default null,
  p_interruption_reason text default null,
  p_collectibles jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_score integer := greatest(0, coalesce(p_score, 0));
  v_tier integer := greatest(1, least(12, coalesce(p_tier_reached, 1)));
  v_merges integer := greatest(0, coalesce(p_balls_merged, 0));
  v_duration integer := greatest(0, coalesce(p_duration_ms, 0));
  v_collectibles jsonb := public.merge_run_collectibles(null, p_collectibles);
begin
  if p_guest_id is null then raise exception 'guest_id is required'; end if;
  insert into public.guest_profiles (guest_id, best_score, updated_at, last_seen_at)
  values (p_guest_id, v_score, now(), now())
  on conflict (guest_id) do update set last_seen_at = now();

  if p_score_id is not null then
    update public.guest_scores set
      score = greatest(public.guest_scores.score, v_score),
      tier_reached = greatest(public.guest_scores.tier_reached, v_tier),
      balls_merged = greatest(public.guest_scores.balls_merged, v_merges),
      duration_ms = greatest(public.guest_scores.duration_ms, v_duration),
      interruption_reason = coalesce(p_interruption_reason, public.guest_scores.interruption_reason),
      collectibles = public.merge_run_collectibles(public.guest_scores.collectibles, v_collectibles)
    where id = p_score_id and guest_id = p_guest_id returning id into v_id;
  end if;
  if v_id is null then
    insert into public.guest_scores (guest_id, score, tier_reached, balls_merged, duration_ms, interruption_reason, collectibles)
    values (p_guest_id, v_score, v_tier, v_merges, v_duration, p_interruption_reason, v_collectibles)
    returning id into v_id;
  end if;
  perform public.boss_sync_guest_progress_internal(p_guest_id, false);
  return v_id;
end;
$$;
revoke all on function public.record_guest_score(uuid, integer, integer, integer, integer, bigint, text, jsonb) from public;
grant execute on function public.record_guest_score(uuid, integer, integer, integer, integer, bigint, text, jsonb) to anon, authenticated;

drop function if exists public.record_user_score(integer, integer, integer, integer, bigint, text);
create or replace function public.record_user_score(
  p_score integer,
  p_tier_reached integer,
  p_balls_merged integer,
  p_duration_ms integer,
  p_score_id bigint default null,
  p_interruption_reason text default null,
  p_collectibles jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id bigint;
  v_score integer := greatest(0, coalesce(p_score, 0));
  v_tier integer := greatest(1, least(12, coalesce(p_tier_reached, 1)));
  v_merges integer := greatest(0, coalesce(p_balls_merged, 0));
  v_duration integer := greatest(0, coalesce(p_duration_ms, 0));
  v_collectibles jsonb := public.merge_run_collectibles(null, p_collectibles);
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_score_id is not null then
    update public.scores set
      score = greatest(public.scores.score, v_score),
      tier_reached = greatest(public.scores.tier_reached, v_tier),
      balls_merged = greatest(public.scores.balls_merged, v_merges),
      duration_ms = greatest(public.scores.duration_ms, v_duration),
      interruption_reason = coalesce(p_interruption_reason, public.scores.interruption_reason),
      collectibles = public.merge_run_collectibles(public.scores.collectibles, v_collectibles)
    where id = p_score_id and user_id = v_uid returning id into v_id;
  end if;
  if v_id is null then
    insert into public.scores (user_id, score, tier_reached, balls_merged, duration_ms, interruption_reason, collectibles)
    values (v_uid, v_score, v_tier, v_merges, v_duration, p_interruption_reason, v_collectibles)
    returning id into v_id;
  end if;
  perform public.boss_sync_user_progress_internal(v_uid, false);
  return v_id;
end;
$$;
revoke all on function public.record_user_score(integer, integer, integer, integer, bigint, text, jsonb) from public, anon;
grant execute on function public.record_user_score(integer, integer, integer, integer, bigint, text, jsonb) to authenticated;

-- Converted runs retain the exact nullable snapshot and interruption reason.
create or replace function public.link_guest_to_user(p_guest_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or p_guest_id is null then return; end if;
  update public.guest_profiles set converted_user_id = v_uid,
    converted_at = coalesce(converted_at, now()), updated_at = now(), last_seen_at = now()
  where guest_id = p_guest_id;

  if not exists (select 1 from public.scores where user_id = v_uid) then
    insert into public.scores (user_id, score, tier_reached, balls_merged, duration_ms, created_at, interruption_reason, collectibles)
    select v_uid, gs.score, gs.tier_reached, gs.balls_merged, gs.duration_ms, gs.created_at, gs.interruption_reason, gs.collectibles
    from public.guest_scores gs where gs.guest_id = p_guest_id;
  end if;
  perform public.boss_sync_user_progress_internal(v_uid, false);
end;
$$;
revoke all on function public.link_guest_to_user(uuid) from public, anon;
grant execute on function public.link_guest_to_user(uuid) to authenticated;

-- Existing boss scalar edits never assign collectibles, so snapshots survive.
-- Reset RPCs already delete score rows and clear the lifetime variants maps.
create or replace function public.boss_get_dashboard_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
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
revoke all on function public.boss_get_dashboard_data() from public, anon;
grant execute on function public.boss_get_dashboard_data() to authenticated;
