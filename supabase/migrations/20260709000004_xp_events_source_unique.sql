-- =====================================================
-- MIGRAÇÃO: UNIQUE index parcial em xp_events para dedup de EloCoins
-- Descrição: Corrige TOCTOU race condition no credit de EloCoins.
--            O app-level SELECT antes do INSERT não tem garantia transacional;
--            dois requests concorrentes podem ambos ver "não existe" e inserir duplicatas.
--            O índice UNIQUE parcial garante dedup no nível do banco.
-- Data: 2026-07-09
-- Nota: CREATE INDEX CONCURRENTLY evita lock exclusivo na tabela.
--       Não pode rodar dentro de uma transação — Supabase migrations
--       rodam cada arquivo fora de tx quando contém CONCURRENTLY.
-- =====================================================

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_xp_events_source_dedup
  ON xp_events (source, source_id)
  WHERE source_id IS NOT NULL;

COMMENT ON INDEX idx_xp_events_source_dedup IS
  'Dedup atômico: impede INSERT duplicado de xp_events com mesmo (source, source_id). '
  'Corrige race condition TOCTOU do app-level SELECT+INSERT. '
  'Parcial (WHERE source_id IS NOT NULL) — não afeta eventos sem source_id (streaks, admin).';
