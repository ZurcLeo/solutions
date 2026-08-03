-- =============================================================================
-- MARKETPLACE: PRODUCT TYPES + MENU CATEGORIES + PRODUCT MODIFIERS
-- Ticket: MKTPLACE-PRODTYPE-001
-- Adds: product_type_enum, menu_categories, product_modifiers,
--       type-specific columns on marketplace_products, DB trigger guard
-- Zero-downtime: ADD COLUMN (nullable) + new tables + trigger
-- =============================================================================

-- 1. Enum de tipo de produto
CREATE TYPE product_type_enum AS ENUM (
  'food_item',        -- item de cardápio (alimentação)
  'service',          -- serviço agendável
  'physical_product', -- produto com estoque/peso
  'property'          -- imóvel (já existente via property_details)
);

-- 2. Categorias de cardápio (por vendedor — diferente de marketplace_categories)
--    Ex.: "Entradas", "Pratos Principais", "Sobremesas", "Bebidas"
CREATE TABLE menu_categories (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seller_id   text REFERENCES seller_profiles(id) ON DELETE CASCADE NOT NULL,
  name        text NOT NULL,
  description text,
  sort_order  int  DEFAULT 0,
  active      boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_menu_categories_seller ON menu_categories(seller_id);

-- RLS
ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mc_read_active" ON menu_categories
  FOR SELECT USING (active = true);

CREATE POLICY "mc_write_own" ON menu_categories
  USING (
    seller_id IN (
      SELECT id FROM seller_profiles WHERE user_id = auth.uid()::text
    )
  );

-- 3. Modificadores de produto (customizações de prato)
--    Ex.: "Sem cebola", "Queijo extra (+R$2,00)", "Trocar pão por integral"
CREATE TABLE product_modifiers (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id     text REFERENCES marketplace_products(id) ON DELETE CASCADE NOT NULL,
  group_name     text NOT NULL,       -- 'Retiradas', 'Adicionais', 'Substituições'
  modifier_type  text NOT NULL CHECK (modifier_type IN ('exclusion','addition','substitution')),
  label          text NOT NULL,       -- 'Sem cebola', 'Queijo extra', 'Pão integral'
  price_delta    numeric DEFAULT 0,   -- <0 = desconto, >0 = adicional, 0 = grátis
  is_required    boolean DEFAULT false,
  max_selections int DEFAULT 1,       -- max de opções selecionáveis no grupo
  sort_order     int DEFAULT 0,
  active         boolean DEFAULT true
);

CREATE INDEX idx_product_modifiers_product ON product_modifiers(product_id);

-- RLS
ALTER TABLE product_modifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pm_read_active" ON product_modifiers
  FOR SELECT
  USING (
    product_id IN (
      SELECT id FROM marketplace_products WHERE active = true
    )
  );

CREATE POLICY "pm_write_own" ON product_modifiers
  USING (
    product_id IN (
      SELECT p.id
        FROM marketplace_products p
        JOIN seller_profiles s ON s.id = p.seller_id
       WHERE s.user_id = auth.uid()::text
    )
  );

-- 4. Expand marketplace_products com colunas por tipo
ALTER TABLE marketplace_products
  -- Tipo do produto (drive da lógica de validação)
  ADD COLUMN IF NOT EXISTS product_type         product_type_enum,
  -- Alimentação
  ADD COLUMN IF NOT EXISTS menu_category_id     text REFERENCES menu_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prep_time_min        int,          -- tempo de preparo em minutos
  ADD COLUMN IF NOT EXISTS serves               int,          -- porção para N pessoas
  ADD COLUMN IF NOT EXISTS allergens            text[],       -- ['gluten','lactose','amendoim',...]
  ADD COLUMN IF NOT EXISTS is_available_now     boolean DEFAULT true,
  -- Produtos físicos
  ADD COLUMN IF NOT EXISTS weight_kg            numeric,      -- peso em kg
  ADD COLUMN IF NOT EXISTS dimensions_cm        jsonb,        -- {length, width, height}
  ADD COLUMN IF NOT EXISTS sku                  text,         -- código do produto
  ADD COLUMN IF NOT EXISTS unit_of_measure      text;         -- 'un', 'kg', 'm²', 'm', 'L', 'cx'

-- Deduzir product_type a partir de dados existentes (retrocompatibilidade)
-- Produtos com property_details → property
-- Produtos com duration_minutes (booking) → service
-- Produtos em sellers de alimentação → food_item
-- Demais → physical_product
UPDATE marketplace_products mp
SET product_type = CASE
  WHEN mp.property_details IS NOT NULL            THEN 'property'::product_type_enum
  WHEN mp.duration_minutes IS NOT NULL            THEN 'service'::product_type_enum
  WHEN sp.category = 'alimentacao'                THEN 'food_item'::product_type_enum
  ELSE                                                 'physical_product'::product_type_enum
END
FROM seller_profiles sp
WHERE sp.id = mp.seller_id
  AND mp.product_type IS NULL;

-- Agora pode ser NOT NULL (após popular os existentes)
ALTER TABLE marketplace_products
  ALTER COLUMN product_type SET DEFAULT 'physical_product',
  ALTER COLUMN product_type SET NOT NULL;

-- Índices
CREATE INDEX IF NOT EXISTS idx_mp_product_type         ON marketplace_products(product_type);
CREATE INDEX IF NOT EXISTS idx_mp_product_seller_type  ON marketplace_products(seller_id, product_type);
CREATE INDEX IF NOT EXISTS idx_mp_menu_category        ON marketplace_products(menu_category_id);

-- 5. TRIGGER: Type Guard — impede campos inválidos por tipo
CREATE OR REPLACE FUNCTION validate_product_type_guard()
RETURNS TRIGGER AS $$
BEGIN
  -- Serviço: sem peso, sem estoque, sem dimensões
  IF NEW.product_type = 'service' THEN
    IF NEW.weight_kg IS NOT NULL THEN
      RAISE EXCEPTION '[TYPE_GUARD] Serviço não pode ter peso (weight_kg). Use duration_minutes para indicar a duração.';
    END IF;
    IF NEW.dimensions_cm IS NOT NULL THEN
      RAISE EXCEPTION '[TYPE_GUARD] Serviço não pode ter dimensões físicas.';
    END IF;
    -- Força scheduling_required implícito (não há coluna, mas duration_minutes sinaliza)
  END IF;

  -- Item de cardápio: sem peso, sem dimensões, sem SKU
  IF NEW.product_type = 'food_item' THEN
    IF NEW.weight_kg IS NOT NULL THEN
      RAISE EXCEPTION '[TYPE_GUARD] Item de cardápio não tem peso. Use "serves" para indicar porção.';
    END IF;
    IF NEW.dimensions_cm IS NOT NULL THEN
      RAISE EXCEPTION '[TYPE_GUARD] Item de cardápio não tem dimensões físicas.';
    END IF;
    IF NEW.sku IS NOT NULL THEN
      RAISE EXCEPTION '[TYPE_GUARD] Item de cardápio não tem SKU. Use o ID do produto como referência.';
    END IF;
  END IF;

  -- Produto físico: peso obrigatório
  IF NEW.product_type = 'physical_product' THEN
    IF NEW.weight_kg IS NULL THEN
      RAISE EXCEPTION '[TYPE_GUARD] Produto físico deve informar o peso (weight_kg em kg).';
    END IF;
    IF NEW.prep_time_min IS NOT NULL THEN
      RAISE EXCEPTION '[TYPE_GUARD] Produto físico não tem tempo de preparo. Esse campo é exclusivo de itens de cardápio.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_product_type
  BEFORE INSERT OR UPDATE ON marketplace_products
  FOR EACH ROW EXECUTE FUNCTION validate_product_type_guard();

-- 6. RPC utilitária: cardápio completo do vendedor (categorias + itens + modifiers)
CREATE OR REPLACE FUNCTION get_seller_menu(p_seller_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'seller_id',  p_seller_id,
    'categories', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',          mc.id,
          'name',        mc.name,
          'description', mc.description,
          'sort_order',  mc.sort_order,
          'items',       COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id',               mp.id,
                'name',             mp.name,
                'description',      mp.description,
                'price_brl',        mp.price_brl,
                'prep_time_min',    mp.prep_time_min,
                'serves',           mp.serves,
                'allergens',        mp.allergens,
                'is_available_now', mp.is_available_now,
                'images',           mp.images,
                'max_coins_discount', mp.max_coins_discount,
                'modifiers',        COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'id',            pm.id,
                    'group_name',    pm.group_name,
                    'modifier_type', pm.modifier_type,
                    'label',         pm.label,
                    'price_delta',   pm.price_delta,
                    'is_required',   pm.is_required,
                    'max_selections',pm.max_selections,
                    'sort_order',    pm.sort_order
                  ) ORDER BY pm.group_name, pm.sort_order)
                  FROM product_modifiers pm
                  WHERE pm.product_id = mp.id AND pm.active = true
                ), '[]'::jsonb)
              ) ORDER BY mp.name
            )
            FROM marketplace_products mp
            WHERE mp.menu_category_id = mc.id
              AND mp.active = true
              AND mp.product_type = 'food_item'
          ), '[]'::jsonb)
        ) ORDER BY mc.sort_order, mc.name
      )
      FROM menu_categories mc
      WHERE mc.seller_id = p_seller_id AND mc.active = true
    ), '[]'::jsonb),
    -- Itens sem categoria (sem_categoria)
    'uncategorized', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',               mp.id,
        'name',             mp.name,
        'description',      mp.description,
        'price_brl',        mp.price_brl,
        'prep_time_min',    mp.prep_time_min,
        'serves',           mp.serves,
        'allergens',        mp.allergens,
        'is_available_now', mp.is_available_now,
        'images',           mp.images
      ) ORDER BY mp.name)
      FROM marketplace_products mp
      WHERE mp.seller_id = p_seller_id
        AND mp.menu_category_id IS NULL
        AND mp.active = true
        AND mp.product_type = 'food_item'
    ), '[]'::jsonb)
  );
$$;

COMMENT ON TABLE menu_categories IS 'Categorias do cardápio por vendedor (Entradas, Pratos, Bebidas...) — diferente de marketplace_categories que é taxonomia da plataforma';
COMMENT ON TABLE product_modifiers IS 'Customizações de item de cardápio (sem cebola, queijo extra...) — armazenadas separado para CRUD independente; pedidos guardam snapshot JSONB';
COMMENT ON COLUMN marketplace_products.product_type IS 'Tipo do produto: food_item | service | physical_product | property — determina quais campos são válidos';
COMMENT ON COLUMN marketplace_products.prep_time_min IS 'Tempo de preparo em minutos (exclusivo food_item)';
COMMENT ON COLUMN marketplace_products.serves IS 'Porção para N pessoas (exclusivo food_item)';
COMMENT ON COLUMN marketplace_products.allergens IS 'Alergênicos presentes: gluten, lactose, amendoim, etc. (exclusivo food_item)';
COMMENT ON COLUMN marketplace_products.weight_kg IS 'Peso em kg (exclusivo physical_product)';
COMMENT ON COLUMN marketplace_products.dimensions_cm IS 'Dimensões físicas JSON {length, width, height} em cm (exclusivo physical_product)';
COMMENT ON COLUMN marketplace_products.sku IS 'Código do produto / código de barras (exclusivo physical_product)';
COMMENT ON COLUMN marketplace_products.unit_of_measure IS 'Unidade de medida: un, kg, m², m, L, cx (exclusivo physical_product)';
