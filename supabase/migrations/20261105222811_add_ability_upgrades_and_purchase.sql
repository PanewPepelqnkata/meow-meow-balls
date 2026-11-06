-- Authoritative ability upgrades and registered-only purchases.
--
-- The client may display and persist the returned upgrade map, but only this
-- function can advance a level.  Coins and upgrades remain canonical in
-- public.user_progress; user_metadata is a cache and is never an authority.

alter table public.user_progress
  add column if not exists upgrades jsonb not null
    default '{"wallDuration":0,"shakeDuration":0,"shakeIntensity":0}'::jsonb;

-- This column did not exist before this migration.  The normalization also
-- makes a partially-applied/manual schema safe before the constraint below.
update public.user_progress
set upgrades = '{"wallDuration":0,"shakeDuration":0,"shakeIntensity":0}'::jsonb
where upgrades is null
   or jsonb_typeof(upgrades) <> 'object'
   or coalesce(jsonb_typeof(upgrades->'wallDuration'), '') <> 'number'
   or coalesce(jsonb_typeof(upgrades->'shakeDuration'), '') <> 'number'
   or coalesce(jsonb_typeof(upgrades->'shakeIntensity'), '') <> 'number'
   or coalesce(upgrades->>'wallDuration', '') !~ '^(0|[1-9]|10)$'
   or coalesce(upgrades->>'shakeDuration', '') !~ '^(0|[1-9]|10)$'
   or coalesce(upgrades->>'shakeIntensity', '') !~ '^(0|[1-5])$'
   or case when jsonb_typeof(upgrades) = 'object'
      then upgrades - array['wallDuration', 'shakeDuration', 'shakeIntensity'] <> '{}'::jsonb
      else false end;

alter table public.user_progress
  alter column upgrades set default '{"wallDuration":0,"shakeDuration":0,"shakeIntensity":0}'::jsonb,
  alter column upgrades set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_progress'::regclass
      and conname = 'user_progress_upgrades_shape_check'
  ) then
    alter table public.user_progress
      add constraint user_progress_upgrades_shape_check check (
        upgrades is not null
        and jsonb_typeof(upgrades) = 'object'
        and upgrades ?& array['wallDuration', 'shakeDuration', 'shakeIntensity']
        and case when jsonb_typeof(upgrades) = 'object'
          then upgrades - array['wallDuration', 'shakeDuration', 'shakeIntensity'] = '{}'::jsonb
          else false end
        and jsonb_typeof(upgrades->'wallDuration') = 'number'
        and jsonb_typeof(upgrades->'shakeDuration') = 'number'
        and jsonb_typeof(upgrades->'shakeIntensity') = 'number'
        and coalesce(upgrades->>'wallDuration', '') ~ '^(0|[1-9]|10)$'
        and coalesce(upgrades->>'shakeDuration', '') ~ '^(0|[1-9]|10)$'
        and coalesce(upgrades->>'shakeIntensity', '') ~ '^(0|[1-5])$'
      );
  end if;
end;
$$;

-- Every registered run has a client-generated UUID that is reused for all
-- live/final submissions.  The UUID is an idempotency key, not an earning
-- amount; the server still owns score normalization and settlement.
alter table public.scores
  add column if not exists run_id uuid;
create unique index if not exists scores_user_run_id_unique
  on public.scores (user_id, run_id)
  where run_id is not null;

alter table public.guest_scores
  add column if not exists run_id uuid;
create unique index if not exists guest_scores_guest_run_id_unique
  on public.guest_scores (guest_id, run_id)
  where run_id is not null;

-- Final score settlements are durable receipts.  They deliberately do not
-- reference scores with a foreign key: deleting a score must not make the
-- same identity payable again, and the receipt remains an audit record.
create table if not exists public.coin_settlements (
  score_id bigint primary key,
  user_id uuid not null,
  run_id uuid,
  credited_score integer not null default 0,
  credited_coins numeric(12, 1) not null default 0,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint coin_settlements_score_check check (credited_score >= 0),
  constraint coin_settlements_coins_check check (credited_coins >= 0 and credited_coins <= 99999999999.9)
);
alter table public.coin_settlements add column if not exists run_id uuid;
update public.coin_settlements cs
set run_id = s.run_id
from public.scores s
where s.id = cs.score_id and cs.run_id is null;
create unique index if not exists coin_settlements_user_run_unique
  on public.coin_settlements (user_id, run_id)
  where run_id is not null;
alter table public.coin_settlements enable row level security;
revoke all on table public.coin_settlements from public, anon, authenticated;

-- Existing scores have already been represented by the legacy coin balance.
-- Baseline every known id, including NULL-reason live snapshots, so a legacy
-- pending run cannot be paid again after this migration's final marker.
insert into public.coin_settlements (score_id, user_id, run_id, credited_score, credited_coins, settled_at)
select s.id, s.user_id, s.run_id, greatest(0, s.score), 0, now()
from public.scores s
on conflict (score_id) do nothing;

-- Credit only an explicit final marker.  A score receipt is immutable after
-- settlement, so repeated finalization or later admin score edits cannot pay
-- again.  The caller must already serialize on user_progress when this helper
-- is used from a progress synchronizer.
create or replace function public.boss_settle_final_score_coins(target_user_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_target numeric(12, 1);
  v_inserted_score_id bigint;
  v_delta numeric(20, 1) := 0;
begin
  if target_user_id is null then return 0; end if;
  for r in
    select s.id, s.user_id, s.run_id, s.score, coalesce(cs.credited_coins, 0) as credited_coins
    from public.scores s
    left join public.coin_settlements cs on cs.score_id = s.id
    where s.user_id = target_user_id
      and s.interruption_reason in ('completed', 'page_hidden', 'page_refresh', 'webkit_crash', 'error')
      and (cs.score_id is null or cs.settled_at is null)
      and not exists (
        select 1 from public.coin_settlements tomb
        where tomb.user_id = s.user_id and tomb.run_id = s.run_id
          and tomb.run_id is not null and tomb.settled_at is not null
          and tomb.score_id <> s.id
      )
    order by s.id
  loop
    v_target := round(greatest(0, r.score)::numeric / 1000, 1);
    insert into public.coin_settlements (
      score_id, user_id, run_id, credited_score, credited_coins, settled_at
    ) values (
      r.id, r.user_id, r.run_id, greatest(0, r.score), v_target, now()
    )
    on conflict do nothing
    returning score_id into v_inserted_score_id;
    if found then
      v_delta := least(99999999999.9, v_delta + v_target);
    end if;
  end loop;
  return round(v_delta, 1);
end;
$$;
revoke all on function public.boss_settle_final_score_coins(uuid) from public, anon, authenticated;


-- The old policies allowed an authenticated client to update every column in
-- its own row.  All progress writes already go through SECURITY DEFINER RPCs;
-- remove table write privileges and leave only the authenticated own-row read.
revoke all on table public.user_progress from public, anon, authenticated;
grant select on table public.user_progress to authenticated;
drop policy if exists "Authenticated users can view all progress" on public.user_progress;
drop policy if exists "Users can view own progress" on public.user_progress;
drop policy if exists "Users can insert own progress" on public.user_progress;
drop policy if exists "Users can update own progress" on public.user_progress;

-- Score rows are settlement receipts and must be created only by the guarded
-- RPCs below.  Direct authenticated inserts could otherwise mark a forged
-- row final and let sync settle it.  Leaderboard reads remain public.
revoke all on table public.scores from public, anon, authenticated;
grant select on table public.scores to anon, authenticated;
drop policy if exists "Users can insert their own scores" on public.scores;
revoke all on table public.guest_scores from public, anon, authenticated;
create policy "Users can view own progress"
  on public.user_progress for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Rebuild the internal aggregate synchronizer so a user-editable metadata
-- object can never initialize authoritative coins, revisions, or upgrades.
-- Non-currency legacy progress in metadata remains importable for accounts
-- that predate user_progress, preserving the existing score/collection path.
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
    -- These three values are authoritative in user_progress.  In particular,
    -- do not fall back to raw_user_meta_data, which the user can edit.
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
    -- Legacy non-currency progress can still be recovered on first materialize.
    -- Never import coins, coinRevision, or upgrades from metadata.
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

  -- Keep the legacy cache coherent, but never include upgrades in it.  A
  -- client may edit raw_user_meta_data; hydration must read upgrades from the
  -- table only.
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
end;
$$;
revoke all on function public.boss_sync_user_progress_internal(uuid, boolean) from public, anon, authenticated;

-- Keep the admin coin path compatible while removing any user-edited upgrade
-- cache from metadata.  The authoritative row is still locked and revised.
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
  if amount is null or amount < 0 or amount > 99999999999.9
    or amount::text in ('NaN', 'Infinity', '-Infinity') then
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

  v_current := coalesce(v_current, 0);
  v_coin_revision := coalesce(v_coin_revision, 0);
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

  select raw_user_meta_data->'ballrush_progress'
  into v_meta
  from auth.users
  where id = target_user_id;
  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'ballrush_progress',
    ((case when jsonb_typeof(v_meta) = 'object' then v_meta else '{}'::jsonb end)
      || jsonb_build_object('coins', v_next, 'coinRevision', v_coin_revision))
      - 'upgrades'
  )
  where id = target_user_id;
  return v_next;
end;
$$;
revoke all on function public.boss_update_user_coins(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.boss_update_user_coins(uuid, text, numeric) to authenticated;

-- Admin profile edits must not overwrite a concurrently-earned/purchased
-- balance.  Lock the row and leave coins, coin_revision, and upgrades out of
-- the ON CONFLICT update set.
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

  select
    coalesce(up.coins, 0),
    coalesce(up.coin_revision, 0),
    coalesce(up.discovered, v_discovered),
    coalesce(up.variants, '{}'::jsonb),
    coalesce(up.leaderboard, '[]'::jsonb),
    coalesce(up.settings, '{"theme": "auto"}'::jsonb)
  into v_coins, v_coin_revision, v_discovered, v_variants, v_leaderboard, v_settings
  from public.user_progress up
  where up.user_id = target_user_id
  for update;

  v_coins := coalesce(v_coins, 0);
  v_coin_revision := coalesce(v_coin_revision, 0);
  v_variants := coalesce(v_variants, '{}'::jsonb);
  v_leaderboard := coalesce(v_leaderboard, '[]'::jsonb);
  v_settings := coalesce(v_settings, '{"theme": "auto"}'::jsonb);

  update public.profiles
  set
    username = coalesce(nullif(btrim(new_username), ''), username),
    display_name = coalesce(nullif(btrim(new_display_name), ''), display_name),
    updated_at = now()
  where id = target_user_id;

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
    user_id, best_score, coins, coin_revision, discovered, variants,
    stats, leaderboard, settings, updated_at
  )
  values (
    target_user_id, greatest(0, coalesce(new_best_score, 0)),
    greatest(0, least(99999999999.9, v_coins)), v_coin_revision,
    v_discovered, v_variants, v_stats, v_leaderboard, v_settings, now()
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

-- Progress sync never accepts a client-selected earning amount.  The old
-- three-argument overload is removed so stale callers cannot mint currency.
drop function if exists public.sync_user_progress(jsonb, numeric, bigint);
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
    -- The row is authoritative whether this transaction inserted it or a
    -- concurrent purchase/sync won the unique-key race.
    v_has_existing := true;
  end if;

  -- This is the only currency earning path for account sync.  It is keyed by
  -- authenticated scores with an explicit final reason and a unique receipt.
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
    -- Revision is server-owned; the argument is retained only for the
    -- coordinated client contract and is never used to advance the wallet.
    v_coin_revision := coalesce(v_existing.coin_revision, 0);
    v_upgrades := coalesce(v_existing.upgrades, v_upgrades);
    if v_settled > 0 then v_coin_revision := v_coin_revision + 1; end if;
    v_best := greatest(v_best, coalesce(v_existing.best_score, 0));
    v_discovered := v_discovered || coalesce(v_existing.discovered, '{}'::jsonb);
    v_variants := v_variants || coalesce(v_existing.variants, '{}'::jsonb);
    v_leaderboard := v_leaderboard || coalesce(v_existing.leaderboard, '[]'::jsonb);
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

create or replace function public.purchase_ability_upgrade(
  p_upgrade text,
  p_expected_level integer,
  p_coin_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_upgrade text := btrim(coalesce(p_upgrade, ''));
  v_current_coins numeric(12, 1);
  v_current_revision bigint;
  v_current_upgrades jsonb;
  v_current_level integer;
  v_next_level integer;
  v_max_level integer;
  v_cost numeric(12, 1);
  v_next_coins numeric(12, 1);
  v_next_revision bigint;
  v_next_upgrades jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
  -- Supabase anonymous users use the authenticated database role but carry a
  -- signed is_anonymous JWT claim.  They must not buy persistent upgrades.
  if (select auth.jwt()->>'is_anonymous') = 'true' then
    raise exception 'Registered account required' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid) then
    raise exception 'Registered account required' using errcode = '42501';
  end if;
  if v_upgrade not in ('wallDuration', 'shakeDuration', 'shakeIntensity') then
    raise exception 'Unknown ability upgrade';
  end if;
  if p_expected_level is null or p_expected_level < 0 or p_expected_level > 10 then
    raise exception 'Invalid expected upgrade level';
  end if;
  if p_coin_revision is null or p_coin_revision < 0 then
    raise exception 'Invalid coin revision';
  end if;

  -- Materialize a registered account's default row if its legacy progress has
  -- not been synced yet; the row is locked immediately afterward.  No coins
  -- or upgrades are imported from metadata.
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
  if p_coin_revision <> v_current_revision then
    raise exception 'Coin revision is stale';
  end if;

  v_current_level := (v_current_upgrades->>v_upgrade)::integer;
  v_max_level := case when v_upgrade = 'shakeIntensity' then 5 else 10 end;
  if p_expected_level <> v_current_level then
    raise exception 'Upgrade level is stale';
  end if;
  if v_current_level >= v_max_level then
    raise exception 'Upgrade is fully upgraded';
  end if;

  v_next_level := v_current_level + 1;
  v_cost := case when v_upgrade = 'shakeIntensity'
    then 20 * v_next_level
    else 10 * v_next_level
  end;
  if coalesce(v_current_coins, 0) < v_cost then
    raise exception 'Insufficient coins';
  end if;

  v_next_coins := round(coalesce(v_current_coins, 0) - v_cost, 1);
  v_next_revision := v_current_revision + 1;
  v_next_upgrades := jsonb_set(
    v_current_upgrades,
    array[v_upgrade],
    to_jsonb(v_next_level),
    false
  );

  update public.user_progress
  set coins = v_next_coins,
      coin_revision = v_next_revision,
      upgrades = v_next_upgrades,
      updated_at = now()
  where user_id = v_uid;

  -- Metadata is only a compatibility cache.  Mirror currency for old clients,
  -- but explicitly remove any user-supplied upgrade cache.
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
    'upgrades', v_next_upgrades
  );
end;
$$;
revoke all on function public.purchase_ability_upgrade(text, integer, bigint) from public, anon, authenticated;
grant execute on function public.purchase_ability_upgrade(text, integer, bigint) to authenticated;

-- A run UUID is required for every new score receipt.  Replays after a lost
-- response update the existing row instead of creating another payable run.
drop function if exists public.record_user_score(integer, integer, integer, integer, bigint, text, jsonb);
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
  v_receipt_settled boolean := false;
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

  if p_score_id is not null then
    select exists (
      select 1 from public.coin_settlements cs
      where cs.score_id = p_score_id and cs.user_id = v_uid and cs.settled_at is not null
    ) into v_receipt_settled;
    if v_receipt_settled then
      select s.id into v_id from public.scores s
      where s.id = p_score_id and s.user_id = v_uid;
    end if;
  end if;
  if p_score_id is not null and v_id is null then
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
      and not exists (
        select 1 from public.coin_settlements cs
        where cs.score_id = public.scores.id and cs.settled_at is not null
      )
    returning id into v_id;
  end if;

  if v_id is null then
    select s.id into v_existing_id
    from public.scores s
    where s.user_id = v_uid and s.run_id = p_run_id
    for update;
    if v_existing_id is not null then
      select exists (
        select 1 from public.coin_settlements cs
        where cs.score_id = v_existing_id and cs.user_id = v_uid and cs.settled_at is not null
      ) into v_receipt_settled;
      if v_receipt_settled then
        v_id := v_existing_id;
      else
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
    where not exists (
      select 1 from public.coin_settlements cs
      where cs.score_id = public.scores.id and cs.settled_at is not null
    )
    returning id into v_id;
  if v_id is null then
    select s.id into v_id from public.scores s
    where s.user_id = v_uid and s.run_id = p_run_id;
  end if;
  end if;
  perform public.boss_sync_user_progress_internal(v_uid, false);
  return v_id;
end;
$$;
revoke all on function public.record_user_score(integer, integer, integer, integer, bigint, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_user_score(integer, integer, integer, integer, bigint, text, jsonb, uuid) to authenticated;

drop function if exists public.record_guest_score(uuid, integer, integer, integer, integer, bigint, text, jsonb);
create or replace function public.record_guest_score(
  p_guest_id uuid,
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
  v_id bigint;
  v_existing_id bigint;
  v_score integer := greatest(0, coalesce(p_score, 0));
  v_tier integer := greatest(1, least(12, coalesce(p_tier_reached, 1)));
  v_merges integer := greatest(0, coalesce(p_balls_merged, 0));
  v_duration integer := greatest(0, coalesce(p_duration_ms, 0));
  v_collectibles jsonb := public.merge_run_collectibles(null, p_collectibles);
begin
  if p_guest_id is null then raise exception 'guest_id is required'; end if;
  if p_run_id is null then raise exception 'run_id is required'; end if;
  if p_interruption_reason is not null
    and p_interruption_reason not in ('completed', 'page_hidden', 'page_refresh', 'webkit_crash', 'error') then
    raise exception 'Invalid interruption reason' using errcode = '22023';
  end if;
  insert into public.guest_profiles (guest_id, best_score, updated_at, last_seen_at)
  values (p_guest_id, v_score, now(), now())
  on conflict (guest_id) do update set last_seen_at = now();

  if p_score_id is not null then
    update public.guest_scores set
      run_id = p_run_id,
      score = greatest(public.guest_scores.score, v_score),
      tier_reached = greatest(public.guest_scores.tier_reached, v_tier),
      balls_merged = greatest(public.guest_scores.balls_merged, v_merges),
      duration_ms = greatest(public.guest_scores.duration_ms, v_duration),
      interruption_reason = coalesce(p_interruption_reason, public.guest_scores.interruption_reason),
      collectibles = public.merge_run_collectibles(public.guest_scores.collectibles, v_collectibles)
    where id = p_score_id and guest_id = p_guest_id
      and (run_id = p_run_id or run_id is null)
    returning id into v_id;
  end if;
  if v_id is null then
    select gs.id into v_existing_id
    from public.guest_scores gs
    where gs.guest_id = p_guest_id and gs.run_id = p_run_id
    for update;
    if v_existing_id is not null then
      update public.guest_scores set
        score = greatest(public.guest_scores.score, v_score),
        tier_reached = greatest(public.guest_scores.tier_reached, v_tier),
        balls_merged = greatest(public.guest_scores.balls_merged, v_merges),
        duration_ms = greatest(public.guest_scores.duration_ms, v_duration),
        interruption_reason = coalesce(p_interruption_reason, public.guest_scores.interruption_reason),
        collectibles = public.merge_run_collectibles(public.guest_scores.collectibles, v_collectibles)
      where id = v_existing_id
      returning id into v_id;
    end if;
  end if;
  if v_id is null then
    insert into public.guest_scores (
      guest_id, run_id, score, tier_reached, balls_merged, duration_ms,
      interruption_reason, collectibles
    ) values (
      p_guest_id, p_run_id, v_score, v_tier, v_merges, v_duration,
      p_interruption_reason, v_collectibles
    )
    on conflict (guest_id, run_id) where run_id is not null do update set
      score = greatest(public.guest_scores.score, excluded.score),
      tier_reached = greatest(public.guest_scores.tier_reached, excluded.tier_reached),
      balls_merged = greatest(public.guest_scores.balls_merged, excluded.balls_merged),
      duration_ms = greatest(public.guest_scores.duration_ms, excluded.duration_ms),
      interruption_reason = coalesce(excluded.interruption_reason, public.guest_scores.interruption_reason),
      collectibles = public.merge_run_collectibles(public.guest_scores.collectibles, excluded.collectibles)
    returning id into v_id;
  end if;
  perform public.boss_sync_guest_progress_internal(p_guest_id, false);
  return v_id;
end;
$$;
revoke all on function public.record_guest_score(uuid, integer, integer, integer, integer, bigint, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_guest_score(uuid, integer, integer, integer, integer, bigint, text, jsonb, uuid) to anon, authenticated;

-- Guest conversion keeps run identities so a post-signup duplicate final call
-- resolves to the imported score row rather than creating another receipt.
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
    insert into public.scores (
      user_id, run_id, score, tier_reached, balls_merged, duration_ms,
      created_at, interruption_reason, collectibles
    )
    select v_uid, gs.run_id, gs.score, gs.tier_reached, gs.balls_merged,
      gs.duration_ms, gs.created_at, gs.interruption_reason, gs.collectibles
    from public.guest_scores gs
    where gs.guest_id = p_guest_id;
  end if;
  perform public.boss_sync_user_progress_internal(v_uid, false);
end;
$$;
revoke all on function public.link_guest_to_user(uuid) from public, anon, authenticated;
grant execute on function public.link_guest_to_user(uuid) to authenticated;
