-- SUB-002: Planos de Assinatura ElosCloud
-- Decisão de produto (Léo, 2026-05-25):
--   billing_mode 'monthly' = R$29,90/mês sem comissão
--   billing_mode 'commission' = 3% por venda (padrão, sem assinatura)
--   Regra do mesmo dia: vendas no dia da assinatura são cobertas pelo plano
--
-- NOTA DE ADAPTAÇÃO: IDs usam TEXT (padrão ElosCloud) referenciando public.users,
--   consistente com marketplace_schema (20260524000001) e identity_schema.
--   O padrão auth.users (uuid) foi substituído por public.users (TEXT) para
--   manter uniformidade com o restante do schema.

-- ============================================================
-- 1. Tabela user_subscriptions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id               TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan                  TEXT NOT NULL DEFAULT 'free',
  billing_mode          TEXT NOT NULL DEFAULT 'commission'
                          CHECK (billing_mode IN ('monthly', 'commission')),
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'cancelled', 'past_due')),
  payment_method        TEXT,
  payment_id            TEXT,
  subscribed_at         TIMESTAMPTZ,
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user
  ON public.user_subscriptions(user_id, status);

CREATE INDEX IF NOT EXISTS idx_subscriptions_plan
  ON public.user_subscriptions(plan, status);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_own_select" ON public.user_subscriptions
  FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY "subscriptions_own_insert" ON public.user_subscriptions
  FOR INSERT WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "subscriptions_own_update" ON public.user_subscriptions
  FOR UPDATE USING (user_id = auth.uid()::text);

REVOKE ALL ON public.user_subscriptions FROM anon;

-- ============================================================
-- 2. Tabela billing_events (imutável — auditoria de cobranças)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.billing_events (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seller_user_id      TEXT NOT NULL REFERENCES public.users(id),
  order_id            TEXT NOT NULL REFERENCES public.marketplace_orders(id),
  billing_mode        TEXT NOT NULL CHECK (billing_mode IN ('monthly_covered', 'commission')),
  commission_rate     NUMERIC NOT NULL CHECK (commission_rate >= 0),
  commission_brl      NUMERIC NOT NULL CHECK (commission_brl >= 0),
  subscription_id     TEXT REFERENCES public.user_subscriptions(id),
  sale_date           DATE NOT NULL,
  subscribed_at_date  DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_seller
  ON public.billing_events(seller_user_id);

CREATE INDEX IF NOT EXISTS idx_billing_events_order
  ON public.billing_events(order_id);

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

-- Imutável: apenas INSERT e SELECT permitidos (sem UPDATE, sem DELETE)
CREATE POLICY "billing_events_insert" ON public.billing_events
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "billing_events_select_own" ON public.billing_events
  FOR SELECT USING (seller_user_id = auth.uid()::text);

REVOKE ALL ON public.billing_events FROM anon;

-- ============================================================
-- 3. Função is_sale_covered_by_plan (regra do mesmo dia)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_sale_covered_by_plan(
  p_user_id  TEXT,
  p_sale_date TIMESTAMPTZ
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_subscriptions
    WHERE user_id = p_user_id
      AND plan = 'seller'
      AND billing_mode = 'monthly'
      AND status = 'active'
      AND p_sale_date::date >= subscribed_at::date
  )
$$;

-- Revogar acesso público à função (segurança)
REVOKE EXECUTE ON FUNCTION public.is_sale_covered_by_plan(TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_sale_covered_by_plan(TEXT, TIMESTAMPTZ) TO service_role;

-- ============================================================
-- 4. Verificação pós-migration
-- ============================================================
DO $$ BEGIN
  ASSERT (
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_subscriptions'
  ) = 1, 'FALHOU: user_subscriptions não criada';

  ASSERT (
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'billing_events'
  ) = 1, 'FALHOU: billing_events não criada';

  ASSERT (
    SELECT COUNT(*) FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'is_sale_covered_by_plan'
  ) = 1, 'FALHOU: função is_sale_covered_by_plan não criada';

  RAISE NOTICE 'SUB-002 migration OK — user_subscriptions, billing_events, is_sale_covered_by_plan';
END $$;
