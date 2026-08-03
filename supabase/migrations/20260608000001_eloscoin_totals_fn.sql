-- Migration: 20260608000001_eloscoin_totals_fn.sql
-- Função SQL para somar entradas e saídas de EloCoins de um usuário
-- em uma única query agregada, sem depender de paginação no frontend.

CREATE OR REPLACE FUNCTION get_user_coin_totals(p_user_id TEXT)
RETURNS TABLE (total_in BIGINT, total_out BIGINT)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  SELECT
    COALESCE(SUM(coin_delta) FILTER (WHERE coin_delta > 0), 0) AS total_in,
    COALESCE(SUM(coin_delta) FILTER (WHERE coin_delta < 0), 0) AS total_out
  FROM xp_events
  WHERE user_id = p_user_id;
$$;
