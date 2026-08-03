-- ============================================================
-- S1: Multi-categoria + Monetização Brasileirinho + Subtipos + Utilidades
-- Ticket: S1-MULTI-CAT-001
-- Migration: 20260617000003
--
-- DECISÕES APROVADAS (sign-off 2026-06-17):
--   D1: Multi-categoria por padrão (categories[] em seller_profiles)
--   D2: Comissão sobre total_brl (BRL efetivo, excluindo desconto ElosCoins)
--   D3: 7 dias de graça para assinatura vencida do Brasileirinho
--   D4: Comprador escolhe entregador no split (com teto do vendedor)
--   D5: Cold-start entregador: badge "Novo" + top-3 boost (30d ou 10 entregas)
--
-- AJUSTES [TRAVAR] INCORPORADOS:
--   T1: product_type autoritativo por item — já enforçado pelo TYPE GUARD trigger
--       (20260612000002). Nenhuma alteração necessária.
--   T2: freight_split_seller_cap_brl — teto do vendedor no freight_mode=split
--   T3: NUMERIC(10,2) mantido (não integer cents) + funções de arredondamento
--       sem coerção float. Pushback aceito: NUMERIC é aritmética de precisão
--       fixa no PostgreSQL — o risco de IEEE 754 não se aplica.
--   T4: categories como seller_category_enum[] (não text[] livre)
--   T5: primary_category com constraint NOT VALID + VALIDATE
--
-- ============================================================
-- CONVENÇÃO DE ARREDONDAMENTO (enforçada no código, documentada aqui):
--
--   1. Carregar precisão NUMERIC plena em TODOS os passos intermediários.
--   2. Arredondar UMA VEZ, na fronteira de cobrança (capture/invoice/ledger).
--   3. Usar round_brl() (HALF_EVEN) ou round_half_up_brl() (HALF_UP).
--   4. NÃO arredondar por item e depois somar — somar primeiro, arredondar
--      o total uma vez.
--
--   Exemplo correto:
--     commission_brl = round_brl(total_brl * commission_rate)
--
--   Exemplo ERRADO:
--     item_commission = round_brl(item_price * rate)  -- NÃO
--     total_commission = SUM(item_commission)          -- diverge em centavos
-- ============================================================
--
-- Depende de: 20260524000001 (marketplace_schema),
--             20260611000001 (seller_store_type_cleanup),
--             20260612000001 (seller_subtypes),
--             20260610000001 (delivery_schema)
--
-- Agente: marketplace-agent | Revisado por: produto (Léo, 2026-06-17)
-- ============================================================


-- ============================================================
-- 1. FUNÇÕES DE ARREDONDAMENTO
-- ============================================================

-- round_brl: usa ROUND() nativo do PostgreSQL (banker's rounding = HALF_EVEN).
-- Toda a computação fica em NUMERIC — nenhuma coerção a double precision.
CREATE OR REPLACE FUNCTION public.round_brl(val NUMERIC)
  RETURNS NUMERIC
  LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT ROUND(val, 2);
$$;

COMMENT ON FUNCTION public.round_brl(NUMERIC) IS
  '[S1] Arredondamento BRL (HALF_EVEN / banker''s rounding). '
  'Usar na fronteira de cobrança — nunca em passos intermediários.';


-- round_half_up_brl: HALF_UP (0.005 → 0.01), exigido por algumas regras fiscais.
-- ATENÇÃO: usa 10::numeric (não POWER) para manter toda a aritmética em NUMERIC.
-- POWER(10, dp) resolve para double precision — introduz float no meio do cálculo.
-- O operador ^ sobre numeric retorna numeric; a função inteira fica exata.
CREATE OR REPLACE FUNCTION public.round_half_up_brl(val NUMERIC)
  RETURNS NUMERIC
  LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT FLOOR(val * (10::numeric ^ 2) + 0.5::numeric) / (10::numeric ^ 2);
$$;

COMMENT ON FUNCTION public.round_half_up_brl(NUMERIC) IS
  '[S1] Arredondamento BRL com HALF_UP (sem coerção float). '
  'Usa 10::numeric^2 em vez de POWER(10,2) para evitar double precision intermediário.';


-- ============================================================
-- 2. ENUM DE CATEGORIAS DO VENDEDOR
-- ============================================================
-- 4 categorias aprovadas. 'outros' da base legada é mapeado para 'produtos'
-- no backfill (seção 5). Não incluímos 'outros' no enum porque queremos
-- forçar categorização explícita daqui em diante.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE seller_category_enum AS ENUM (
    'alimentacao',
    'servicos',
    'produtos',
    'imoveis'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================
-- 3. seller_profiles — NOVAS COLUNAS
-- ============================================================

-- 3a. Multi-categoria + primary_category
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS categories       seller_category_enum[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS primary_category  seller_category_enum;

-- 3b. Monetização Brasileirinho (D3: 7 dias de graça)
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS billing_mode                TEXT NOT NULL DEFAULT 'per_transaction',
  ADD COLUMN IF NOT EXISTS subscription_status         TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS subscription_expires_at     TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS subscription_grace_until    TIMESTAMPTZ DEFAULT NULL;

-- 3c. Split de frete (D4: comprador escolhe, vendedor tem teto)
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS freight_split_buyer_pct     INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS freight_split_seller_cap_brl NUMERIC(10,2) DEFAULT NULL;


-- ============================================================
-- 4. CONSTRAINTS NOMEADAS (seller_profiles)
-- ============================================================

-- billing_mode: per_transaction ou subscription
ALTER TABLE public.seller_profiles
  ADD CONSTRAINT chk_sp_billing_mode
  CHECK (billing_mode IN ('per_transaction', 'subscription'));

-- subscription_status: enum de estados ou NULL (sem assinatura)
ALTER TABLE public.seller_profiles
  ADD CONSTRAINT chk_sp_subscription_status
  CHECK (subscription_status IS NULL
    OR subscription_status IN ('active', 'grace_period', 'expired'));

-- grace_until sempre posterior a expires_at (quando ambos definidos)
ALTER TABLE public.seller_profiles
  ADD CONSTRAINT chk_sp_grace_after_expiry
  CHECK (subscription_grace_until IS NULL
    OR subscription_expires_at IS NULL
    OR subscription_grace_until > subscription_expires_at);

-- freight split: 0-100%
ALTER TABLE public.seller_profiles
  ADD CONSTRAINT chk_sp_freight_split_pct
  CHECK (freight_split_buyer_pct >= 0 AND freight_split_buyer_pct <= 100);

-- teto do vendedor no split: não-negativo quando definido
ALTER TABLE public.seller_profiles
  ADD CONSTRAINT chk_sp_freight_cap_nonneg
  CHECK (freight_split_seller_cap_brl IS NULL OR freight_split_seller_cap_brl >= 0);


-- ============================================================
-- 5. BACKFILL: category TEXT → categories[] + primary_category
-- ============================================================
-- Mapeamento:
--   'alimentacao' → ['alimentacao']
--   'servicos'    → ['servicos']
--   'produtos'    → ['produtos']
--   'imoveis'     → ['imoveis']
--   'outros'      → ['produtos']   (catch-all legado)
--   'obra'        → ['servicos']   (defensivo — já removido em 20260611000001)
--   'evento'      → ['servicos']   (defensivo — já removido em 20260611000001)
--
-- WHERE: só preenche linhas ainda não migradas (idempotente)
-- ============================================================

UPDATE public.seller_profiles SET
  categories = CASE category
    WHEN 'alimentacao' THEN ARRAY['alimentacao']::seller_category_enum[]
    WHEN 'servicos'    THEN ARRAY['servicos']::seller_category_enum[]
    WHEN 'produtos'    THEN ARRAY['produtos']::seller_category_enum[]
    WHEN 'imoveis'     THEN ARRAY['imoveis']::seller_category_enum[]
    WHEN 'outros'      THEN ARRAY['produtos']::seller_category_enum[]
    WHEN 'obra'        THEN ARRAY['servicos']::seller_category_enum[]
    WHEN 'evento'      THEN ARRAY['servicos']::seller_category_enum[]
    ELSE                    ARRAY['produtos']::seller_category_enum[]
  END,
  primary_category = CASE category
    WHEN 'alimentacao' THEN 'alimentacao'::seller_category_enum
    WHEN 'servicos'    THEN 'servicos'::seller_category_enum
    WHEN 'produtos'    THEN 'produtos'::seller_category_enum
    WHEN 'imoveis'     THEN 'imoveis'::seller_category_enum
    WHEN 'outros'      THEN 'produtos'::seller_category_enum
    WHEN 'obra'        THEN 'servicos'::seller_category_enum
    WHEN 'evento'      THEN 'servicos'::seller_category_enum
    ELSE                    'produtos'::seller_category_enum
  END
WHERE categories = '{}' OR array_length(categories, 1) IS NULL;


-- ============================================================
-- 6. CONSTRAINT: primary_category ∈ categories
-- ============================================================
-- Usa NOT VALID + VALIDATE para zero-downtime e proteção contra
-- backfill incompleto (ponto levantado no sign-off item 4b).
--
-- A constraint permite categories='{}' + primary_category=NULL
-- (perfil em estado intermediário durante o wizard). Quando
-- categories tem elementos, primary_category DEVE estar entre eles.
-- ============================================================

ALTER TABLE public.seller_profiles
  ADD CONSTRAINT chk_sp_primary_in_categories
  CHECK (
    array_length(categories, 1) IS NULL   -- array vazio: wizard em andamento, OK
    OR primary_category = ANY(categories) -- preenchido: deve pertencer ao array
  ) NOT VALID;

ALTER TABLE public.seller_profiles
  VALIDATE CONSTRAINT chk_sp_primary_in_categories;


-- ============================================================
-- 7. delivery_services — MONETIZAÇÃO ESPELHADA
-- ============================================================

ALTER TABLE public.delivery_services
  ADD COLUMN IF NOT EXISTS billing_mode              TEXT NOT NULL DEFAULT 'per_transaction',
  ADD COLUMN IF NOT EXISTS subscription_status       TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS subscription_expires_at   TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS subscription_grace_until  TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE public.delivery_services
  ADD CONSTRAINT chk_ds_billing_mode
  CHECK (billing_mode IN ('per_transaction', 'subscription'));

ALTER TABLE public.delivery_services
  ADD CONSTRAINT chk_ds_subscription_status
  CHECK (subscription_status IS NULL
    OR subscription_status IN ('active', 'grace_period', 'expired'));

ALTER TABLE public.delivery_services
  ADD CONSTRAINT chk_ds_grace_after_expiry
  CHECK (subscription_grace_until IS NULL
    OR subscription_expires_at IS NULL
    OR subscription_grace_until > subscription_expires_at);


-- ============================================================
-- 8. marketplace_seller_subtypes — TIPAR COMO ENUM
-- ============================================================
-- Substitui CHECK inline por tipo enum. Se existir algum subtipo
-- com category='outros' (não deveria — defensivo), remapeia antes.
-- ============================================================

UPDATE public.marketplace_seller_subtypes
  SET category = 'produtos'
  WHERE category = 'outros';

-- Drop CHECK inline antigo (nome auto-gerado pelo PostgreSQL).
-- Usamos DO block porque o nome pode variar.
DO $$ BEGIN
  ALTER TABLE public.marketplace_seller_subtypes
    DROP CONSTRAINT IF EXISTS marketplace_seller_subtypes_category_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Verificação extra: buscar qualquer constraint remanescente por padrão
DO $$
DECLARE
  _cname text;
BEGIN
  FOR _cname IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
     WHERE t.relname = 'marketplace_seller_subtypes'
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE public.marketplace_seller_subtypes DROP CONSTRAINT IF EXISTS %I', _cname);
  END LOOP;
END $$;

ALTER TABLE public.marketplace_seller_subtypes
  ALTER COLUMN category TYPE seller_category_enum
  USING category::seller_category_enum;


-- ============================================================
-- 9. NOVOS SUBTIPOS (Gap #1 do panorama de atores)
-- ============================================================
-- Atores mapeados: passeador de cães, diarista, reparos informática,
-- revendedora autônoma, consultora de beleza.
-- ============================================================

INSERT INTO public.marketplace_seller_subtypes (slug, label, category, icon, sort_order) VALUES
  ('passeador_pets',       'Passeador de Pets',       'servicos',  'PawPrint',       19),
  ('diarista',             'Diarista / Limpeza',      'servicos',  'SprayCanIcon',   20),
  ('limpeza_residencial',  'Limpeza Residencial',     'servicos',  'Sparkles',       21),
  ('reparos_informatica',  'Reparos de Informática',  'servicos',  'Monitor',        22),
  ('revendedora_autonoma', 'Revendedora Autônoma',    'produtos',  'ShoppingBag',    27),
  ('consultora_beleza',    'Consultora de Beleza',    'produtos',  'Palette',        28)
ON CONFLICT (slug) DO NOTHING;


-- ============================================================
-- 10. ALARGAR price_brl PARA IMÓVEIS DE ALTO VALOR
-- ============================================================
-- NUMERIC(10,2) → max R$ 99.999.999,99 (insuficiente para venda de luxo)
-- NUMERIC(12,2) → max R$ 9.999.999.999,99 (margem segura)
--
-- Alarga também subtotal_brl e total_brl em marketplace_orders
-- para acomodar o valor transitando pelo pedido.
--
-- Nota: NUMERIC precision change exige reescrita da tabela.
-- Seguro neste momento (tabelas pequenas, pré-escala).
-- ============================================================

ALTER TABLE public.marketplace_products
  ALTER COLUMN price_brl TYPE NUMERIC(12, 2);

ALTER TABLE public.marketplace_orders
  ALTER COLUMN subtotal_brl TYPE NUMERIC(12, 2);

ALTER TABLE public.marketplace_orders
  ALTER COLUMN total_brl TYPE NUMERIC(12, 2);


-- ============================================================
-- 11. ÍNDICES
-- ============================================================

-- GIN para queries por categoria: WHERE categories @> ARRAY['servicos']
CREATE INDEX IF NOT EXISTS idx_sp_categories
  ON public.seller_profiles USING GIN (categories);

-- B-tree para vitrine: listar vendedores ativos pela categoria primária
CREATE INDEX IF NOT EXISTS idx_sp_primary_category_active
  ON public.seller_profiles (primary_category)
  WHERE status = 'active';

-- Assinantes ativos (para cron de expiração e queries de isenção)
CREATE INDEX IF NOT EXISTS idx_sp_subscription_active
  ON public.seller_profiles (subscription_expires_at)
  WHERE billing_mode = 'subscription'
    AND subscription_status IN ('active', 'grace_period');

CREATE INDEX IF NOT EXISTS idx_ds_subscription_active
  ON public.delivery_services (subscription_expires_at)
  WHERE billing_mode = 'subscription'
    AND subscription_status IN ('active', 'grace_period');


-- ============================================================
-- 12. COMENTÁRIOS
-- ============================================================

COMMENT ON COLUMN public.seller_profiles.categories IS
  '[S1-D1] Categorias habilitadas do vendedor (multi-categoria). '
  'Capabilities = união de getCapabilities(cat) para cada cat no array. '
  'A renderização de cada LISTING deriva do product_type do item (TYPE GUARD), '
  'NÃO da união do perfil.';

COMMENT ON COLUMN public.seller_profiles.primary_category IS
  '[S1-T5] Categoria principal para display: determina a vitrine/aba padrão, '
  'ícone dominante no SuperCard e ordenação de tabs no SellerDashboard. '
  'DEVE pertencer ao array categories (constraint chk_sp_primary_in_categories).';

COMMENT ON COLUMN public.seller_profiles.billing_mode IS
  '[S1-D4] Modelo de monetização: per_transaction (2% por venda) ou '
  'subscription (Brasileirinho R$29,90/mês — zera a taxa).';

COMMENT ON COLUMN public.seller_profiles.subscription_grace_until IS
  '[S1-D3] Fim do período de graça (7 dias após expires_at). '
  'Isenção de taxa decidida por: now() < subscription_grace_until (timestamp), '
  'NÃO pelo campo subscription_status (string pode estar defasada).';

COMMENT ON COLUMN public.seller_profiles.freight_split_buyer_pct IS
  '[S1-D4-T2] Percentual do frete que o comprador paga no freight_mode=split. '
  'Ex: 50 = comprador 50%, vendedor 50%. Comprador vê o quadro e escolhe.';

COMMENT ON COLUMN public.seller_profiles.freight_split_seller_cap_brl IS
  '[S1-T2] Teto de contribuição do vendedor por entrega no split. '
  'Acima do teto, excedente vai integralmente ao comprador. '
  'NULL = sem teto (vendedor arca com sua % integral).';


-- ============================================================
-- FIM DA MIGRATION S1
-- ============================================================
