-- ============================================================
-- FIX: Corrige preços de assinatura dos planos Brasileirinho
-- ============================================================
-- Bug: annual_price_brl calculado como (mensal_equivalente × 10)
--      em vez de (monthly_price × 10) = 10 meses pelo preço de 12.
--
-- Preços corrigidos:
--   T1 Inicial: R$39,90/mês | R$399,00/ano (era 332,50)
--   T2 Pro:     R$69,90/mês | R$699,00/ano (era 582,50)
--   T3 Premium: R$99,90/mês flat + 1,5% acima R$10k | R$999,00/ano + 5% acima R$10k
--
-- Modelo de cobrança:
--   Mensal  → Asaas subscription MONTHLY (monthly_price_brl)
--   Anual   → Asaas subscription YEARLY  (annual_price_brl)
--   Excedente → billing system (commission_rate × excedente acima de revenue_ceiling)

BEGIN;

-- ============================================================
-- 1. Corrigir preço anual T1 e T2
-- ============================================================
UPDATE public.subscription_plans
  SET annual_price_brl = 399.00
  WHERE slug = 'brasileirinho_t1';

UPDATE public.subscription_plans
  SET annual_price_brl = 699.00
  WHERE slug = 'brasileirinho_t2';

-- ============================================================
-- 2. Atualizar T3 Premium: flat fee + excedente acima de R$10k
-- ============================================================
-- monthly_price_brl: 0 → 99.90 (flat fee mensal, cobrado via Asaas)
-- annual_price_brl:  NULL → 999.00 (flat fee anual)
-- revenue_ceiling_brl: NULL → 10000 (acima disso, commission_rate se aplica)
-- commission_rate mantido: 0.015 (1,5% excedente mensal)
-- minimum_monthly_brl mantido: 75.00 (fallback legado)
UPDATE public.subscription_plans
  SET monthly_price_brl   = 99.90,
      annual_price_brl    = 999.00,
      revenue_ceiling_brl = 10000.00
  WHERE slug = 'brasileirinho_t3';

-- ============================================================
-- 3. Verificação
-- ============================================================
DO $$ BEGIN
  ASSERT (SELECT annual_price_brl FROM public.subscription_plans WHERE slug = 'brasileirinho_t1') = 399.00,
    'FALHOU: T1 annual deve ser 399.00';
  ASSERT (SELECT annual_price_brl FROM public.subscription_plans WHERE slug = 'brasileirinho_t2') = 699.00,
    'FALHOU: T2 annual deve ser 699.00';
  ASSERT (SELECT monthly_price_brl FROM public.subscription_plans WHERE slug = 'brasileirinho_t3') = 99.90,
    'FALHOU: T3 monthly deve ser 99.90';
  ASSERT (SELECT annual_price_brl FROM public.subscription_plans WHERE slug = 'brasileirinho_t3') = 999.00,
    'FALHOU: T3 annual deve ser 999.00';
  ASSERT (SELECT revenue_ceiling_brl FROM public.subscription_plans WHERE slug = 'brasileirinho_t3') = 10000.00,
    'FALHOU: T3 revenue_ceiling deve ser 10000';

  RAISE NOTICE 'fix_subscription_plan_prices OK — T1 annual=399, T2 annual=699, T3 monthly=99.90 annual=999 ceiling=10000';
END $$;

COMMIT;
