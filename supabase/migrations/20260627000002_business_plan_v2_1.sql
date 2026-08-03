-- ============================================================
-- BUSINESS PLAN v2.1 — Sistema de Cobrança Escalonado (Brasileirinho)
-- ============================================================
-- Substitui o modelo binário (R$29,90 mensal OU 2% comissão)
-- por 3 tiers baseados em faturamento + billing de entregadores +
-- sistema de isenções temporárias para negócios âncora.
--
-- Delta:
--   Comissão lojista: 2% → 5%
--   Assinatura flat: R$29,90 → 3 tiers (R$39,90 / R$69,90 / 1,5% mín R$75)
--   Opção anual: ~16% off (10 meses pelo preço de 12)
--   Entregador: 8% básico / zero no ativo R$19,90
--   Isenções: N1 (12m), N2 (6m), Guardiões (12m)

BEGIN;

-- ============================================================
-- 1. Tabela catálogo subscription_plans
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  plan_type             TEXT NOT NULL CHECK (plan_type IN ('lojista','entregador')),
  tier                  INTEGER NOT NULL DEFAULT 1,
  monthly_price_brl     NUMERIC(10,2) NOT NULL DEFAULT 0,
  annual_price_brl      NUMERIC(10,2),
  commission_rate       NUMERIC(5,4) NOT NULL DEFAULT 0,
  minimum_monthly_brl   NUMERIC(10,2),
  revenue_floor_brl     NUMERIC(12,2),
  revenue_ceiling_brl   NUMERIC(12,2),
  included_seats        INTEGER NOT NULL DEFAULT 1,
  extra_seat_price_brl  NUMERIC(10,2) NOT NULL DEFAULT 9.90,
  boost_multiplier      NUMERIC(3,1) NOT NULL DEFAULT 1.0,
  badge_slug            TEXT,
  includes_subconta     BOOLEAN NOT NULL DEFAULT false,
  includes_escrow       BOOLEAN NOT NULL DEFAULT false,
  includes_split        BOOLEAN NOT NULL DEFAULT false,
  escrow_days_products  INTEGER,
  escrow_days_services  INTEGER,
  prerequisite_slug     TEXT REFERENCES public.subscription_plans(slug),
  prerequisite_min_count INTEGER,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_type
  ON public.subscription_plans(plan_type, is_active);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

-- Catálogo é público para leitura
CREATE POLICY "subscription_plans_public_read" ON public.subscription_plans
  FOR SELECT USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.subscription_plans FROM anon, authenticated;
GRANT SELECT ON public.subscription_plans TO anon, authenticated;

-- ============================================================
-- 1.1 Seed dos 6 planos
-- ============================================================
INSERT INTO public.subscription_plans
  (slug, name, plan_type, tier, monthly_price_brl, annual_price_brl, commission_rate,
   minimum_monthly_brl, revenue_floor_brl, revenue_ceiling_brl, included_seats,
   extra_seat_price_brl, boost_multiplier, badge_slug,
   includes_subconta, includes_escrow, includes_split,
   prerequisite_slug, prerequisite_min_count, sort_order)
VALUES
  -- Lojista Básico (5% comissão, sem mensalidade)
  ('lojista_basico', 'Modelo Básico', 'lojista', 0,
   0, NULL, 0.0500,
   NULL, NULL, NULL, 1,
   0, 1.0, NULL,
   false, false, false,
   NULL, NULL, 0),

  -- Brasileirinho T1 (R$39,90/mês, até R$1.000 faturamento)
  ('brasileirinho_t1', 'Brasileirinho Inicial', 'lojista', 1,
   39.90, 332.50, 0,
   NULL, NULL, 1000.00, 2,
   9.90, 1.5, 'pagamento_protegido',
   true, true, false,
   NULL, NULL, 1),

  -- Brasileirinho T2 (R$69,90/mês, R$1.000-5.000 faturamento)
  ('brasileirinho_t2', 'Brasileirinho Pro', 'lojista', 2,
   69.90, 582.50, 0,
   NULL, 1000.01, 5000.00, 3,
   9.90, 1.5, 'pagamento_protegido',
   true, true, true,
   NULL, NULL, 2),

  -- Brasileirinho T3 (1,5% mín R$75, acima de R$5.000 faturamento)
  ('brasileirinho_t3', 'Brasileirinho Premium', 'lojista', 3,
   0, NULL, 0.0150,
   75.00, 5000.01, NULL, 5,
   14.90, 2.0, 'pagamento_protegido',
   true, true, true,
   NULL, NULL, 3),

  -- Entregador Básico (8% comissão)
  ('entregador_basico', 'Entregador Básico', 'entregador', 0,
   0, NULL, 0.0800,
   NULL, NULL, NULL, 1,
   0, 1.0, NULL,
   false, false, false,
   NULL, NULL, 10),

  -- Entregador Ativo (R$19,90/mês, zero comissão, requer 10 entregas no básico)
  ('entregador_ativo', 'Entregador Ativo', 'entregador', 1,
   19.90, NULL, 0,
   NULL, NULL, NULL, 1,
   0, 1.5, 'entregador_verificado',
   false, false, false,
   'entregador_basico', 10, 11)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- 2. ALTER user_subscriptions — novos campos
-- ============================================================
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS plan_slug TEXT REFERENCES public.subscription_plans(slug),
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS tier_at_creation INTEGER;

-- Ampliar status check (sem perder dados)
DO $$ BEGIN
  ALTER TABLE public.user_subscriptions
    DROP CONSTRAINT IF EXISTS user_subscriptions_status_check;
  ALTER TABLE public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_status_check
      CHECK (status IN ('active','cancelled','past_due','suspended','pending_payment'));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Status check constraint already updated or not found';
END $$;

-- Billing cycle check
DO $$ BEGIN
  ALTER TABLE public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_billing_cycle_check
      CHECK (billing_cycle IN ('monthly','annual'));
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'billing_cycle check already exists';
END $$;

-- Index para buscar por plan_slug
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_slug
  ON public.user_subscriptions(plan_slug, status);

-- ============================================================
-- 2.1 Backfill user_subscriptions existentes
-- ============================================================
UPDATE public.user_subscriptions
  SET plan_slug = 'brasileirinho_t1', tier_at_creation = 1
  WHERE billing_mode = 'monthly' AND plan_slug IS NULL;

UPDATE public.user_subscriptions
  SET plan_slug = 'lojista_basico', tier_at_creation = 0
  WHERE billing_mode = 'commission' AND plan_slug IS NULL;

-- ============================================================
-- 3. ALTER billing_events — novos campos e billing_mode ampliado
-- ============================================================
DO $$ BEGIN
  ALTER TABLE public.billing_events
    DROP CONSTRAINT IF EXISTS billing_events_billing_mode_check;
  ALTER TABLE public.billing_events
    ADD CONSTRAINT billing_events_billing_mode_check
      CHECK (billing_mode IN ('monthly_covered','commission','percentage_tier','exemption_covered'));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'billing_events billing_mode check already updated';
END $$;

ALTER TABLE public.billing_events
  ADD COLUMN IF NOT EXISTS plan_slug TEXT,
  ADD COLUMN IF NOT EXISTS exemption_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_request_id TEXT;

-- ============================================================
-- 4. Tabela seller_exemptions (isenções / negócios âncora)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.seller_exemptions (
  id                            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  exemption_level               TEXT NOT NULL CHECK (exemption_level IN ('n1_fundador','n2_rede','guardiao')),
  sponsor_user_id               TEXT NOT NULL REFERENCES public.users(id),
  beneficiary_user_id           TEXT NOT NULL REFERENCES public.users(id),
  beneficiary_type              TEXT NOT NULL CHECK (beneficiary_type IN ('lojista','entregador')),

  duration_months               INTEGER NOT NULL,
  commission_rate_override      NUMERIC(5,4) NOT NULL,
  monthly_cap_brl               NUMERIC(10,2) DEFAULT 100.00,

  start_date                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date                      TIMESTAMPTZ NOT NULL,
  min_orders_required           INTEGER NOT NULL DEFAULT 5,
  orders_deadline               TIMESTAMPTZ NOT NULL,
  orders_completed              INTEGER NOT NULL DEFAULT 0,
  is_activated                  BOOLEAN NOT NULL DEFAULT false,

  total_commission_absorbed_brl NUMERIC(10,2) DEFAULT 0,
  status                        TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','active','expired','revoked','failed_activation')),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (beneficiary_user_id, exemption_level, sponsor_user_id)
);

CREATE INDEX IF NOT EXISTS idx_seller_exemptions_beneficiary
  ON public.seller_exemptions(beneficiary_user_id, status);

CREATE INDEX IF NOT EXISTS idx_seller_exemptions_sponsor
  ON public.seller_exemptions(sponsor_user_id);

ALTER TABLE public.seller_exemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exemptions_own_select" ON public.seller_exemptions
  FOR SELECT USING (
    beneficiary_user_id = auth.uid()::text
    OR sponsor_user_id = auth.uid()::text
  );

-- Sponsors podem criar isenções
CREATE POLICY "exemptions_sponsor_insert" ON public.seller_exemptions
  FOR INSERT WITH CHECK (sponsor_user_id = auth.uid()::text);

REVOKE ALL ON public.seller_exemptions FROM anon;

-- ============================================================
-- 5. Tabela seller_billing_balance (cobrança acumulada modo básico)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.seller_billing_balance (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seller_user_id   TEXT NOT NULL UNIQUE REFERENCES public.users(id),
  balance_brl      NUMERIC(10,2) NOT NULL DEFAULT 0,
  last_billed_at   TIMESTAMPTZ,
  next_billing_at  TIMESTAMPTZ,
  unpaid_cycles    INTEGER NOT NULL DEFAULT 0,
  is_blocked       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seller_billing_balance_blocked
  ON public.seller_billing_balance(is_blocked) WHERE is_blocked = true;

ALTER TABLE public.seller_billing_balance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_balance_own_select" ON public.seller_billing_balance
  FOR SELECT USING (seller_user_id = auth.uid()::text);

REVOKE ALL ON public.seller_billing_balance FROM anon;

-- ============================================================
-- 6. RPC get_seller_rolling_revenue (faturamento 30 dias)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_seller_rolling_revenue(p_seller_user_id TEXT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(mo.total_brl), 0)
  FROM public.marketplace_orders mo
  JOIN public.seller_profiles sp ON sp.id = mo.seller_id
  WHERE sp.user_id = p_seller_user_id
    AND mo.status = 'completed'
    AND mo.updated_at >= (NOW() - INTERVAL '30 days');
$$;

REVOKE EXECUTE ON FUNCTION public.get_seller_rolling_revenue(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_seller_rolling_revenue(TEXT) TO service_role;

-- ============================================================
-- 7. ALTER seller_profiles — plan_slug + comissão ampliada
-- ============================================================
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS plan_slug TEXT REFERENCES public.subscription_plans(slug);

-- Ampliar CHECK de commission_rate para acomodar 8%
DO $$ BEGIN
  ALTER TABLE public.seller_profiles
    DROP CONSTRAINT IF EXISTS seller_profiles_commission_rate_check;
  ALTER TABLE public.seller_profiles
    ADD CONSTRAINT seller_profiles_commission_rate_check
      CHECK (commission_rate BETWEEN 0 AND 0.10);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'commission_rate check already updated';
END $$;

-- ============================================================
-- 7.1 Backfill seller_profiles
-- ============================================================
-- Sellers no per_transaction passam de 2% para 5%
UPDATE public.seller_profiles
  SET commission_rate = 0.05
  WHERE billing_mode = 'per_transaction';

-- Sellers com subscription mantêm commission_rate = 0
UPDATE public.seller_profiles
  SET plan_slug = 'brasileirinho_t1'
  WHERE billing_mode = 'subscription' AND plan_slug IS NULL;

UPDATE public.seller_profiles
  SET plan_slug = 'lojista_basico'
  WHERE billing_mode = 'per_transaction' AND plan_slug IS NULL;

-- ============================================================
-- 8. Novos selos (badges)
-- ============================================================
INSERT INTO public.selos (slug, name, description, category, tier, color_hex, is_platform_grant, grant_criteria, xp_bonus, coin_bonus, sort_order)
VALUES
  ('pagamento_protegido', 'Pagamento Protegido', 'Vendedor com plano Brasileirinho ativo',
   'plataforma', 'ouro', '#059669', TRUE, '{"plan_type":"brasileirinho"}'::jsonb, 100, 20, 60),
  ('entregador_verificado', 'Entregador Verificado', 'Entregador com plano ativo',
   'plataforma', 'ouro', '#0284C7', TRUE, '{"plan_type":"entregador_ativo"}'::jsonb, 100, 20, 61)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- 9. Verificação pós-migration
-- ============================================================
DO $$ BEGIN
  ASSERT (SELECT COUNT(*) FROM public.subscription_plans) >= 6,
    'FALHOU: subscription_plans deve ter ao menos 6 planos';

  ASSERT (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'seller_exemptions') = 1,
    'FALHOU: seller_exemptions não criada';

  ASSERT (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'seller_billing_balance') = 1,
    'FALHOU: seller_billing_balance não criada';

  ASSERT (SELECT COUNT(*) FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'get_seller_rolling_revenue') = 1,
    'FALHOU: RPC get_seller_rolling_revenue não criada';

  RAISE NOTICE 'Business Plan v2.1 migration OK — subscription_plans (6), seller_exemptions, seller_billing_balance, get_seller_rolling_revenue';
END $$;

COMMIT;
