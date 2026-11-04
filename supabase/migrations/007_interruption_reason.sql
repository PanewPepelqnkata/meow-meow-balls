-- Add interruption_reason tracking to runs
-- Tracks why a run ended: 'completed', 'refresh', 'crash', 'webkit_crash', etc.

-- 1. Add column to guest_scores
alter table public.guest_scores
  add column if not exists interruption_reason text;

-- 2. Add column to scores
alter table public.scores
  add column if not exists interruption_reason text;

-- 3. Update record_guest_score to accept interruption_reason
drop function if exists public.record_guest_score(uuid, integer, integer, integer, integer, bigint);

create or replace function public.record_guest_score(
  p_guest_id uuid,
  p_score integer,
  p_tier_reached integer,
  p_balls_merged integer,
  p_duration_ms integer,
  p_score_id bigint default null,
  p_interruption_reason text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_score integer := greatest(0, coalesce(p_score, 0));
  v_tier integer := greatest(1, least(12, coalesce(p_tier_reached, 1)));
  v_merges integer := greatest(0, coalesce(p_balls_merged, 0));
  v_duration integer := greatest(0, coalesce(p_duration_ms, 0));
begin
  if p_guest_id is null then
    raise exception 'guest_id is required';
  end if;

  insert into public.guest_profiles (guest_id, best_score, updated_at, last_seen_at)
  values (p_guest_id, v_score, now(), now())
  on conflict (guest_id) do update set
    last_seen_at = now();

  if p_score_id is not null then
    update public.guest_scores
    set
      score = greatest(public.guest_scores.score, v_score),
      tier_reached = greatest(public.guest_scores.tier_reached, v_tier),
      balls_merged = greatest(public.guest_scores.balls_merged, v_merges),
      duration_ms = greatest(public.guest_scores.duration_ms, v_duration),
      interruption_reason = coalesce(p_interruption_reason, public.guest_scores.interruption_reason)
    where id = p_score_id and guest_id = p_guest_id
    returning id into v_id;
  end if;

  if v_id is null then
    insert into public.guest_scores (
      guest_id,
      score,
      tier_reached,
      balls_merged,
      duration_ms,
      interruption_reason
    )
    values (
      p_guest_id,
      v_score,
      v_tier,
      v_merges,
      v_duration,
      p_interruption_reason
    )
    returning id into v_id;
  end if;

  perform public.boss_sync_guest_progress_internal(p_guest_id, false);
  return v_id;
end;
$$;

grant execute on function public.record_guest_score(uuid, integer, integer, integer, integer, bigint, text) to anon, authenticated;

-- 4. Update record_user_score to accept interruption_reason
drop function if exists public.record_user_score(integer, integer, integer, integer, bigint);

create or replace function public.record_user_score(
  p_score integer,
  p_tier_reached integer,
  p_balls_merged integer,
  p_duration_ms integer,
  p_score_id bigint default null,
  p_interruption_reason text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id bigint;
  v_score integer := greatest(0, coalesce(p_score, 0));
  v_tier integer := greatest(1, least(12, coalesce(p_tier_reached, 1)));
  v_merges integer := greatest(0, coalesce(p_balls_merged, 0));
  v_duration integer := greatest(0, coalesce(p_duration_ms, 0));
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if p_score_id is not null then
    update public.scores
    set
      score = greatest(public.scores.score, v_score),
      tier_reached = greatest(public.scores.tier_reached, v_tier),
      balls_merged = greatest(public.scores.balls_merged, v_merges),
      duration_ms = greatest(public.scores.duration_ms, v_duration),
      interruption_reason = coalesce(p_interruption_reason, public.scores.interruption_reason)
    where id = p_score_id and user_id = v_uid
    returning id into v_id;
  end if;

  if v_id is null then
    insert into public.scores (
      user_id,
      score,
      tier_reached,
      balls_merged,
      duration_ms,
      interruption_reason
    )
    values (
      v_uid,
      v_score,
      v_tier,
      v_merges,
      v_duration,
      p_interruption_reason
    )
    returning id into v_id;
  end if;

  perform public.boss_sync_user_progress_internal(v_uid, false);
  return v_id;
end;
$$;

revoke all on function public.record_user_score(integer, integer, integer, integer, bigint, text) from public, anon;
grant execute on function public.record_user_score(integer, integer, integer, integer, bigint, text) to authenticated;
