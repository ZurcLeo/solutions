-- Fix: drop old spend_elo_coins overload with p_idempotency_key TEXT
-- The 20260616000002 migration added a new 6-param version with p_burn_amount INTEGER
-- but did NOT drop the old 6-param version with p_idempotency_key TEXT.
-- Both match 5-arg calls (6th has DEFAULT) → PostgreSQL error 42725 "not unique".
-- Solution: drop the old TEXT version, keep only the INTEGER (burn) version.

DROP FUNCTION IF EXISTS public.spend_elo_coins(TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT);

-- Verify: only the burn version (6th param = INTEGER) should remain
DO $$
DECLARE
  fn_count INTEGER;
BEGIN
  SELECT count(*) INTO fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'spend_elo_coins';

  IF fn_count != 1 THEN
    RAISE WARNING 'Expected exactly 1 spend_elo_coins function, found %', fn_count;
  END IF;
END $$;
