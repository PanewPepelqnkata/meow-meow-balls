-- Fix Boss runs & guest telemetry discrepancies:
-- 1. Eliminate runaway leaderboard array growth in sync_user_progress by deduplicating and capping at 10 entries while preserving all wallet/upgrade locks and guards.
-- 2. Update upsert_guest_progress to ignore empty 0-run/0-score bounce payloads and cap guest leaderboard at 10 deduplicated entries.
-- 3. Update link_guest_to_user to copy any unimported guest_scores rows cleanly without duplicating existing runs.
-- 4. Backfill genuinely missing (user_id, score) runs from user_progress.leaderboard into public.scores as completed runs with a 0-coin settlement receipt.
-- 5. Reconcile inflated user_progress.stats.runs and bloated leaderboard arrays against authoritative public.scores, and remove empty unconverted bounce rows from guest_profiles.

-- ============================================================================
-- 1. Update sync_user_progress (preserving all 20261105222811 guards & locks)
-- ============================================================================
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
  v_score_runs integer := 0;
  v_score_merges integer := 0;
  v_score_tier integer := 0;
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

  select count(*)::integer, coalesce(sum(s.balls_merged), 0)::integer, coalesce(max(s.tier_reached), 0)
  into v_score_runs, v_score_merges, v_score_tier
  from public.scores s
  where s.user_id = v_uid;

  v_tier := greatest(
    3,
    v_score_tier,
    least(12, coalesce((v_stats->>'bestTier')::integer, 0))
  );
  v_stats := jsonb_build_object(
    'runs', case when v_score_runs > 0 then v_score_runs else greatest(0, coalesce((v_stats->>'runs')::integer, 0)) end,
    'merges', greatest(v_score_merges, coalesce((v_stats->>'merges')::integer, 0)),
    'bestTier', v_tier
  );

  v_discovered := jsonb_build_object('1', v_now_ms, '2', v_now_ms, '3', v_now_ms) || v_discovered;
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
  else
    v_coins := v_settled;
    v_coin_revision := 0;
    if v_settled > 0 then v_coin_revision := v_coin_revision + 1; end if;
  end if;
  v_coins := greatest(0, least(99999999999.9, round(v_coins, 1)));

  -- Deduplicate by (score, tier) and cap combined leaderboard at top 10 entries
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'score', sub.score,
        'bestTier', sub.tier,
        'at', sub.at
      ) order by sub.score desc, sub.at desc
    ),
    '[]'::jsonb
  ) into v_leaderboard
  from (
    select distinct on (raw_item.score, raw_item.tier)
      raw_item.score,
      raw_item.tier,
      raw_item.at
    from (
      select
        greatest(0, coalesce((elem->>'score')::integer, 0)) as score,
        greatest(1, least(12, coalesce((elem->>'bestTier')::integer, 1))) as tier,
        case
          when (elem->>'at') ~ '^[0-9]+$' then (elem->>'at')::bigint
          else v_now_ms
        end as at
      from jsonb_array_elements(
        case when jsonb_typeof(v_leaderboard) = 'array' then v_leaderboard else '[]'::jsonb end
        ||
        case when v_has_existing and jsonb_typeof(v_existing.leaderboard) = 'array' then v_existing.leaderboard else '[]'::jsonb end
      ) elem
      where coalesce((elem->>'score')::integer, 0) > 0
    ) raw_item
    order by raw_item.score desc, raw_item.tier desc, raw_item.at desc
    limit 10
  ) sub;

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

  return jsonb_build_object(
    'coins', v_coins,
    'coin_revision', v_coin_revision,
    'upgrades', v_upgrades,
    'settled_coins', v_settled
  );
end;
$$;
revoke all on function public.sync_user_progress(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.sync_user_progress(jsonb, bigint) to authenticated;

-- ============================================================================
-- 2. Update upsert_guest_progress: ignore empty bounce payloads
-- ============================================================================
create or replace function public.upsert_guest_progress(
  p_guest_id uuid,
  p_best_score integer,
  p_discovered jsonb default '{}'::jsonb,
  p_variants jsonb default '{}'::jsonb,
  p_stats jsonb default '{"runs": 0, "merges": 0, "bestTier": 0}'::jsonb,
  p_leaderboard jsonb default '[]'::jsonb,
  p_settings jsonb default '{"theme": "auto"}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_runs integer := greatest(0, coalesce((p_stats->>'runs')::integer, 0));
  v_merges integer := greatest(0, coalesce((p_stats->>'merges')::integer, 0));
  v_best_tier integer := greatest(0, least(12, coalesce((p_stats->>'bestTier')::integer, 0)));
  v_best integer := greatest(0, coalesce(p_best_score, 0));
  v_lb_len integer := case when jsonb_typeof(p_leaderboard) = 'array' then jsonb_array_length(p_leaderboard) else 0 end;
begin
  if p_guest_id is null then
    return;
  end if;

  -- Do not create empty guest_profiles rows for visitors who have not played
  if v_best = 0 and v_runs = 0 and v_merges = 0 and v_lb_len = 0
     and not exists (select 1 from public.guest_profiles where guest_id = p_guest_id)
     and not exists (select 1 from public.guest_scores where guest_id = p_guest_id) then
    return;
  end if;

  insert into public.guest_profiles (
    guest_id,
    best_score,
    discovered,
    variants,
    stats,
    leaderboard,
    settings,
    updated_at,
    last_seen_at
  )
  values (
    p_guest_id,
    v_best,
    coalesce(p_discovered, '{}'::jsonb),
    coalesce(p_variants, '{}'::jsonb),
    jsonb_build_object('runs', v_runs, 'merges', v_merges, 'bestTier', v_best_tier),
    coalesce(p_leaderboard, '[]'::jsonb),
    coalesce(p_settings, '{"theme": "auto"}'::jsonb),
    now(),
    now()
  )
  on conflict (guest_id) do update set
    best_score = greatest(public.guest_profiles.best_score, excluded.best_score),
    discovered = public.guest_profiles.discovered || excluded.discovered,
    variants = public.guest_profiles.variants || excluded.variants,
    stats = jsonb_build_object(
      'runs', greatest(coalesce((public.guest_profiles.stats->>'runs')::integer, 0), v_runs),
      'merges', greatest(coalesce((public.guest_profiles.stats->>'merges')::integer, 0), v_merges),
      'bestTier', greatest(coalesce((public.guest_profiles.stats->>'bestTier')::integer, 0), v_best_tier)
    ),
    leaderboard = case
      when jsonb_typeof(excluded.leaderboard) = 'array' and jsonb_array_length(excluded.leaderboard) > 0 then excluded.leaderboard
      else public.guest_profiles.leaderboard
    end,
    settings = excluded.settings,
    updated_at = now(),
    last_seen_at = now();

  -- Backfill historical local leaderboard runs if guest_scores has no rows for this guest yet
  if v_lb_len > 0 then
    if not exists (select 1 from public.guest_scores where guest_id = p_guest_id) then
      insert into public.guest_scores (guest_id, score, tier_reached, balls_merged, duration_ms, created_at)
      select distinct on (score, tier_reached)
        p_guest_id,
        score,
        tier_reached,
        0,
        0,
        to_timestamp(at_ms / 1000.0)
      from (
        select
          greatest(0, coalesce((item->>'score')::integer, 0)) as score,
          greatest(1, least(12, coalesce((item->>'bestTier')::integer, 1))) as tier_reached,
          case
            when (item->>'at') is not null and (item->>'at') ~ '^[0-9]+$' then (item->>'at')::bigint
            else (extract(epoch from now()) * 1000)::bigint
          end as at_ms
        from jsonb_array_elements(p_leaderboard) as item
        where coalesce((item->>'score')::integer, 0) > 0
      ) raw_lb
      order by score desc, tier_reached desc, at_ms desc;
    end if;
  end if;

  perform public.boss_sync_guest_progress_internal(p_guest_id, false);
end;
$$;
grant execute on function public.upsert_guest_progress(uuid, integer, jsonb, jsonb, jsonb, jsonb, jsonb) to anon, authenticated;

-- ============================================================================
-- 3. Update link_guest_to_user: copy any unimported guest runs cleanly
-- ============================================================================
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

  update public.guest_profiles set
    converted_user_id = v_uid,
    converted_at = coalesce(converted_at, now()),
    updated_at = now(),
    last_seen_at = now()
  where guest_id = p_guest_id;

  insert into public.scores (
    user_id, run_id, score, tier_reached, balls_merged, duration_ms,
    created_at, interruption_reason, collectibles
  )
  select
    v_uid, gs.run_id, gs.score, gs.tier_reached, gs.balls_merged,
    gs.duration_ms, gs.created_at, gs.interruption_reason, gs.collectibles
  from public.guest_scores gs
  where gs.guest_id = p_guest_id
    and not exists (
      select 1 from public.scores s
      where s.user_id = v_uid
        and (
          (s.run_id is not null and s.run_id = gs.run_id)
          or (s.score = gs.score and abs(extract(epoch from (s.created_at - gs.created_at))) < 5)
        )
    );

  perform public.boss_sync_user_progress_internal(v_uid, false);
end;
$$;
revoke all on function public.link_guest_to_user(uuid) from public, anon, authenticated;
grant execute on function public.link_guest_to_user(uuid) to authenticated;

-- ============================================================================
-- 4. Backfill genuinely missing (user_id, score) entries from leaderboard,
--    marked 'completed' with a 0-coin settlement receipt so they neither show
--    as live runs nor mint unintended coins.
-- ============================================================================
with inserted_scores as (
  insert into public.scores (
    user_id,
    score,
    tier_reached,
    balls_merged,
    duration_ms,
    created_at,
    interruption_reason
  )
  select
    dedup.user_id,
    dedup.score,
    dedup.tier_reached,
    0,
    0,
    to_timestamp(dedup.at_ms / 1000.0),
    'completed'
  from (
    select distinct on (up.user_id, greatest(0, coalesce((item->>'score')::integer, 0)))
      up.user_id,
      greatest(0, coalesce((item->>'score')::integer, 0)) as score,
      greatest(1, least(12, coalesce((item->>'bestTier')::integer, 1))) as tier_reached,
      case
        when (item->>'at') ~ '^[0-9]+$' then (item->>'at')::bigint
        else (extract(epoch from coalesce(up.updated_at, now())) * 1000)::bigint
      end as at_ms
    from public.user_progress up,
         jsonb_array_elements(case when jsonb_typeof(up.leaderboard) = 'array' then up.leaderboard else '[]'::jsonb end) as item
    where coalesce((item->>'score')::integer, 0) > 0
    order by
      up.user_id,
      greatest(0, coalesce((item->>'score')::integer, 0)) desc,
      greatest(1, least(12, coalesce((item->>'bestTier')::integer, 1))) desc,
      case
        when (item->>'at') ~ '^[0-9]+$' then (item->>'at')::bigint
        else 0
      end desc
  ) dedup
  where not exists (
    select 1 from public.scores s
    where s.user_id = dedup.user_id
      and s.score = dedup.score
  )
  returning id, user_id, run_id, score
)
insert into public.coin_settlements (
  score_id, user_id, run_id, credited_score, credited_coins, settled_at
)
select
  id, user_id, run_id, greatest(0, score), 0, now()
from inserted_scores
on conflict do nothing;

-- ============================================================================
-- 5. Reset inflated stats.runs to actual scores count before syncing progress,
--    and remove empty unconverted bounce rows from guest_profiles
-- ============================================================================
update public.user_progress up
set stats = jsonb_set(
  coalesce(up.stats, '{"runs":0,"merges":0,"bestTier":0}'::jsonb),
  '{runs}',
  to_jsonb((select count(*)::integer from public.scores s where s.user_id = up.user_id)),
  true
);

do $$
declare
  r record;
begin
  for r in select distinct id from auth.users loop
    perform public.boss_sync_user_progress_internal(r.id, false);
  end loop;
end;
$$;

delete from public.guest_profiles gp
where gp.converted_user_id is null
  and coalesce(gp.best_score, 0) = 0
  and coalesce((gp.stats->>'runs')::integer, 0) = 0
  and coalesce((gp.stats->>'merges')::integer, 0) = 0
  and not exists (select 1 from public.guest_scores gs where gs.guest_id = gp.guest_id);
