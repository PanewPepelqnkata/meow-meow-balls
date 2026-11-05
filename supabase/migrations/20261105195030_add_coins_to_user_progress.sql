alter table public.user_progress
  add column if not exists coins numeric(12, 1) not null default 0;
update public.user_progress up
set coins = greatest(0, coalesce((u.raw_user_meta_data->'ballrush_progress'->>'coins')::numeric, 0))
from auth.users u
where u.id = up.user_id and up.coins = 0
  and (u.raw_user_meta_data->'ballrush_progress'->>'coins') ~ '^[0-9]+(\.[0-9]+)?$'
  and coalesce((u.raw_user_meta_data->'ballrush_progress'->>'coins')::numeric, 0) > 0;


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
      when (v_meta_progress->>'coins') ~ '^[0-9]+(\.[0-9]+)?$'
        then greatest(0, (v_meta_progress->>'coins')::numeric)
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
  insert into public.user_progress (user_id, best_score, coins, discovered, variants, stats, leaderboard, settings, updated_at)
  values (target_user_id, v_max_score, v_coins, v_discovered, v_variants, v_stats, v_leaderboard, v_settings, now())
  on conflict (user_id) do update set
    best_score = excluded.best_score, coins = excluded.coins, discovered = excluded.discovered, variants = excluded.variants,
    stats = excluded.stats, leaderboard = excluded.leaderboard, settings = excluded.settings, updated_at = excluded.updated_at;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('ballrush_progress',
    jsonb_build_object('version', 1, 'best', v_max_score, 'coins', v_coins, 'discovered', v_discovered, 'variants', v_variants,
      'stats', v_stats, 'leaderboard', v_leaderboard, 'settings', v_settings, 'updatedAt', v_now_ms))
  where id = target_user_id;
end;
$$;
revoke all on function public.boss_sync_user_progress_internal(uuid, boolean) from public, anon, authenticated;
