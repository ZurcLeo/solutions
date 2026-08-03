-- ============================================================
-- GP-1: Google Places Integration — seller_profiles enrichment
-- ============================================================
-- Adiciona colunas para vincular vendedores a estabelecimentos
-- do Google Places, capturando rating, reviews e status.
-- Resolve cold start de reputação: seller com 4.8★ no Google
-- já entra com credibilidade visível na ElosCloud.
-- ============================================================

-- 1. Colunas Google Places em seller_profiles
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS google_place_id            TEXT,
  ADD COLUMN IF NOT EXISTS google_rating              NUMERIC(2,1),
  ADD COLUMN IF NOT EXISTS google_reviews_count        INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS google_business_name        TEXT,
  ADD COLUMN IF NOT EXISTS google_url                  TEXT,
  ADD COLUMN IF NOT EXISTS google_business_status      TEXT,
  ADD COLUMN IF NOT EXISTS google_photo_reference      TEXT,
  ADD COLUMN IF NOT EXISTS google_places_synced_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS google_place_linked_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS google_place_linked_by      TEXT;

-- 2. Partial unique index — um place_id por seller (nullable ok)
CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_profiles_google_place_id
  ON public.seller_profiles (google_place_id)
  WHERE google_place_id IS NOT NULL;

-- 3. CHECK constraints
ALTER TABLE public.seller_profiles
  ADD CONSTRAINT seller_profiles_google_status_check
  CHECK (
    google_business_status IS NULL
    OR google_business_status IN ('OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY')
  );

ALTER TABLE public.seller_profiles
  ADD CONSTRAINT seller_profiles_google_linked_by_check
  CHECK (
    google_place_linked_by IS NULL
    OR google_place_linked_by IN ('auto_confirm', 'manual_search', 'admin')
  );

-- 4. Índice para buscar sellers com Places vinculado (sync batch)
CREATE INDEX IF NOT EXISTS idx_seller_profiles_google_synced_at
  ON public.seller_profiles (google_places_synced_at)
  WHERE google_place_id IS NOT NULL;

-- 5. RLS: as colunas google_* são públicas (leitura), sem restrição extra.
--    A política existente de seller_profiles (select: authenticated) já cobre.
--    Escrita: apenas o próprio user_id pode vincular (enforced pelo service layer).

COMMENT ON COLUMN public.seller_profiles.google_place_id IS 'Google Places API place_id — identificador único do estabelecimento no Google';
COMMENT ON COLUMN public.seller_profiles.google_rating IS 'Nota média no Google (1.0–5.0, 1 decimal)';
COMMENT ON COLUMN public.seller_profiles.google_reviews_count IS 'Total de avaliações no Google';
COMMENT ON COLUMN public.seller_profiles.google_business_name IS 'Nome do negócio conforme Google Places';
COMMENT ON COLUMN public.seller_profiles.google_url IS 'URL do Google Maps para o estabelecimento';
COMMENT ON COLUMN public.seller_profiles.google_business_status IS 'Status: OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY';
COMMENT ON COLUMN public.seller_profiles.google_photo_reference IS 'Referência da foto principal no Google Places (para Photo API)';
COMMENT ON COLUMN public.seller_profiles.google_places_synced_at IS 'Último sync de dados do Google Places';
COMMENT ON COLUMN public.seller_profiles.google_place_linked_at IS 'Quando o seller confirmou a vinculação';
COMMENT ON COLUMN public.seller_profiles.google_place_linked_by IS 'Método: auto_confirm (seller clicou Sim), manual_search (buscou), admin (admin vinculou)';
