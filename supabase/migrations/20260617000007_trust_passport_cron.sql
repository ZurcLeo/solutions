-- =============================================================================
-- Trust Passport: pg_cron daily batch recalculation
--
-- Estratégia: pg_cron marca todos os passaportes como stale (last_calculated = epoch).
-- O backend recalcula on-demand quando getPassport() detecta staleness (>24h).
-- Isso evita armazenar tokens de API em SQL e é resiliente a falhas.
--
-- Complementar: POST /api/trust/recalculate-all (admin endpoint) para forçar
-- recálculo imediato de todos os passaportes via backend.
-- =============================================================================

-- 1. Função que marca todos os passaportes como stale
CREATE OR REPLACE FUNCTION mark_trust_passports_stale()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE trust_passports
  SET last_calculated = '1970-01-01T00:00:00Z'::timestamptz
  WHERE last_calculated > '1970-01-01T00:00:00Z'::timestamptz;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION mark_trust_passports_stale() IS
  '[TRUST-CRON] Marca todos os trust_passports como stale para que o backend '
  'recalcule on-demand no próximo acesso. Chamada pelo pg_cron diariamente às 04:30 UTC.';

-- 2. Job pg_cron: diariamente às 04:30 UTC (30min após social scores)
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'recalculate-trust-passports',
  '30 4 * * *',
  $$ SELECT mark_trust_passports_stale(); $$
);
