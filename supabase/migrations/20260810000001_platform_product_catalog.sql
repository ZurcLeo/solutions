-- =============================================================================
-- ELOS-BE-004: Platform Product Catalog (GTIN / EAN / UPC)
-- Catálogo canônico de produtos por código de barras.
-- Dados identidade + físicos SOMENTE — nunca preço, estoque ou imagens do seller.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. platform_product_catalog — catálogo canônico por GTIN
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_product_catalog (
  gtin               TEXT PRIMARY KEY,           -- EAN-8, EAN-13, UPC-A etc.
  name               TEXT NOT NULL,
  brand              TEXT,
  ncm                TEXT,                       -- ALWAYS 8-char string (padStart), e.g. '07133399'
  image_url          TEXT,                       -- Internal Storage URL (never OSCBR hotlink)
  weight_kg          NUMERIC(10,3),
  dimensions_cm      JSONB,                      -- {length, width, height} — SAME shape as marketplace_products
  attributes         JSONB DEFAULT '{}'::jsonb,  -- categoria_oscbr, pais, ean_tipo etc.
  confirmations_count INTEGER DEFAULT 0,
  verified           BOOLEAN DEFAULT false,      -- true when confirmations_count >= 3
  source             TEXT NOT NULL CHECK (source IN ('oscbr', 'merchant')),
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- Documenta simetria intencional de shape com marketplace_products
COMMENT ON COLUMN platform_product_catalog.dimensions_cm IS
  'JSONB {length, width, height} in cm — intentionally same shape as marketplace_products.dimensions_cm for zero-translation autofill';

COMMENT ON COLUMN platform_product_catalog.ncm IS
  'Nomenclatura Comum do Mercosul — ALWAYS stored as 8-char zero-padded string (e.g. 07133399)';

-- updated_at trigger (reusa trg_fn_set_updated_at existente)
CREATE TRIGGER trg_platform_product_catalog_updated_at
  BEFORE UPDATE ON platform_product_catalog
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS para platform_product_catalog
-- ---------------------------------------------------------------------------

ALTER TABLE platform_product_catalog ENABLE ROW LEVEL SECURITY;

-- Todos os autenticados podem ler o catálogo
CREATE POLICY "Authenticated read catalog"
  ON platform_product_catalog FOR SELECT
  TO authenticated
  USING (true);

-- Apenas service_role escreve (backend gerencia via service key)
CREATE POLICY "Service write catalog"
  ON platform_product_catalog FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service update catalog"
  ON platform_product_catalog FOR UPDATE
  TO service_role
  USING (true);

-- ---------------------------------------------------------------------------
-- 3. ALTER marketplace_products — adicionar coluna gtin
-- ---------------------------------------------------------------------------

ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS gtin TEXT;

-- NÃO é UNIQUE de propósito: vários vendedores podem listar o mesmo EAN
CREATE INDEX IF NOT EXISTS idx_marketplace_products_gtin
  ON marketplace_products (gtin)
  WHERE gtin IS NOT NULL;

COMMENT ON INDEX idx_marketplace_products_gtin IS
  'Non-unique by design: multiple sellers can list the same EAN/GTIN product';

-- ---------------------------------------------------------------------------
-- 4. Storage bucket para imagens do catálogo
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-catalog', 'product-catalog', true)
ON CONFLICT (id) DO NOTHING;

-- Qualquer pessoa pode ler imagens do catálogo
CREATE POLICY "Public read product-catalog"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-catalog');

-- Apenas service_role pode gravar (backend faz upload)
CREATE POLICY "Service write product-catalog"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-catalog' AND auth.role() = 'service_role');
