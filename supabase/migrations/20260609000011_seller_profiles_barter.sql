-- ============================================================
-- MKTPLACE-BARTER: Tipo de perfil de vendedor — Loja vs Canal de Troca
--
-- Regra de negócio (confirmada por Léo 2026-06-09):
--   is_barter_only = false → LOJA: vende produtos/serviços com preço em BRL;
--                            pode aceitar ElosCoins como desconto.
--   is_barter_only = true  → CANAL DE TROCA: opera apenas por escambo;
--                            cada solicitação de troca custa 50 EloCoins
--                            ao solicitante (pedágio de seriedade, não reembolsável).
--
-- Esta coluna estava referenciada em SELLER_SAFE_COLS (marketplaceService.js)
-- mas nunca foi adicionada à tabela seller_profiles — apenas em marketplace_products.
-- Migration 20260525000003 adicionou is_barter_only a marketplace_products.
-- Esta migration corrige o schema de seller_profiles.
--
-- Depende de: 20260524000001_marketplace_schema.sql
-- ============================================================

ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS is_barter_only BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.seller_profiles.is_barter_only IS
  '[MKTPLACE-BARTER] Quando true, o perfil é um Canal de Troca (escambo). '
  'Produtos deste vendedor são do tipo barter_only e não têm preço em BRL. '
  'Cada solicitação de troca custa 50 EloCoins ao solicitante.';

-- Índice para filtrar lojas vs canais de troca
CREATE INDEX IF NOT EXISTS idx_seller_profiles_barter
  ON public.seller_profiles(is_barter_only)
  WHERE is_barter_only = true;

-- ============================================================
-- Verificação pós-migration
-- ============================================================
DO $$ BEGIN
  ASSERT (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'seller_profiles'
      AND column_name  = 'is_barter_only'
  ) = 1, 'FALHOU: is_barter_only não adicionada em seller_profiles';

  RAISE NOTICE 'MKTPLACE-BARTER migration OK — is_barter_only adicionada a seller_profiles';
END $$;
