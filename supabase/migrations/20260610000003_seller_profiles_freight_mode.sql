-- =====================================================
-- MIGRAÇÃO: Freight Mode em seller_profiles
-- [DELIVERY-003] Decisão 1 aprovada por Léo (2026-06-10): Opção C
--
-- Altera seller_profiles para que o vendedor configure
-- quem paga o frete e como o custo é exibido ao comprador.
--
-- Campos adicionados:
--   freight_mode         — quem paga: seller_pays | buyer_pays | split
--   freight_split_ratio  — fração paga pelo comprador (0.0→1.0)
--                          ex: 0.5 = 50% comprador / 50% vendedor
--                          ex: 1.0 = 100% comprador (equivale a buyer_pays)
--                          ex: 0.0 = 100% vendedor (equivale a seller_pays)
--
-- Regras de negócio (DA-012):
--   seller_pays  → comprador não vê custo de entrega no checkout
--   buyer_pays   → "+Entrega: R$ X,XX" visível no checkout
--   split        → "Entrega: R$ X,XX (você paga X%)" no checkout
--
-- Cálculo no backend (marketplaceService.js / deliveryService.js):
--   buyer_freight  = accepted_fee × freight_split_ratio
--   seller_freight = accepted_fee × (1 - freight_split_ratio)
--   total_buyer    = subtotal_brl - coins_discount_brl + buyer_freight
--
-- Zero-downtime:
--   Campos NULLABLE com DEFAULT → sem bloqueio de tabela.
--   CHECK constraint adicionada separadamente (DO block) para evitar conflito.
--
-- Depende de:
--   20260524000001_marketplace_schema.sql  (seller_profiles)
--   20260524000002_seller_profiles_approval.sql
--
-- Agente: marketplace-agent | Revisado por: ClaudIA
-- Data: 2026-06-10
-- =====================================================


-- 1. Adiciona freight_mode com DEFAULT (zero-downtime)
ALTER TABLE public.seller_profiles
    ADD COLUMN IF NOT EXISTS freight_mode TEXT NOT NULL DEFAULT 'buyer_pays';

COMMENT ON COLUMN public.seller_profiles.freight_mode IS
    '[DELIVERY-003] Como o custo do frete é tratado no checkout. '
    'seller_pays  → vendedor absorve (comprador não vê). '
    'buyer_pays   → comprador paga o total do frete. '
    'split        → frete dividido conforme freight_split_ratio. '
    'Padrão: buyer_pays — comportamento mais neutro, vendedor pode mudar.';

-- 2. Adiciona freight_split_ratio com DEFAULT
ALTER TABLE public.seller_profiles
    ADD COLUMN IF NOT EXISTS freight_split_ratio NUMERIC(4, 3) NOT NULL DEFAULT 1.000;

COMMENT ON COLUMN public.seller_profiles.freight_split_ratio IS
    '[DELIVERY-003] Fração do frete paga pelo comprador (0.000 → 1.000). '
    'Usado apenas quando freight_mode = split. '
    'Ex: 0.500 = 50% comprador, 50% vendedor. '
    'Ex: 0.750 = 75% comprador, 25% vendedor. '
    'Valores com freight_mode != split são ignorados no cálculo.';

-- 3. Adiciona CHECK constraints via DO block (evita erro se já existirem)
DO $$
DECLARE
    cname TEXT;
BEGIN
    -- CHECK: freight_mode
    SELECT conname INTO cname
    FROM pg_constraint
    WHERE conrelid = 'public.seller_profiles'::regclass
      AND contype = 'c'
      AND conname = 'seller_profiles_freight_mode_check';

    IF cname IS NULL THEN
        ALTER TABLE public.seller_profiles
            ADD CONSTRAINT seller_profiles_freight_mode_check
            CHECK (freight_mode IN ('seller_pays', 'buyer_pays', 'split'));
    END IF;

    -- CHECK: freight_split_ratio range
    SELECT conname INTO cname
    FROM pg_constraint
    WHERE conrelid = 'public.seller_profiles'::regclass
      AND contype = 'c'
      AND conname = 'seller_profiles_freight_split_ratio_check';

    IF cname IS NULL THEN
        ALTER TABLE public.seller_profiles
            ADD CONSTRAINT seller_profiles_freight_split_ratio_check
            CHECK (freight_split_ratio BETWEEN 0.000 AND 1.000);
    END IF;
END;
$$;

-- 4. Índice para consultas de relatório por modo de frete
CREATE INDEX IF NOT EXISTS idx_seller_profiles_freight_mode
    ON public.seller_profiles (freight_mode)
    WHERE status = 'active';


-- =====================================================
-- 5. RPC helper: calculate_buyer_freight
-- Centraliza o cálculo no banco para consistência entre
-- marketplaceService.js e deliveryService.js.
-- =====================================================

CREATE OR REPLACE FUNCTION public.calculate_buyer_freight(
    p_accepted_fee   NUMERIC,
    p_freight_mode   TEXT,
    p_split_ratio    NUMERIC
)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
    SELECT CASE p_freight_mode
        WHEN 'seller_pays' THEN jsonb_build_object(
            'buyer_freight',  0.00,
            'seller_freight', round(p_accepted_fee::numeric, 2),
            'show_to_buyer',  false
        )
        WHEN 'buyer_pays' THEN jsonb_build_object(
            'buyer_freight',  round(p_accepted_fee::numeric, 2),
            'seller_freight', 0.00,
            'show_to_buyer',  true
        )
        WHEN 'split' THEN jsonb_build_object(
            'buyer_freight',  round((p_accepted_fee * p_split_ratio)::numeric, 2),
            'seller_freight', round((p_accepted_fee * (1 - p_split_ratio))::numeric, 2),
            'show_to_buyer',  true,
            'split_ratio',    p_split_ratio
        )
        ELSE jsonb_build_object(
            'error', 'invalid_freight_mode',
            'buyer_freight', round(p_accepted_fee::numeric, 2),
            'seller_freight', 0.00,
            'show_to_buyer', true
        )
    END
$$;

COMMENT ON FUNCTION public.calculate_buyer_freight(NUMERIC, TEXT, NUMERIC) IS
    '[DELIVERY-003] Calcula a divisão do custo de frete entre comprador e vendedor. '
    'IMMUTABLE: segura para uso em queries e computed columns. '
    'Retorna buyer_freight, seller_freight e show_to_buyer (se exibir no checkout). '
    'Centraliza regra de negócio DA-012 para uso em marketplaceService e deliveryService.';

GRANT EXECUTE ON FUNCTION public.calculate_buyer_freight(NUMERIC, TEXT, NUMERIC) TO authenticated;


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar.
-- =====================================================

-- V1. Colunas adicionadas:
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'seller_profiles'
--   AND column_name IN ('freight_mode', 'freight_split_ratio');
-- Esperado: 2 linhas.

-- V2. seller_pays → comprador não paga frete:
-- SELECT public.calculate_buyer_freight(18.50, 'seller_pays', 1.0);
-- Esperado: {"buyer_freight": 0.00, "seller_freight": 18.50, "show_to_buyer": false}

-- V3. buyer_pays → comprador paga tudo:
-- SELECT public.calculate_buyer_freight(18.50, 'buyer_pays', 1.0);
-- Esperado: {"buyer_freight": 18.50, "seller_freight": 0.00, "show_to_buyer": true}

-- V4. split 50/50:
-- SELECT public.calculate_buyer_freight(18.50, 'split', 0.5);
-- Esperado: {"buyer_freight": 9.25, "seller_freight": 9.25, "show_to_buyer": true, "split_ratio": 0.5}

-- V5. Constraints ativas:
-- SELECT conname FROM pg_constraint
-- WHERE conrelid = 'public.seller_profiles'::regclass
--   AND conname IN (
--     'seller_profiles_freight_mode_check',
--     'seller_profiles_freight_split_ratio_check'
--   );
-- Esperado: 2 linhas.
