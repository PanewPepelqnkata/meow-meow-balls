-- ============================================================================
-- THE KING'S WARDROBE — Comprehensive Database & RLS Security Test Suite
-- Tests username change restrictions, avatar selection, favorite balls,
-- achievements, titles, lifetime statistics, account deletion, and cross-user RLS.
-- Rolled back at the end so live data is never modified.
-- ============================================================================
begin;

insert into auth.users (id, email, raw_user_meta_data)
values
  ('aaaa1111-1111-4111-8111-111111111111', 'wardrobe_hero@ballrush.local', '{"username":"WardrobeHero"}'::jsonb),
  ('bbbb2222-2222-4222-8222-222222222222', 'wardrobe_rival@ballrush.local', '{"username":"WardrobeRival"}'::jsonb);

-- 1. USERNAME TESTS
-- Switch to WardrobeHero
select set_config('request.jwt.claim.sub', 'aaaa1111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"aaaa1111-1111-4111-8111-111111111111","role":"authenticated"}'::text, true);
set local role authenticated;

do $$
declare
  v_res jsonb;
begin
  -- Invalid username (too short) fails and does NOT consume the one-time allowance
  begin
    perform public.change_username_once('ab');
    raise exception 'Short username should have been rejected';
  exception when invalid_parameter_value then null;
  end;

  -- Invalid username (special characters) fails and does NOT consume allowance
  begin
    perform public.change_username_once('Bad!Name');
    raise exception 'Invalid characters should have been rejected';
  exception when invalid_parameter_value then null;
  end;

  -- Reserved username fails and does NOT consume allowance
  begin
    perform public.change_username_once('Admin');
    raise exception 'Reserved username should have been rejected';
  exception when invalid_parameter_value then null;
  end;

  -- Prohibited slur/profanity fails and does NOT consume allowance
  begin
    perform public.change_username_once('fuck_king');
    raise exception 'Profanity username should have been rejected';
  exception when invalid_parameter_value then null;
  end;

  -- Case-insensitive duplicate of another player's username fails and does NOT consume allowance
  begin
    perform public.change_username_once('wardroberival');
    raise exception 'Case-insensitive duplicate username should have been rejected';
  exception when unique_violation then null;
  end;

  -- Direct table UPDATE on profiles (bypassing RPC) is blocked by privilege revocation
  begin
    update public.profiles set username = 'HackedName', username_changed_at = null
    where id = 'aaaa1111-1111-4111-8111-111111111111';
    raise exception 'Direct UPDATE on public.profiles should be blocked';
  exception when insufficient_privilege then null;
  end;

  -- First permitted username change succeeds (with leading/trailing whitespace trimmed)
  v_res := public.change_username_once('  Sir_Bounce_Lot  ');
  if (v_res->>'username') <> 'Sir_Bounce_Lot' or (v_res->>'display_name') <> 'Sir_Bounce_Lot' then
    raise exception 'Expected Sir_Bounce_Lot, got %', v_res;
  end if;
  if (v_res->>'username_changed_at') is null then
    raise exception 'username_changed_at was not recorded';
  end if;

  -- Second username change is permanently rejected
  begin
    perform public.change_username_once('Another_Name');
    raise exception 'Second username change should have been rejected';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

-- 2. AVATAR & FAVORITE BALLS TESTS (BEFORE UNLOCKING)
do $$
declare
  v_res jsonb;
begin
  -- Starter ball core:1..core:3 is unlocked -> succeeds
  v_res := public.set_selected_avatar('core:2');
  if (v_res->>'selected_avatar_id') <> 'core:2' then
    raise exception 'Failed to select unlocked starter ball core:2';
  end if;

  -- Locked ball core:8 -> rejected
  begin
    perform public.set_selected_avatar('core:8');
    raise exception 'Locked ball core:8 should have been rejected';
  exception when insufficient_privilege then null;
  end;

  -- Locked collectible shark -> rejected
  begin
    perform public.set_selected_avatar('collectible:9:shark');
    raise exception 'Locked collectible:9:shark should have been rejected';
  exception when insufficient_privilege then null;
  end;

  -- Invalid / arbitrary URL avatar -> rejected
  begin
    perform public.set_selected_avatar('https://evil.example/avatar.png');
    raise exception 'Arbitrary URL avatar should have been rejected';
  exception when invalid_parameter_value then null;
  end;

  -- Favorite balls: valid unlocked starter balls (ordered) -> succeeds
  v_res := public.save_favorite_balls('["core:3","core:1","core:2"]'::jsonb);
  if (v_res->'favorite_ball_ids'->>0) <> 'core:3' or (v_res->'favorite_ball_ids'->>2) <> 'core:2' then
    raise exception 'Favorite ball ordering failed: %', v_res;
  end if;

  -- Favorite balls: more than 3 -> rejected
  begin
    perform public.save_favorite_balls('["core:1","core:2","core:3","core:4"]'::jsonb);
    raise exception 'More than 3 favorite balls should have been rejected';
  exception when invalid_parameter_value then null;
  end;

  -- Favorite balls: duplicate IDs -> rejected
  begin
    perform public.save_favorite_balls('["core:1","core:1"]'::jsonb);
    raise exception 'Duplicate favorite balls should have been rejected';
  exception when invalid_parameter_value then null;
  end;

  -- Favorite balls: locked character -> rejected
  begin
    perform public.save_favorite_balls('["core:1","collectible:9:shark"]'::jsonb);
    raise exception 'Locked favorite ball should have been rejected';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- 3. ACHIEVEMENTS, TITLES & STATISTICS TESTS
do $$
declare
  v_overview jsonb;
  v_session jsonb;
  v_submit jsonb;
  v_title_res jsonb;
begin
  -- Direct INSERT into user_achievements is blocked
  begin
    insert into public.user_achievements (user_id, achievement_id)
    values ('aaaa1111-1111-4111-8111-111111111111', 'legendary_run');
    raise exception 'Direct INSERT into user_achievements should be blocked';
  exception when insufficient_privilege then null;
  end;

  -- Selecting a locked title before earning its achievement -> rejected
  begin
    perform public.set_active_title('dragon_tamer');
    raise exception 'Locked title dragon_tamer should have been rejected';
  exception when insufficient_privilege then null;
  end;

  -- Selecting an unknown title ID -> rejected
  begin
    perform public.set_active_title('emperor_of_mars');
    raise exception 'Invalid title ID should have been rejected';
  exception when invalid_parameter_value then null;
  end;

  -- Play a verified game session reaching score 12,000, tier 9, 120 merges, discovering shark
  v_session := public.start_game_session(null, 'wardrobe-seed', 'shark');
  v_submit := public.submit_game_session(
    (v_session->>'session_id')::uuid,
    12000,
    9,
    120,
    90000,
    'completed',
    '[{"tier":9,"theme":"shark","variant":2,"discoveredAt":1800000000000}]'::jsonb,
    null,
    v_session->>'nonce'
  );

  -- Now shark is unlocked! Selecting collectible:9:shark as avatar succeeds
  perform public.set_selected_avatar('collectible:9:shark');

  -- Adding collectible:9:shark and core:8 to favorites succeeds
  perform public.save_favorite_balls('["collectible:9:shark","core:8","core:3"]'::jsonb);

  -- Dragon Tamer and Ball Champion titles are now earned -> selecting dragon_tamer succeeds
  v_title_res := public.set_active_title('dragon_tamer');
  if (v_title_res->>'active_title_id') <> 'dragon_tamer' then
    raise exception 'Expected active_title_id dragon_tamer, got %', v_title_res;
  end if;

  -- Fetch King's Wardrobe overview and verify statistics, achievements, and titles
  v_overview := public.get_kings_wardrobe_overview();
  if (v_overview->'profile'->>'username') <> 'Sir_Bounce_Lot' then
    raise exception 'Overview username mismatch: %', v_overview->'profile';
  end if;
  if (v_overview->'profile'->>'selected_avatar_id') <> 'collectible:9:shark' then
    raise exception 'Overview avatar mismatch: %', v_overview->'profile';
  end if;
  if (v_overview->'profile'->>'active_title_id') <> 'dragon_tamer' then
    raise exception 'Overview active title mismatch: %', v_overview->'profile';
  end if;
  if (v_overview->'statistics'->>'games_played')::integer <> 1 then
    raise exception 'Expected 1 game played, got %', v_overview->'statistics';
  end if;
  if (v_overview->'statistics'->>'total_merges')::integer <> 120 then
    raise exception 'Expected 120 merges, got %', v_overview->'statistics';
  end if;
  if (v_overview->'statistics'->>'best_score')::integer <> 12000 then
    raise exception 'Expected 12000 best_score, got %', v_overview->'statistics';
  end if;
  if (v_overview->'statistics'->>'total_coins_earned')::numeric <> 12.0 then
    raise exception 'Expected 12.0 total_coins_earned, got %', v_overview->'statistics';
  end if;
end;
$$;

-- 4. CROSS-USER ISOLATION & ACCOUNT DELETION TESTS
-- Switch to WardrobeRival
select set_config('request.jwt.claim.sub', 'bbbb2222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"bbbb2222-2222-4222-8222-222222222222","role":"authenticated"}'::text, true);

do $$
declare
  v_count integer;
begin
  -- Rival cannot see Hero's user_achievements rows via direct SELECT
  select count(*) into v_count
  from public.user_achievements
  where user_id = 'aaaa1111-1111-4111-8111-111111111111';
  if v_count <> 0 then
    raise exception 'Rival was able to read Hero user_achievements rows';
  end if;

  -- Rival cannot use Hero's unlocked shark character
  begin
    perform public.set_selected_avatar('collectible:9:shark');
    raise exception 'Rival was able to equip Hero unlocked shark';
  exception when insufficient_privilege then null;
  end;

  -- Rival cannot take Hero's new username (case-insensitive)
  begin
    perform public.change_username_once('sir_bounce_lot');
    raise exception 'Rival was able to take Hero username';
  exception when unique_violation then null;
  end;

  -- Account deletion without explicit 'DELETE' confirmation fails
  begin
    perform public.delete_own_account('yes');
    raise exception 'Account deletion without DELETE confirmation succeeded';
  exception when invalid_parameter_value then null;
  end;

  -- Account deletion with 'DELETE' confirmation removes Rival's account cleanly
  perform public.delete_own_account('DELETE');
end;
$$;
reset role;

do $$
begin
  if exists (select 1 from public.profiles where id = 'bbbb2222-2222-4222-8222-222222222222') then
    raise exception 'Deleted account profile still exists';
  end if;
  if not exists (select 1 from public.profiles where id = 'aaaa1111-1111-4111-8111-111111111111') then
    raise exception 'Hero profile was unexpectedly affected';
  end if;
end;
$$;

rollback;
