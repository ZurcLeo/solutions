-- =============================================================================
-- MIGRATION: Product Variants (ELOS-BE-014 Wave 1)
-- Ticket: ELOS-BE-014
--
-- Adds:
--   1. ALTER marketplace_products + variant_attributes JSONB (eixos declarados)
--   2. CREATE TABLE product_variants (SKU/estoque/preço por combinação)
--   3. TRIGGER validate_variant_attributes (keys ⊆ eixos do produto-pai)
--   4. RPC decrement_variant_stock (all-or-nothing atômico)
--   5. RPC restore_variant_stock (compensação para cancelamento)
--   6. Indices + RLS
--
-- Distinção explícita:
--   - product_variants = SKU/estoque/preço por combinação (cor×tamanho)
--   - product_modifiers = add-ons/montagem com price_delta (FEAT-012, independente)
--   - Podem coexistir no mesmo produto (ex: marmita G + escolha de mistura)
--
-- Zero-downtime: ADD COLUMN nullable + new table + trigger + RPCs
-- Depende de: marketplace_products(id), seller_profiles(id)
-- Autor: marketplace-agent (ElosCloud)
-- Data: 2026-08-11
-- =============================================================================


-- =====================================================
-- 1. ALTER marketplace_products — eixos de variação
-- =====================================================
-- Array de strings declarando os eixos, ex: ["cor","tamanho"]
-- NULL = produto SEM variantes (comportamento atual inalterado)
ALTER TABLE marketplace_products
  ADD COLUMN IF NOT EXISTS variant_attributes JSONB DEFAULT NULL;

COMMENT ON COLUMN marketplace_products.variant_attributes IS
  'Array de strings com os eixos de variação, ex: ["cor","tamanho"]. NULL = produto sem variantes.';


-- =====================================================
-- 2. CREATE TABLE product_variants
-- =====================================================
CREATE TABLE product_variants (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id     TEXT NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
  attributes     JSONB NOT NULL,                          -- ex: {"cor":"rosa","tamanho":"M"}
  sku            TEXT,                                     -- código interno do vendedor
  gtin           TEXT,                                     -- EAN específico por variante (nullable)
  stock          INTEGER NOT NULL DEFAULT 0,
  price_override NUMERIC(10,2),                            -- NULL = usa price_brl do produto
  image_url      TEXT,                                     -- foto específica da variante (nullable)
  is_available   BOOLEAN NOT NULL DEFAULT true,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- UNIQUE: normalizar keys em ordem alfabética ANTES do INSERT/UPDATE (no service)
-- O trigger também normaliza, mas a constraint precisa de JSONB operator ->>
-- Usamos UNIQUE funcional via índice abaixo
CREATE UNIQUE INDEX idx_product_variants_unique_attrs
  ON product_variants (product_id, (attributes::text));

-- Índices de consulta
CREATE INDEX idx_product_variants_product_available
  ON product_variants (product_id, is_available)
  WHERE is_available = true;

CREATE INDEX idx_product_variants_product_sort
  ON product_variants (product_id, sort_order);

CREATE INDEX idx_product_variants_sku
  ON product_variants (sku)
  WHERE sku IS NOT NULL;

COMMENT ON TABLE product_variants IS
  'Variantes de produto (cor, tamanho, etc.) com SKU/estoque/preço próprios. Independente de product_modifiers.';


-- =====================================================
-- 3. TRIGGER: validate_variant_attributes
-- =====================================================
-- ANTES de INSERT/UPDATE em product_variants:
--   a) Valida que o produto-pai tem variant_attributes definido (NOT NULL)
--   b) Valida que TODAS as keys do attributes JSONB existem no variant_attributes do produto-pai
--   c) Normaliza attributes (ordena keys alfabeticamente)
--   d) Atualiza updated_at

CREATE OR REPLACE FUNCTION validate_variant_attributes()
RETURNS TRIGGER AS $$
DECLARE
  v_product_axes   JSONB;
  v_attr_keys      TEXT[];
  v_axes_arr       TEXT[];
  v_missing_key    TEXT;
  v_sorted_attrs   JSONB;
  v_key            TEXT;
BEGIN
  -- Buscar os eixos declarados no produto-pai
  SELECT variant_attributes INTO v_product_axes
    FROM marketplace_products
   WHERE id = NEW.product_id;

  -- Produto DEVE ter variant_attributes definido
  IF v_product_axes IS NULL THEN
    RAISE EXCEPTION '[VARIANT_GUARD] Produto % não possui variant_attributes definido. Defina os eixos antes de criar variantes.',
      NEW.product_id;
  END IF;

  -- variant_attributes deve ser um array JSON não-vazio
  IF jsonb_typeof(v_product_axes) != 'array' OR jsonb_array_length(v_product_axes) = 0 THEN
    RAISE EXCEPTION '[VARIANT_GUARD] variant_attributes do produto % deve ser um array não-vazio de strings.',
      NEW.product_id;
  END IF;

  -- Extrair eixos como array de text
  SELECT array_agg(elem::text)
    INTO v_axes_arr
    FROM jsonb_array_elements_text(v_product_axes) AS elem;

  -- Extrair keys dos attributes da variante
  SELECT array_agg(k ORDER BY k)
    INTO v_attr_keys
    FROM jsonb_object_keys(NEW.attributes) AS k;

  -- attributes não pode ser vazio
  IF v_attr_keys IS NULL OR array_length(v_attr_keys, 1) = 0 THEN
    RAISE EXCEPTION '[VARIANT_GUARD] attributes da variante não pode ser vazio.';
  END IF;

  -- Validar que TODAS as keys existem nos eixos declarados
  FOREACH v_missing_key IN ARRAY v_attr_keys
  LOOP
    IF NOT (v_missing_key = ANY(v_axes_arr)) THEN
      RAISE EXCEPTION '[VARIANT_GUARD] Atributo "%" não é um eixo declarado no produto. Eixos válidos: %',
        v_missing_key, v_axes_arr;
    END IF;
  END LOOP;

  -- Validar que TODOS os eixos estão presentes nos attributes (cobertura completa)
  FOREACH v_key IN ARRAY v_axes_arr
  LOOP
    IF NOT (v_key = ANY(v_attr_keys)) THEN
      RAISE EXCEPTION '[VARIANT_GUARD] Eixo "%" declarado no produto mas ausente nos attributes da variante. Todos os eixos devem estar presentes.',
        v_key;
    END IF;
  END LOOP;

  -- Normalizar: ordenar keys alfabeticamente
  SELECT jsonb_object_agg(k, NEW.attributes -> k ORDER BY k)
    INTO v_sorted_attrs
    FROM unnest(v_attr_keys) AS k;

  NEW.attributes := v_sorted_attrs;

  -- Atualizar updated_at
  NEW.updated_at := now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_variant_attributes
  BEFORE INSERT OR UPDATE ON product_variants
  FOR EACH ROW
  EXECUTE FUNCTION validate_variant_attributes();


-- =====================================================
-- 4. RPC: decrement_variant_stock (all-or-nothing)
-- =====================================================
-- Recebe: [{"variant_id":"...", "qty":2}, ...]
-- ALL-OR-NOTHING: se QUALQUER item tiver stock < qty → ROLLBACK tudo
-- Retorna: JSON array com [{variant_id, new_stock}]

CREATE OR REPLACE FUNCTION decrement_variant_stock(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item       JSONB;
  v_variant_id TEXT;
  v_qty        INTEGER;
  v_new_stock  INTEGER;
  v_result     JSONB := '[]'::jsonb;
BEGIN
  -- Validar input
  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '[STOCK] p_items deve ser um array JSON não-vazio de {variant_id, qty}.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_variant_id := v_item ->> 'variant_id';
    v_qty        := (v_item ->> 'qty')::integer;

    IF v_variant_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION '[STOCK] Item inválido: variant_id e qty (>0) são obrigatórios. Recebido: %', v_item;
    END IF;

    -- Tentar decrementar — WHERE stock >= qty garante não-negatividade
    UPDATE product_variants
       SET stock      = stock - v_qty,
           updated_at = now()
     WHERE id = v_variant_id
       AND stock >= v_qty
    RETURNING stock INTO v_new_stock;

    -- Se nenhuma row afetada → estoque insuficiente → ROLLBACK tudo
    IF NOT FOUND THEN
      RAISE EXCEPTION '[STOCK_INSUFFICIENT] Estoque insuficiente para variante %. Quantidade solicitada: %, estoque disponível insuficiente.',
        v_variant_id, v_qty;
    END IF;

    v_result := v_result || jsonb_build_object(
      'variant_id', v_variant_id,
      'new_stock', v_new_stock
    );
  END LOOP;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION decrement_variant_stock(JSONB) IS
  'Decrementa estoque de múltiplas variantes atomicamente. Se qualquer item falhar, rollback total.';


-- =====================================================
-- 5. RPC: restore_variant_stock (compensação)
-- =====================================================
-- Complemento para cancelamento/expiração de pedidos.
-- Recebe: [{"variant_id":"...", "qty":2}, ...]
-- Restaura estoque somando qty de volta.

CREATE OR REPLACE FUNCTION restore_variant_stock(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item       JSONB;
  v_variant_id TEXT;
  v_qty        INTEGER;
  v_new_stock  INTEGER;
  v_result     JSONB := '[]'::jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '[STOCK] p_items deve ser um array JSON não-vazio de {variant_id, qty}.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_variant_id := v_item ->> 'variant_id';
    v_qty        := (v_item ->> 'qty')::integer;

    IF v_variant_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION '[STOCK] Item inválido: variant_id e qty (>0) são obrigatórios. Recebido: %', v_item;
    END IF;

    UPDATE product_variants
       SET stock      = stock + v_qty,
           updated_at = now()
     WHERE id = v_variant_id
    RETURNING stock INTO v_new_stock;

    IF NOT FOUND THEN
      RAISE EXCEPTION '[STOCK] Variante % não encontrada para restaurar estoque.', v_variant_id;
    END IF;

    v_result := v_result || jsonb_build_object(
      'variant_id', v_variant_id,
      'new_stock', v_new_stock
    );
  END LOOP;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION restore_variant_stock(JSONB) IS
  'Restaura estoque de variantes após cancelamento/expiração. Complemento de decrement_variant_stock.';


-- =====================================================
-- 6. RLS — Row Level Security
-- =====================================================
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

-- SELECT: público para variantes disponíveis de produtos ativos
CREATE POLICY "pv_read_available" ON product_variants
  FOR SELECT
  USING (
    is_available = true
    AND product_id IN (
      SELECT id FROM marketplace_products WHERE active = true
    )
  );

-- SELECT: seller vê TODAS as suas variantes (inclusive indisponíveis)
CREATE POLICY "pv_read_own" ON product_variants
  FOR SELECT
  USING (
    product_id IN (
      SELECT p.id
        FROM marketplace_products p
        JOIN seller_profiles s ON s.id = p.seller_id
       WHERE s.user_id = auth.uid()::text
    )
  );

-- INSERT/UPDATE/DELETE: apenas seller dono do produto-pai
CREATE POLICY "pv_write_own" ON product_variants
  FOR ALL
  USING (
    product_id IN (
      SELECT p.id
        FROM marketplace_products p
        JOIN seller_profiles s ON s.id = p.seller_id
       WHERE s.user_id = auth.uid()::text
    )
  );


-- =====================================================
-- 7. Grants para service_role e authenticated
-- =====================================================
-- service_role já tem acesso total via bypass RLS
-- authenticated precisa SELECT + INSERT + UPDATE + DELETE via RLS policies acima
GRANT SELECT, INSERT, UPDATE, DELETE ON product_variants TO authenticated;

-- RPCs executáveis por service_role (backend usa service_role key)
-- SECURITY DEFINER já garante execução privilegiada
GRANT EXECUTE ON FUNCTION decrement_variant_stock(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION restore_variant_stock(JSONB) TO service_role;
