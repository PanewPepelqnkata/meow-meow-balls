-- Run after migrations as the database owner. Everything is rolled back.
-- Covers authoritative upgrade state, purchase guards/costs/caps, direct-write
-- protection, metadata spoof resistance, sync compatibility, and admin paths.
begin;

insert into auth.users (id, email, raw_user_meta_data)
values (
  '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30',
  'upgrades-sql-smoke@ballrush.local',
  '{"username":"upgrades_sql_smoke","ballrush_progress":{"coins":9999,"coinRevision":999,"upgrades":{"wallDuration":10,"shakeDuration":10,"shakeIntensity":5}}}'::jsonb
);
insert into public.boss_admins (user_id) values ('7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30');
insert into public.user_progress (user_id, coins, coin_revision, upgrades)
values (
  '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30',
  100.0,
  7,
  '{"wallDuration":0,"shakeDuration":0,"shakeIntensity":0}'::jsonb
);

select set_config('request.jwt.claim.sub', '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30', true);
set local role authenticated;

do $$
declare
  result jsonb;
begin
  result := public.purchase_ability_upgrade('wallDuration', 0, 7);
  if (result->>'coins')::numeric <> 90.0
    or (result->>'coin_revision')::bigint <> 8
    or result->'upgrades'->>'wallDuration' <> '1'
    or result->'upgrades'->>'shakeDuration' <> '0'
    or result->'upgrades'->>'shakeIntensity' <> '0' then
    raise exception 'First upgrade did not return authoritative state: %', result;
  end if;
  if (select coins from public.user_progress where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30') <> 90.0
    or (select coin_revision from public.user_progress where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30') <> 8
    or (select upgrades->>'wallDuration' from public.user_progress where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30') <> '1' then
    raise exception 'First upgrade was not committed atomically';
  end if;
end;
$$;

-- A stale revision or level cannot spend twice.  The exception rolls back only
-- its failed statement block; the surrounding purchase remains committed.
do $$
begin
  begin
    perform public.purchase_ability_upgrade('wallDuration', 1, 7);
    raise exception 'Stale coin revision was accepted';
  exception when others then
    if sqlerrm = 'Stale coin revision was accepted' then raise; end if;
  end;
  begin
    perform public.purchase_ability_upgrade('wallDuration', 0, 8);
    raise exception 'Stale expected level was accepted';
  exception when others then
    if sqlerrm = 'Stale expected level was accepted' then raise; end if;
  end;
end;
$$;

-- Duration levels cost 10 * next level; intensity costs 20 * next level.
do $$
declare
  result jsonb;
begin
  result := public.purchase_ability_upgrade('wallDuration', 1, 8);
  if (result->>'coins')::numeric <> 70.0
    or (result->>'coin_revision')::bigint <> 9
    or result->'upgrades'->>'wallDuration' <> '2' then
    raise exception 'Duration price/level guard failed: %', result;
  end if;
  result := public.purchase_ability_upgrade('shakeIntensity', 0, 9);
  if (result->>'coins')::numeric <> 50.0
    or (result->>'coin_revision')::bigint <> 10
    or result->'upgrades'->>'shakeIntensity' <> '1' then
    raise exception 'Intensity price/level guard failed: %', result;
  end if;
end;
$$;

-- Sync ignores any client earning amount and settles only the stored final
-- score receipt.  The payload's forged upgrade levels are also ignored.
do $$
declare
  result jsonb;
  score_id bigint;
begin
  perform public.record_user_score(
    1500, 3, 1, 1000, null, 'completed', '[]'::jsonb,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  );
  result := public.sync_user_progress(
    '{"best":10,"discovered":{},"variants":{},"stats":{"runs":1,"merges":1,"bestTier":3},"leaderboard":[],"settings":{"theme":"auto"},"upgrades":{"wallDuration":10,"shakeDuration":10,"shakeIntensity":5}}'::jsonb,
    10
  );
  if (result->>'coins')::numeric <> 51.5
    or (result->>'coin_revision')::bigint <> 11
    or (result->>'settled_coins')::numeric <> 0
    or result->'upgrades'->>'wallDuration' <> '2'
    or result->'upgrades'->>'shakeIntensity' <> '1' then
    raise exception 'Sync did not preserve authoritative settlement/upgrade state: %', result;
  end if;
  -- Replaying the same final submission returns the same score identity and
  -- cannot award a second time.
  perform public.record_user_score(
    1500, 3, 1, 1000, null, 'completed', '[]'::jsonb,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  );
  perform public.record_user_score(
    9999, 12, 99, 9999, null, 'error', '[]'::jsonb,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  );
  if (select count(*) from public.scores where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30'
      and run_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) <> 1
    or (select coins from public.user_progress where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30') <> 51.5 then
    raise exception 'Final score receipt replay changed balance or identity';
  end if;
  if (select score from public.scores where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30'
      and run_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) <> 1500
    or (select interruption_reason from public.scores where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30'
      and run_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) <> 'completed' then
    raise exception 'Settled score row was rewritten';
  end if;
  select id into score_id from public.scores
  where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30'
    and run_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
  perform public.boss_delete_score(score_id);
  perform public.record_user_score(
    20000, 12, 99, 9999, null, 'completed', '[]'::jsonb,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  );
  if (select coins from public.user_progress where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30') <> 51.5
    or not exists (
      select 1 from public.coin_settlements cs
      where cs.user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30'
        and cs.run_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
        and cs.settled_at is not null
    ) then
    raise exception 'Deleted settled run replay minted coins';
  end if;
  if (select upgrades from public.user_progress where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30')
      <> '{"wallDuration":2,"shakeDuration":0,"shakeIntensity":1}'::jsonb then
    raise exception 'Client upgrade payload overwrote user_progress';
  end if;
end;
$$;

-- Server-side cap: intensity has five levels, durations have ten.  The
-- expected-level argument cannot bypass the cap or supply a price.
reset role;
update public.user_progress
set coins = 1000.0, coin_revision = 20,
    upgrades = '{"wallDuration":10,"shakeDuration":10,"shakeIntensity":5}'::jsonb
where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30';
set local role authenticated;
do $$
begin
  begin
    perform public.purchase_ability_upgrade('shakeIntensity', 5, 20);
    raise exception 'Intensity cap was bypassed';
  exception when others then
    if sqlerrm = 'Intensity cap was bypassed' then raise; end if;
  end;
  begin
    perform public.purchase_ability_upgrade('wallDuration', 10, 20);
    raise exception 'Duration cap was bypassed';
  exception when others then
    if sqlerrm = 'Duration cap was bypassed' then raise; end if;
  end;
end;
$$;

reset role;
update public.user_progress
set coins = 0.0, coin_revision = 40,
    upgrades = '{"wallDuration":0,"shakeDuration":0,"shakeIntensity":0}'::jsonb
where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30';
set local role authenticated;
do $$
begin
  begin
    perform public.purchase_ability_upgrade('wallDuration', 0, 40);
    raise exception 'Insufficient coin purchase was accepted';
  exception when others then
    if sqlerrm = 'Insufficient coin purchase was accepted' then raise; end if;
  end;
end;
$$;

-- Admin edits preserve protected currency/revision/upgrades.
reset role;
update public.user_progress
set coins = 123.4, coin_revision = 31,
    upgrades = '{"wallDuration":3,"shakeDuration":4,"shakeIntensity":2}'::jsonb
where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30';
set local role authenticated;
do $$
begin
  perform public.boss_update_user(
    '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30', 'admin-edit', 'Admin Edit', 42, 2, 3, 4
  );
end;
$$;
reset role;
do $$
begin
  if (select coins from public.user_progress where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30') <> 123.4
    or (select coin_revision from public.user_progress where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30') <> 31
    or (select upgrades from public.user_progress where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30')
      <> '{"wallDuration":3,"shakeDuration":4,"shakeIntensity":2}'::jsonb then
    raise exception 'Admin profile edit rewrote protected state';
  end if;
end;
$$;

-- Metadata is user-editable and cannot initialize or reset protected state.
update auth.users
set raw_user_meta_data = jsonb_build_object(
  'username', 'upgrades_sql_smoke',
  'ballrush_progress', jsonb_build_object(
    'coins', 999999, 'coinRevision', 999999,
    'upgrades', jsonb_build_object('wallDuration', 10, 'shakeDuration', 10, 'shakeIntensity', 5)
  )
)
where id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30';
do $$ begin perform public.boss_sync_user_progress_internal('7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30', false); end $$;
do $$
begin
  if (select coins from public.user_progress where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30') <> 123.4
    or (select coin_revision from public.user_progress where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30') <> 31
    or (select upgrades from public.user_progress where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30')
      <> '{"wallDuration":3,"shakeDuration":4,"shakeIntensity":2}'::jsonb then
    raise exception 'Metadata spoof changed authoritative protected state';
  end if;
end;
$$;

-- A direct table update is not an alternative write path for an authenticated
-- client, even for its own row.
set local role authenticated;
do $$
begin
  begin
    update public.user_progress set coins = 999999
    where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30';
    raise exception 'Direct user_progress update was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Anonymous database clients have no execute privilege.  A signed anonymous
-- JWT (authenticated role plus is_anonymous=true) is rejected in the body too.
set local role anon;
do $$
begin
  begin
    perform public.purchase_ability_upgrade('wallDuration', 0, 31);
    raise exception 'Anonymous purchase was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30","role":"authenticated","is_anonymous":true}',
  true
);
set local role authenticated;
do $$
begin
  begin
    perform public.purchase_ability_upgrade('wallDuration', 3, 31);
    raise exception 'Anonymous JWT purchase was accepted';
  exception when others then
    if sqlerrm = 'Anonymous JWT purchase was accepted' then raise; end if;
  end;
end;
$$;
reset role;

-- The legacy no-row path is also protected: metadata cannot mint the first
-- balance/revision or unlock upgrades when progress is materialized.
reset role;
delete from public.user_progress
where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30';
update auth.users
set raw_user_meta_data = jsonb_build_object(
  'ballrush_progress', jsonb_build_object(
    'coins', 999999, 'coinRevision', 999999,
    'upgrades', jsonb_build_object('wallDuration', 10, 'shakeDuration', 10, 'shakeIntensity', 5)
  )
)
where id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30';
do $$ begin perform public.boss_sync_user_progress_internal('7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30', false); end $$;
do $$
begin
  if (select coins from public.user_progress where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30') <> 0
    or (select coin_revision from public.user_progress where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30') <> 0
    or (select upgrades from public.user_progress where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30')
      <> '{"wallDuration":0,"shakeDuration":0,"shakeIntensity":0}'::jsonb then
    raise exception 'Metadata initialized protected state on a new row';
  end if;
end;
$$;

-- A pre-existing winner row remains authoritative when sync materializes
-- progress; this is the deterministic half of the concurrent first-row race.
reset role;
delete from public.user_progress
where user_id = '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30';
insert into public.user_progress (user_id, coins, coin_revision, upgrades)
values (
  '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30', 77.0, 41,
  '{"wallDuration":4,"shakeDuration":2,"shakeIntensity":1}'::jsonb
);
select set_config('request.jwt.claim.sub', '7ac6d7f0-8f3d-4a77-9e0b-9f8e4a1c2b30', true);
set local role authenticated;
do $$
declare result jsonb;
begin
  result := public.sync_user_progress(
    '{"best":1,"discovered":{},"variants":{},"stats":{"runs":1,"merges":1,"bestTier":1},"leaderboard":[],"settings":{"theme":"auto"}}'::jsonb,
    0
  );
  if (result->>'coins')::numeric <> 77.0
    or (result->>'coin_revision')::bigint <> 41
    or result->'upgrades' <> '{"wallDuration":4,"shakeDuration":2,"shakeIntensity":1}'::jsonb then
    raise exception 'Authoritative winner row was overwritten during sync materialization: %', result;
  end if;
end;
$$;

-- Upgrade RPC and sync are not callable by anon.
do $$
begin
  if has_function_privilege('anon', 'public.purchase_ability_upgrade(text,integer,bigint)', 'execute')
    or has_function_privilege('anon', 'public.sync_user_progress(jsonb,bigint)', 'execute')
    or to_regprocedure('public.sync_user_progress(jsonb,numeric,bigint)') is not null then
    raise exception 'Anonymous RPC execute privilege was broadened';
  end if;
end;
$$;

rollback;
