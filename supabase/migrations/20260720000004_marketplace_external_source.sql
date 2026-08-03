-- =============================================================================
-- MARKETPLACE: External Source Fields for ML->Elos Product Sync
-- Ticket: B1 — ML Integration
-- Adds: source, external_id, external_account_id columns on marketplace_products,
--       partial unique index, upsert_external_product RPC
-- Zero-downtime: ADD COLUMN (nullable/default) + new index + new function
-- =============================================================================

-- Campos de origem externa para sincronizacao ML->Elos
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'native';
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS external_account_id TEXT;

COMMENT ON COLUMN marketplace_products.source IS 'Origem do produto: native (criado na Elos), ml (Mercado Livre), etc.';
COMMENT ON COLUMN marketplace_products.external_id IS 'ID do produto na plataforma externa (ex: MLB1234567890)';
COMMENT ON COLUMN marketplace_products.external_account_id IS 'ID da conta externa vinculada (ex: seller_id do ML)';

-- Indice parcial: garante unicidade por (seller_id, external_id) para produtos externos.
-- Produtos nativos (external_id IS NULL) ficam fora do indice -- sem restricao.
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_products_external
    ON marketplace_products (seller_id, external_id)
    WHERE external_id IS NOT NULL;

-- RPC para upsert de produto externo (usado pelo B2 import)
CREATE OR REPLACE FUNCTION upsert_external_product(
    p_seller_id TEXT,
    p_source TEXT,
    p_external_id TEXT,
    p_external_account_id TEXT,
    p_name TEXT,
    p_description TEXT,
    p_price_brl NUMERIC,
    p_category TEXT,
    p_product_type product_type_enum,
    p_stock INTEGER,
    p_images TEXT[],
    p_weight_kg NUMERIC,
    p_dimensions_cm JSONB,
    p_sku TEXT
) RETURNS TABLE(id TEXT, was_inserted BOOLEAN) AS $$
BEGIN
    RETURN QUERY
    INSERT INTO marketplace_products (
        id, seller_id, source, external_id, external_account_id,
        name, description, price_brl, category, product_type,
        stock, images, weight_kg, dimensions_cm, sku,
        active, updated_at
    ) VALUES (
        gen_random_uuid()::TEXT, p_seller_id, p_source, p_external_id, p_external_account_id,
        p_name, p_description, p_price_brl, p_category, p_product_type,
        p_stock, p_images, p_weight_kg, p_dimensions_cm, p_sku,
        true, NOW()
    )
    ON CONFLICT (seller_id, external_id) WHERE external_id IS NOT NULL
    DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        price_brl = EXCLUDED.price_brl,
        category = EXCLUDED.category,
        product_type = EXCLUDED.product_type,
        stock = EXCLUDED.stock,
        images = EXCLUDED.images,
        weight_kg = EXCLUDED.weight_kg,
        dimensions_cm = EXCLUDED.dimensions_cm,
        sku = EXCLUDED.sku,
        external_account_id = EXCLUDED.external_account_id,
        active = true,
        updated_at = NOW()
    RETURNING marketplace_products.id, (xmax = 0) AS was_inserted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION upsert_external_product IS 'Upsert atomico de produto externo via partial unique index. Retorna id + was_inserted (true=INSERT, false=UPDATE). Usado pelo endpoint B2 import.';
