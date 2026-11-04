-- Diagnostic: Check if interruption_reason column exists
-- Run this in Supabase SQL Editor to verify the migration was applied

-- Check if columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'scores' AND column_name = 'interruption_reason';

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'guest_scores' AND column_name = 'interruption_reason';

-- Check if RPC functions have the new parameter
SELECT
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname IN ('record_guest_score', 'record_user_score')
AND n.nspname = 'public';

-- If the above shows the functions WITHOUT p_interruption_reason parameter,
-- the migration needs to be applied. Run the contents of:
-- supabase/migrations/007_interruption_reason.sql
