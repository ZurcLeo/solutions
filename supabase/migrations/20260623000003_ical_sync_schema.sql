-- ============================================================
-- Migration: 20260623000003_ical_sync_schema
-- Sincronizacao iCal para imoveis de temporada ElosCloud
--
-- Permite que sellers importem calendarios .ics de plataformas
-- externas (Airbnb, Booking, VRBO) e exportem o calendario
-- ElosCloud via token unico. Evita overbooking cross-platform.
--
-- Tabela: property_ical_sources (fontes de importacao)
-- ALTER: marketplace_products + ical_export_token
-- RLS: seller-only (sem acesso publico)
-- ============================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. property_ical_sources
--    Fontes iCal externas vinculadas a um imovel de temporada.
--    O cron de sync consulta registros is_active=true ordenados por last_synced_at
--    para decidir quais feeds precisam ser re-fetched.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_ical_sources (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vinculo com o imovel e o seller (TEXT PKs, padrao ElosCloud)
  product_id            TEXT NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
  seller_id             TEXT NOT NULL REFERENCES seller_profiles(id) ON DELETE CASCADE,

  -- Plataforma de origem: airbnb, booking, vrbo ou URL customizada
  source_name           TEXT NOT NULL
    CHECK (source_name IN ('airbnb', 'booking', 'vrbo', 'custom')),

  -- URL completa do feed .ics (ex: https://www.airbnb.com/calendar/ical/xxxx.ics)
  ical_url              TEXT NOT NULL,

  -- Controle de sync
  last_synced_at        TIMESTAMPTZ,          -- ultima vez que o cron processou com sucesso
  last_hash             TEXT,                 -- SHA-256 do conteudo .ics; skip sync se inalterado
  sync_status           TEXT NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('pending', 'ok', 'error')),
  sync_error            TEXT,                 -- mensagem do ultimo erro (null quando ok)
  consecutive_failures  INT NOT NULL DEFAULT 0,  -- alerta ao seller apos 3+ falhas consecutivas

  -- Intervalo de polling em minutos (default 30min, minimo 15)
  sync_interval_min     INT NOT NULL DEFAULT 30
    CHECK (sync_interval_min >= 15),

  -- Soft-toggle: seller pode pausar sync sem deletar
  is_active             BOOLEAN NOT NULL DEFAULT true,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Um imovel nao pode ter a mesma URL duplicada
  CONSTRAINT uq_product_ical_url UNIQUE (product_id, ical_url)
);

COMMENT ON TABLE property_ical_sources IS
  'Fontes iCal externas importadas por sellers de temporada. O cron faz polling periodico e bloqueia datas via property_blocked_dates.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Indices de performance
--    - seller_id: listagem "minhas fontes" no dashboard
--    - (is_active, last_synced_at): query do cron para encontrar feeds
--      ativos que precisam de re-sync (ORDER BY last_synced_at ASC NULLS FIRST)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ical_sources_seller
  ON property_ical_sources (seller_id);

CREATE INDEX IF NOT EXISTS idx_ical_sources_sync_cron
  ON property_ical_sources (is_active, last_synced_at ASC NULLS FIRST)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_ical_sources_product
  ON property_ical_sources (product_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Trigger: updated_at
--    Reutiliza trg_fn_set_updated_at() criada em 20260613000004_property_stays.
-- ──────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_ical_sources_updated_at ON property_ical_sources;
CREATE TRIGGER trg_ical_sources_updated_at
  BEFORE UPDATE ON property_ical_sources
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. ALTER marketplace_products: ical_export_token
--    Token opaco (gen_random_uuid) para gerar URL publica de exportacao .ics
--    do calendario ElosCloud (ex: /api/marketplace/imoveis/:id/calendar.ics?token=xxx).
--    Gerado sob demanda no backend quando o seller ativa a exportacao.
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE marketplace_products
  ADD COLUMN IF NOT EXISTS ical_export_token TEXT UNIQUE;

COMMENT ON COLUMN marketplace_products.ical_export_token IS
  'Token opaco para exportacao iCal publica. Gerado sob demanda pelo backend. NULL = exportacao inativa.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. RLS — Row Level Security
--    Acesso restrito ao seller dono do imovel. Sem acesso publico.
--    O backend (service role) faz o sync via cron sem passar por RLS.
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE property_ical_sources ENABLE ROW LEVEL SECURITY;

-- Seller pode ver suas proprias fontes iCal
CREATE POLICY "ical_src_seller_select" ON property_ical_sources
  FOR SELECT
  USING (seller_id = auth.uid()::text);

-- Seller pode adicionar fontes iCal aos seus imoveis
CREATE POLICY "ical_src_seller_insert" ON property_ical_sources
  FOR INSERT
  WITH CHECK (seller_id = auth.uid()::text);

-- Seller pode atualizar suas fontes (pausar, trocar URL, etc.)
CREATE POLICY "ical_src_seller_update" ON property_ical_sources
  FOR UPDATE
  USING (seller_id = auth.uid()::text)
  WITH CHECK (seller_id = auth.uid()::text);

-- Seller pode remover fontes iCal
CREATE POLICY "ical_src_seller_delete" ON property_ical_sources
  FOR DELETE
  USING (seller_id = auth.uid()::text);
