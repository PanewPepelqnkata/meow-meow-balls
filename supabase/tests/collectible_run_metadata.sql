-- Run after migrations as the database owner. Everything is rolled back.
-- Exercises actual RPC inserts/updates, nullable legacy rows, admin edits,
-- guest conversion, dashboard serialization, reset, and invalid/unauthorized calls.
begin;

insert into auth.users (id, email, raw_user_meta_data)
values ('51f39d10-6e6e-4ed9-8122-6343b718de11', 'collectibles-sql-smoke@ballrush.local', '{"username":"collectibles_sql_smoke"}');
select set_config('request.jwt.claim.sub', '51f39d10-6e6e-4ed9-8122-6343b718de11', true);

create temporary table collectible_smoke_ids (kind text primary key, id bigint);

grant select, insert on collectible_smoke_ids to anon, authenticated;
-- Actual guest finds include lifetime repeats and preserve first run time.
set local role anon;
select public.upsert_guest_progress(
  '2fd7d674-a6ce-4a04-b8ab-22418da1a1d5', 0, '{}'::jsonb,
  '{"9:pig:3":1800000000200,"10:crab:5":1800000000300}'::jsonb
);
insert into collectible_smoke_ids values ('guest', public.record_guest_score(
  '2fd7d674-a6ce-4a04-b8ab-22418da1a1d5', 500, 9, 4, 1000,
  null, null, '[{"tier":9,"theme":"pig","variant":3,"discoveredAt":1800000000200}]'
));
reset role;

do $$
declare
  run_id bigint := (select id from collectible_smoke_ids where kind = 'guest');
  actual jsonb;
begin
  perform public.record_guest_score('2fd7d674-a6ce-4a04-b8ab-22418da1a1d5', 800, 10, 8, 2000, run_id, 'completed',
    '[{"tier":9,"theme":"pig","variant":3,"discoveredAt":1800000000200},{"tier":10,"theme":"crab","variant":5,"discoveredAt":1800000000300}]');
  -- A delayed older live snapshot cannot erase the later crab discovery.
  perform public.record_guest_score('2fd7d674-a6ce-4a04-b8ab-22418da1a1d5', 500, 9, 4, 1000, run_id, null,
    '[{"tier":9,"theme":"pig","variant":3,"discoveredAt":1800000000400}]');
  select collectibles into actual from public.guest_scores where id = run_id;
  if jsonb_array_length(actual) <> 2 or actual->0->>'discoveredAt' <> '1800000000200' then
    raise exception 'Guest snapshots lost identity or first discovery timestamp: %', actual;
  end if;
  if (select interruption_reason from public.guest_scores where id = run_id) <> 'completed' then
    raise exception 'An older live sync cleared the final interruption reason';
  end if;
  if not (select variants ? '9:pig:3' and variants ? '10:crab:5' and not (variants ? '9:0')
    from public.guest_profiles where guest_id = '2fd7d674-a6ce-4a04-b8ab-22418da1a1d5') then
    raise exception 'Guest lifetime map omitted actual identities or invented a legacy key';
  end if;
  perform public.boss_update_guest_score(run_id, 400, 8, 2, 900);
  if (select collectibles from public.guest_scores where id = run_id) <> actual then
    raise exception 'Guest admin scalar edit destroyed metadata';
  end if;
end;
$$;

-- Unknown legacy and explicit none remain different, including conversion.
insert into public.guest_scores (guest_id, score, tier_reached, collectibles)
values ('2fd7d674-a6ce-4a04-b8ab-22418da1a1d5', 50, 3, null),
       ('2fd7d674-a6ce-4a04-b8ab-22418da1a1d5', 60, 3, '[]');

set local role authenticated;
select public.link_guest_to_user('2fd7d674-a6ce-4a04-b8ab-22418da1a1d5');
reset role;

do $$
declare
  run_id bigint;
  snapshot jsonb;
  dashboard jsonb;
begin
  if (select count(*) from public.scores where user_id = '51f39d10-6e6e-4ed9-8122-6343b718de11') <> 3 then
    raise exception 'Guest conversion omitted runs';
  end if;
  if (select count(*) from public.scores where user_id = '51f39d10-6e6e-4ed9-8122-6343b718de11' and collectibles is null) <> 1
    or (select count(*) from public.scores where user_id = '51f39d10-6e6e-4ed9-8122-6343b718de11' and collectibles = '[]'::jsonb) <> 1 then
    raise exception 'Guest conversion collapsed null and []';
  end if;
  if (select variants from public.user_progress where user_id = '51f39d10-6e6e-4ed9-8122-6343b718de11') <> '{}'::jsonb then
    raise exception 'Guest run metadata incorrectly rebuilt a lifetime collection';
  end if;
  select id, collectibles into run_id, snapshot from public.scores
  where user_id = '51f39d10-6e6e-4ed9-8122-6343b718de11' and jsonb_array_length(collectibles) = 2;
  if (select interruption_reason from public.scores where id = run_id) <> 'completed' then
    raise exception 'Conversion lost interruption reason';
  end if;
  perform public.boss_update_score(run_id, 300, 7, 1, 500);
  if (select collectibles from public.scores where id = run_id) <> snapshot then
    raise exception 'Registered admin scalar edit destroyed metadata';
  end if;
  dashboard := public.boss_get_dashboard_data();
  if not exists (select 1 from jsonb_array_elements(dashboard->'scores') row
    where (row->>'id')::bigint = run_id and row->'collectibles' = snapshot) then
    raise exception 'Dashboard RPC omitted user collectibles';
  end if;
  if not exists (select 1 from jsonb_array_elements(dashboard->'guest_scores') row
    where (row->>'id')::bigint = (select id from collectible_smoke_ids where kind = 'guest')
    and row->'collectibles' = snapshot) then
    raise exception 'Dashboard RPC omitted guest collectibles';
  end if;
end;
$$;

-- Fresh authenticated rows start with [] and subsequently get actual finds.
set local role authenticated;
insert into collectible_smoke_ids values ('user', public.record_user_score(0, 3, 0, 0, null, null, '[]'));
reset role;
update public.user_progress set variants = '{"9:robo:2":1800000000500}'::jsonb
where user_id = '51f39d10-6e6e-4ed9-8122-6343b718de11';

do $$
declare
  run_id bigint := (select id from collectible_smoke_ids where kind = 'user');
  another_id bigint;
  snapshot jsonb := '[{"tier":9,"theme":"robo","variant":2,"discoveredAt":1800000000500}]';
begin
  if (select collectibles from public.scores where id = run_id) <> '[]'::jsonb then
    raise exception 'A recorded no-find run was marked legacy';
  end if;
  perform public.record_user_score(1000, 9, 5, 3000, run_id, 'completed', snapshot);
  perform public.record_user_score(900, 9, 4, 2500, run_id, null, '[]');
  if (select collectibles from public.scores where id = run_id) <> snapshot then
    raise exception 'Registered live/final metadata update lost actual discovery';
  end if;
  another_id := public.record_user_score(1100, 9, 6, 4000, null, 'completed',
    '[{"tier":9,"theme":"robo","variant":2,"discoveredAt":1800000000600}]');
  if (select collectibles->0->>'discoveredAt' from public.scores where id = another_id) <> '1800000000600' then
    raise exception 'Lifetime repeat did not retain its own per-run timestamp';
  end if;
  if (select variants->>'9:robo:2' from public.user_progress where user_id = '51f39d10-6e6e-4ed9-8122-6343b718de11') <> '1800000000500' then
    raise exception 'Lifetime collection timestamp was replaced by repeat';
  end if;

  -- Legacy score caps can restore tier progression but never character keys.
  insert into public.scores (user_id, score, tier_reached)
  values ('51f39d10-6e6e-4ed9-8122-6343b718de11', 2000, 12);
  perform public.boss_sync_user_progress_internal('51f39d10-6e6e-4ed9-8122-6343b718de11', false);
  if exists (select 1 from public.user_progress up, jsonb_object_keys(up.variants) key
    where up.user_id = '51f39d10-6e6e-4ed9-8122-6343b718de11' and key ~ '^[0-9]+:[0-9]+$') then
    raise exception 'A score cap invented a legacy character palette';
  end if;
  -- A client collection reset keeps audit rows but must not re-unlock them.
  update public.user_progress set variants = '{}'::jsonb
  where user_id = '51f39d10-6e6e-4ed9-8122-6343b718de11';
  perform public.boss_sync_user_progress_internal('51f39d10-6e6e-4ed9-8122-6343b718de11', false);
  if (select variants from public.user_progress where user_id = '51f39d10-6e6e-4ed9-8122-6343b718de11') <> '{}'::jsonb then
    raise exception 'Run metadata resurrected a reset collection';
  end if;
  begin
    perform public.record_user_score(10, 9, 1, 1, null, null,
      '[{"tier":9,"theme":"pig","variant":3}]');
    raise exception 'Invalid metadata was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.scores (user_id, score, tier_reached, collectibles)
    values ('51f39d10-6e6e-4ed9-8122-6343b718de11', 10, 9, '{}');
    raise exception 'Invalid direct insert was accepted';
  exception when check_violation then null;
  end;

  perform public.boss_reset_user_progress('51f39d10-6e6e-4ed9-8122-6343b718de11');
  if exists (select 1 from public.scores where user_id = '51f39d10-6e6e-4ed9-8122-6343b718de11')
    or (select variants from public.user_progress where user_id = '51f39d10-6e6e-4ed9-8122-6343b718de11') <> '{}'::jsonb then
    raise exception 'Account reset did not clear metadata and lifetime collection';
  end if;
  perform public.boss_reset_guest_progress('2fd7d674-a6ce-4a04-b8ab-22418da1a1d5');
  if exists (select 1 from public.guest_scores where guest_id = '2fd7d674-a6ce-4a04-b8ab-22418da1a1d5')
    or (select variants from public.guest_profiles where guest_id = '2fd7d674-a6ce-4a04-b8ab-22418da1a1d5') <> '{}'::jsonb then
    raise exception 'Guest reset did not clear metadata and lifetime collection';
  end if;
  if has_function_privilege('anon', 'public.record_user_score(integer,integer,integer,integer,bigint,text,jsonb)', 'execute')
    or has_function_privilege('anon', 'public.boss_get_dashboard_data()', 'execute')
    or has_function_privilege('authenticated', 'public.boss_sync_user_progress_internal(uuid,boolean)', 'execute') then
    raise exception 'RPC permissions were broadened';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
do $$
begin
  begin
    perform public.record_user_score(1, 1, 0, 0, null, null, '[]');
    raise exception 'Unauthenticated user score was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Authentication required' then raise; end if;
  end;
end;
$$;
reset role;

rollback;
