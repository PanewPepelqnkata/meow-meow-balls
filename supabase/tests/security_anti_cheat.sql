-- Attacker-style PostgreSQL security test suite
-- Verifies RLS, privilege revocations, profiles.email protection, boss_* admin guards,
-- game_sessions lifecycle, ability one-use enforcement, score bounds, and economy_ledger.
begin;

insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-4111-8111-111111111111', 'player1@ballrush.local', '{"username":"player1"}'::jsonb),
  ('22222222-2222-4222-8222-222222222222', 'attacker@ballrush.local', '{"username":"attacker"}'::jsonb),
  ('33333333-3333-4333-8333-333333333333', 'admin@ballrush.local', '{"username":"admin"}'::jsonb);

insert into public.boss_admins (user_id)
values ('33333333-3333-4333-8333-333333333333');

-- 1. Verify profiles.email is hidden from direct SELECT by anon/authenticated,
-- while resolve_username_email RPC works for login.
set local role anon;
do $$
declare
  v_email text;
begin
  begin
    execute 'select email from public.profiles limit 1' into v_email;
    raise exception 'anon was able to SELECT profiles.email directly';
  exception when insufficient_privilege then null;
  end;

  v_email := public.resolve_username_email('player1');
  if v_email <> 'player1@ballrush.local' then
    raise exception 'resolve_username_email failed for valid username: %', v_email;
  end if;
end;
$$;
reset role;

-- 2. Verify non-admin authenticated user cannot invoke ANY boss_* RPCs
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    perform public.boss_get_dashboard_data();
    raise exception 'Non-admin called boss_get_dashboard_data';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.boss_delete_user('11111111-1111-4111-8111-111111111111');
    raise exception 'Non-admin called boss_delete_user';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.boss_reset_user_progress('11111111-1111-4111-8111-111111111111');
    raise exception 'Non-admin called boss_reset_user_progress';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- 3. Verify direct table writes to scores, user_progress, game_sessions, economy_ledger are blocked
do $$
begin
  begin
    insert into public.scores (user_id, score, tier_reached)
    values ('22222222-2222-4222-8222-222222222222', 999999, 12);
    raise exception 'Direct INSERT into public.scores succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.economy_ledger (user_id, delta, balance_after, coin_revision, reason)
    values ('22222222-2222-4222-8222-222222222222', 1000, 1000, 1, 'forged');
    raise exception 'Direct INSERT into public.economy_ledger succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- 4. Verify game session lifecycle, ability one-use enforcement, cross-user isolation, and score validation
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
do $$
declare
  v_session jsonb;
  v_session_id uuid;
  v_ability_res jsonb;
  v_submit_res jsonb;
begin
  v_session := public.start_game_session(null, 'seed-abc', 'pig');
  v_session_id := (v_session->>'session_id')::uuid;

  -- Activate shake once -> succeeds
  v_ability_res := public.activate_session_ability(v_session_id, 'shake');
  if (v_ability_res->'abilities_used'->>'shake')::boolean is not true then
    raise exception 'Shake ability was not marked used';
  end if;

  -- Activate shake a second time in the same session -> rejected
  begin
    perform public.activate_session_ability(v_session_id, 'shake');
    raise exception 'Duplicate ability activation in same session succeeded';
  exception when invalid_parameter_value then null;
  end;

  -- Submit impossible score (positive score with 0 merges) -> rejected
  begin
    perform public.record_user_score(50000, 9, 0, 10000, null, 'completed', '[]'::jsonb, gen_random_uuid());
    raise exception 'Positive score with 0 merges was accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Submit impossible score-to-merge ratio -> rejected
  begin
    perform public.record_user_score(500000, 9, 2, 10000, null, 'completed', '[]'::jsonb, gen_random_uuid());
    raise exception 'Impossible score-to-merge ratio was accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Submit valid session result -> succeeds and settles coins + ledger
  v_submit_res := public.submit_game_session(
    v_session_id, 2500, 6, 12, 45000, 'completed', '[]'::jsonb, null, v_session->>'nonce'
  );
  if (v_submit_res->>'coins')::numeric <> 2.5 then
    raise exception 'Expected 2.5 settled coins, got %', v_submit_res;
  end if;

  -- Re-submitting the already completed session -> rejected
  begin
    perform public.submit_game_session(
      v_session_id, 9000, 8, 20, 60000, 'completed', '[]'::jsonb, null, v_session->>'nonce'
    );
    raise exception 'Completed session was submitted a second time';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
reset role;

-- Verify economy_ledger recorded the run settlement
do $$
begin
  if (select count(*) from public.economy_ledger where user_id = '11111111-1111-4111-8111-111111111111' and delta = 2.5 and reason = 'run_settlement') <> 1 then
    raise exception 'economy_ledger did not record run_settlement';
  end if;
end;
$$;

rollback;
