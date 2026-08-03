-- ============================================================
-- Migration: 20260623000004_property_blocked_dates_ical_columns
-- Adiciona colunas source e source_ref em property_blocked_dates
-- para rastrear a origem de bloqueios criados por sync iCal.
--
-- source     = 'manual' (default, bloqueios do host) | 'ical_sync'
-- source_ref = UUID da property_ical_sources (quando source='ical_sync')
--
-- Tambem relaxa o CHECK de reason para aceitar nomes de fontes iCal
-- como valor (ex: 'airbnb', 'booking', 'Airbnb Calendar').
-- ============================================================

-- 1. Adicionar coluna source (default 'manual' para registros existentes)
ALTER TABLE property_blocked_dates
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'ical_sync'));

-- 2. Adicionar coluna source_ref (FK para property_ical_sources)
ALTER TABLE property_blocked_dates
  ADD COLUMN IF NOT EXISTS source_ref UUID REFERENCES property_ical_sources(id) ON DELETE CASCADE;

-- 3. Relaxar o CHECK de reason para aceitar texto livre (nomes de fontes iCal)
--    O CHECK original era: reason IN ('manutencao','uso_proprio','outro')
--    Agora permitimos qualquer texto (ex: 'airbnb', 'Booking Calendar', etc.)
ALTER TABLE property_blocked_dates DROP CONSTRAINT IF EXISTS property_blocked_dates_reason_check;
ALTER TABLE property_blocked_dates
  ADD CONSTRAINT property_blocked_dates_reason_check
    CHECK (char_length(reason) <= 200);

-- 4. Indice para busca por source_ref (cleanup ao remover fonte iCal)
CREATE INDEX IF NOT EXISTS idx_pbd_source_ref
  ON property_blocked_dates (source_ref)
  WHERE source = 'ical_sync';

-- 5. Indice para busca por source + product_id (sync iCal)
CREATE INDEX IF NOT EXISTS idx_pbd_ical_product
  ON property_blocked_dates (property_id, source)
  WHERE source = 'ical_sync';

COMMENT ON COLUMN property_blocked_dates.source IS
  'Origem do bloqueio: manual (host) ou ical_sync (importacao automatica de calendario externo)';

COMMENT ON COLUMN property_blocked_dates.source_ref IS
  'UUID da property_ical_sources que gerou este bloqueio. NULL para bloqueios manuais.';
