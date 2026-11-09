-- Authoritative coin revive purchases (25 -> 50 -> 100 -> 200...) and
-- incremental score/coin settlement for revived runs.

alter table public.game_sessions
  add column if not exists revives_used integer not null default 0 check (revives_used >= 0);

create or replace function public.purchase_run_revive(
  p_session_id uuid default null,
  p_expected_revives integer default 0,
  p_coin_revision bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_revives integer := coalesce(p_expected_revives, 0);
  v_settled numeric(20, 1) := 0;
  v_current_coins numeric(12, 1);
  v_current_revision bigint;
  v_current_upgrades jsonb;
  v_cost numeric(12, 1);
  v_next_coins numeric(12, 1);
  v_next_revision bigint;
  v_session public.game_sessions%rowtype;
  v_valid_session_id uuid := null;
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
  if v_revives < 0 or v_revives > 20 then
    raise exception 'Invalid revive count' using errcode = '22023';
  end if;
  if p_coin_revision is not null and p_coin_revision < 0 then
    raise exception 'Invalid coin revision' using errcode = '22023';
  end if;

  insert into public.user_progress (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select up.coins, up.coin_revision, up.upgrades
  into v_current_coins, v_current_revision, v_current_upgrades
  from public.user_progress up
  where up.user_id = v_uid
  for update;

  if not found then
    raise exception 'User progress record not found';
  end if;

  -- Settle any newly completed score rows before checking balance so the wallet
  -- reflects coins earned up to this game-over moment.
  v_settled := public.boss_settle_final_score_coins(v_uid);
  if v_settled > 0 then
    v_current_coins := greatest(0, least(99999999999.9, round(coalesce(v_current_coins, 0) + v_settled, 1)));
    v_current_revision := coalesce(v_current_revision, 0) + 1;
  end if;

  if p_session_id is not null then
    select * into v_session
    from public.game_sessions gs
    where gs.id = p_session_id
    for update;

    if found then
      if v_session.user_id is distinct from v_uid then
        raise exception 'Session does not belong to current user' using errcode = '42501';
      end if;
      if coalesce(v_session.revives_used, 0) <> v_revives then
        raise exception 'Session revive count is stale' using errcode = '22023';
      end if;
      v_valid_session_id := v_session.id;
    end if;
  end if;

  v_cost := round((25 * power(2::numeric, v_revives))::numeric, 1);
  if coalesce(v_current_coins, 0) < v_cost then
    raise exception 'Insufficient coins';
  end if;

  v_next_coins := round(coalesce(v_current_coins, 0) - v_cost, 1);
  v_next_revision := coalesce(v_current_revision, 0) + 1;

  update public.user_progress
  set coins = v_next_coins,
      coin_revision = v_next_revision,
      updated_at = now()
  where user_id = v_uid;

  if v_valid_session_id is not null then
    update public.game_sessions
    set revives_used = v_revives + 1,
        status = 'active',
        ended_at = null
    where id = v_valid_session_id and user_id = v_uid;
  end if;

  insert into public.economy_ledger (user_id, session_id, delta, balance_after, coin_revision, reason)
  values (v_uid, v_valid_session_id, -v_cost, v_next_coins, v_next_revision, 'revive:' || (v_revives + 1)::text);

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
    'revives_used', v_revives + 1,
    'cost', v_cost
  );
end;
$$;
revoke all on function public.purchase_run_revive(uuid, integer, bigint) from public, anon, authenticated;
grant execute on function public.purchase_run_revive(uuid, integer, bigint) to authenticated;

create or replace function public.boss_settle_final_score_coins(target_user_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_target numeric(12, 1);
  v_increment numeric(12, 1);
  v_delta numeric(20, 1) := 0;
begin
  if target_user_id is null then return 0; end if;
  for r in
    select
      s.id,
      s.user_id,
      s.run_id,
      s.score,
      cs.score_id as settled_score_id,
      coalesce(cs.credited_score, 0) as credited_score,
      coalesce(cs.credited_coins, 0) as credited_coins
    from public.scores s
    left join public.coin_settlements cs on cs.score_id = s.id
    where s.user_id = target_user_id
      and s.interruption_reason in ('completed', 'page_hidden', 'page_refresh', 'webkit_crash', 'error')
      and not exists (
        select 1 from public.coin_settlements tomb
        where tomb.user_id = s.user_id and tomb.run_id = s.run_id
          and tomb.run_id is not null and tomb.settled_at is not null
          and tomb.score_id <> s.id
      )
    order by s.id
  loop
    v_target := round(least(2000000, greatest(0, r.score))::numeric / 1000, 1);
    if r.settled_score_id is null then
      insert into public.coin_settlements (
        score_id, user_id, run_id, credited_score, credited_coins, settled_at
      ) values (
        r.id, r.user_id, r.run_id, greatest(0, r.score), v_target, now()
      )
      on conflict do nothing;
      if found then
        v_delta := least(99999999999.9, v_delta + v_target);
      end if;
    elsif v_target > r.credited_coins then
      v_increment := round(v_target - r.credited_coins, 1);
      update public.coin_settlements
      set credited_score = greatest(credited_score, r.score),
          credited_coins = v_target,
          settled_at = now()
      where score_id = r.id and user_id = r.user_id;
      if found and v_increment > 0 then
        v_delta := least(99999999999.9, v_delta + v_increment);
      end if;
    end if;
  end loop;
  return round(v_delta, 1);
end;
$$;
revoke all on function public.boss_settle_final_score_coins(uuid) from public, anon, authenticated;

create or replace function public.record_user_score(
  p_score integer,
  p_tier_reached integer,
  p_balls_merged integer,
  p_duration_ms integer,
  p_score_id bigint default null,
  p_interruption_reason text default null,
  p_collectibles jsonb default null,
  p_run_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id bigint;
  v_existing_id bigint;
  v_score integer := greatest(0, coalesce(p_score, 0));
  v_tier integer := greatest(1, least(12, coalesce(p_tier_reached, 1)));
  v_merges integer := greatest(0, coalesce(p_balls_merged, 0));
  v_duration integer := greatest(0, coalesce(p_duration_ms, 0));
  v_collectibles jsonb := public.merge_run_collectibles(null, p_collectibles);
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_run_id is null then raise exception 'run_id is required'; end if;
  if p_interruption_reason is not null
    and p_interruption_reason not in ('completed', 'page_hidden', 'page_refresh', 'webkit_crash', 'error') then
    raise exception 'Invalid interruption reason' using errcode = '22023';
  end if;

  perform public.validate_run_metrics(v_score, v_tier, v_merges, v_duration);

  if p_score_id is not null then
    update public.scores set
      run_id = p_run_id,
      score = greatest(public.scores.score, v_score),
      tier_reached = greatest(public.scores.tier_reached, v_tier),
      balls_merged = greatest(public.scores.balls_merged, v_merges),
      duration_ms = greatest(public.scores.duration_ms, v_duration),
      interruption_reason = coalesce(p_interruption_reason, public.scores.interruption_reason),
      collectibles = public.merge_run_collectibles(public.scores.collectibles, v_collectibles)
    where id = p_score_id and user_id = v_uid
      and (run_id = p_run_id or run_id is null)
    returning id into v_id;
  end if;

  if v_id is null then
    select s.id into v_existing_id
    from public.scores s
    where s.user_id = v_uid and s.run_id = p_run_id
    for update;
    if v_existing_id is not null then
      update public.scores set
        score = greatest(public.scores.score, v_score),
        tier_reached = greatest(public.scores.tier_reached, v_tier),
        balls_merged = greatest(public.scores.balls_merged, v_merges),
        duration_ms = greatest(public.scores.duration_ms, v_duration),
        interruption_reason = coalesce(p_interruption_reason, public.scores.interruption_reason),
        collectibles = public.merge_run_collectibles(public.scores.collectibles, v_collectibles)
      where id = v_existing_id
      returning id into v_id;
    end if;
  end if;

  if v_id is null then
    insert into public.scores (
      user_id, run_id, score, tier_reached, balls_merged, duration_ms,
      interruption_reason, collectibles
    ) values (
      v_uid, p_run_id, v_score, v_tier, v_merges, v_duration,
      p_interruption_reason, v_collectibles
    )
    on conflict (user_id, run_id) where run_id is not null do update set
      score = greatest(public.scores.score, excluded.score),
      tier_reached = greatest(public.scores.tier_reached, excluded.tier_reached),
      balls_merged = greatest(public.scores.balls_merged, excluded.balls_merged),
      duration_ms = greatest(public.scores.duration_ms, excluded.duration_ms),
      interruption_reason = coalesce(excluded.interruption_reason, public.scores.interruption_reason),
      collectibles = public.merge_run_collectibles(public.scores.collectibles, excluded.collectibles)
    returning id into v_id;
  end if;

  update public.game_sessions
  set
    verified_score = greatest(verified_score, v_score),
    verified_tier = greatest(verified_tier, v_tier),
    verified_merges = greatest(verified_merges, v_merges),
    status = case when p_interruption_reason is not null then 'completed' else status end,
    ended_at = case when p_interruption_reason is not null then coalesce(ended_at, now()) else ended_at end
  where id = p_run_id and user_id = v_uid;

  perform public.boss_sync_user_progress_internal(v_uid, false);
  return v_id;
end;
$$;
revoke all on function public.record_user_score(integer, integer, integer, integer, bigint, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_user_score(integer, integer, integer, integer, bigint, text, jsonb, uuid) to authenticated;
