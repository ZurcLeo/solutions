-- Migration: fix_plan_tiers_and_reset
-- Corrige faixas de faturamento dos planos Brasileirinho e reseta todos os
-- sellers para Modelo Básico (nenhum negócio tem Brasileirinho no momento).

BEGIN;

-- ============================================================
-- 1. Corrigir faixas de faturamento e boost
-- ============================================================

-- T1: Brasileirinho Inicial — teto de R$1.000 → R$1.500
UPDATE public.subscription_plans
  SET revenue_ceiling_brl = 1500.00
  WHERE slug = 'brasileirinho_t1';

-- T2: Brasileirinho Pro — faixa R$1.000-5.000 → R$1.501-6.000, boost 1.5→2.0
UPDATE public.subscription_plans
  SET revenue_floor_brl   = 1501.00,
      revenue_ceiling_brl = 6000.00,
      boost_multiplier    = 2.0
  WHERE slug = 'brasileirinho_t2';

-- T3: Brasileirinho Premium — piso R$5.000,01 → R$6.001
UPDATE public.subscription_plans
  SET revenue_floor_brl = 6001.00
  WHERE slug = 'brasileirinho_t3';

-- ============================================================
-- 2. Resetar todos os sellers para Modelo Básico
-- ============================================================

-- Sellers que tinham sido backfillados para brasileirinho voltam para basico
UPDATE public.seller_profiles
  SET plan_slug = 'lojista_basico',
      commission_rate = 0.05
  WHERE plan_slug IS NOT NULL AND plan_slug <> 'lojista_basico';

-- Garantir que sellers sem plan_slug também fiquem no basico
UPDATE public.seller_profiles
  SET plan_slug = 'lojista_basico',
      commission_rate = 0.05
  WHERE plan_slug IS NULL;

-- Cancelar assinaturas brasileirinho ativas (nenhum negócio tem plano pago)
UPDATE public.user_subscriptions
  SET status = 'cancelled',
      plan_slug = 'lojista_basico'
  WHERE plan_slug IN ('brasileirinho_t1', 'brasileirinho_t2', 'brasileirinho_t3')
    AND status = 'active';

-- Backfill subscriptions sem plan_slug
UPDATE public.user_subscriptions
  SET plan_slug = 'lojista_basico',
      tier_at_creation = 0
  WHERE plan_slug IS NULL;

-- ============================================================
-- 3. Verificação
-- ============================================================
DO $$ BEGIN
  ASSERT (SELECT revenue_ceiling_brl FROM public.subscription_plans WHERE slug = 'brasileirinho_t1') = 1500.00,
    'FALHOU: T1 ceiling deve ser 1500';
  ASSERT (SELECT revenue_floor_brl FROM public.subscription_plans WHERE slug = 'brasileirinho_t2') = 1501.00,
    'FALHOU: T2 floor deve ser 1501';
  ASSERT (SELECT revenue_ceiling_brl FROM public.subscription_plans WHERE slug = 'brasileirinho_t2') = 6000.00,
    'FALHOU: T2 ceiling deve ser 6000';
  ASSERT (SELECT boost_multiplier FROM public.subscription_plans WHERE slug = 'brasileirinho_t2') = 2.0,
    'FALHOU: T2 boost deve ser 2.0';
  ASSERT (SELECT revenue_floor_brl FROM public.subscription_plans WHERE slug = 'brasileirinho_t3') = 6001.00,
    'FALHOU: T3 floor deve ser 6001';
  ASSERT (SELECT COUNT(*) FROM public.seller_profiles WHERE plan_slug <> 'lojista_basico') = 0,
    'FALHOU: todos sellers devem estar no lojista_basico';

  RAISE NOTICE 'fix_plan_tiers_and_reset OK — faixas atualizadas, sellers resetados para Modelo Básico';
END $$;

COMMIT;
