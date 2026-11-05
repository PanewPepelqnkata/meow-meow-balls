-- Persist boss dashboard coin edits in both cloud progress stores.
-- The existing /boss RPCs use the project's authenticated-session gate; no separate
-- admin role exists in the current auth schema, so this follows that established
-- security-definer pattern rather than allowing client-direct writes.
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
  v_uid uuid := (select auth.uid());
  v_current numeric(12, 1);
  v_amount numeric(12, 1);
  v_next numeric(12, 1);
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
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

  select up.coins
  into v_current
  from public.user_progress up
  where up.user_id = target_user_id
  for update;

  if not found then
    perform public.boss_sync_user_progress_internal(target_user_id, false);
    select up.coins
    into v_current
    from public.user_progress up
    where up.user_id = target_user_id
    for update;
  end if;

  if v_current is null then
    v_current := 0;
  end if;

  v_next := case operation
    when 'increase' then v_current + v_amount
    when 'decrease' then v_current - v_amount
    else v_amount
  end;
  v_next := greatest(0, least(99999999999.9, round(v_next, 1)));

  update public.user_progress
  set coins = v_next, updated_at = now()
  where user_id = target_user_id;

  if not found then
    raise exception 'User progress record not found';
  end if;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'ballrush_progress',
    (case when jsonb_typeof(raw_user_meta_data->'ballrush_progress') = 'object'
      then raw_user_meta_data->'ballrush_progress' else '{}'::jsonb end)
      || jsonb_build_object('coins', v_next)
  )
  where id = target_user_id;

  return v_next;
end;
$$;

revoke all on function public.boss_update_user_coins(uuid, text, numeric) from public, anon;
grant execute on function public.boss_update_user_coins(uuid, text, numeric) to authenticated;

-- Preserve the coin column when the existing player progression editor rewrites metadata.
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
    coalesce(up.coins, 0),
    coalesce(up.discovered, v_discovered),
    coalesce(up.variants, '{}'::jsonb),
    coalesce(up.leaderboard, '[]'::jsonb),
    coalesce(up.settings, '{"theme": "auto"}'::jsonb)
  into v_coins, v_discovered, v_variants, v_leaderboard, v_settings
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
