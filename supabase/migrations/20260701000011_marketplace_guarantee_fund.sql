-- =====================================================
-- FUND-001 · Fundo de Garantia do Marketplace — 3 Modos
--
-- Modos:
--   none             — sem garantia (padrão atual)
--   seller_absorbs   — vendedor paga (absorvido da comissão)
--   buyer_pays       — comprador paga (+2% do subtotal no checkout)
--   elocoins_social  — fundo social comunitário paga (treasury)
--
-- Depende de:
--   20260524000001_marketplace_schema.sql
--   20260610000005_marketplace_order_delivery_fee.sql
--   20260514000002_gamification_schema.sql
--
-- Data: 2026-07-01
-- =====================================================

BEGIN;

-- 1. Campo guarantee_fund_mode em seller_profiles
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS guarantee_fund_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (guarantee_fund_mode IN ('none', 'seller_absorbs', 'buyer_pays', 'elocoins_social'));

COMMENT ON COLUMN public.seller_profiles.guarantee_fund_mode IS
  '[FUND-001] Modo do fundo de garantia: none=desativado, seller_absorbs=vendedor paga via comissão, '
  'buyer_pays=+2% no total do comprador, elocoins_social=pago pelo fundo social comunitário.';

-- 2. Campos no marketplace_orders (snapshot no momento do pedido)
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS guarantee_fee_brl NUMERIC(8,2) NOT NULL DEFAULT 0.00;

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS guarantee_fund_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (guarantee_fund_mode IN ('none', 'seller_absorbs', 'buyer_pays', 'elocoins_social'));

COMMENT ON COLUMN public.marketplace_orders.guarantee_fee_brl IS
  '[FUND-001] Taxa do fundo de garantia cobrada do comprador (buyer_pays) ou zero (outros modos).';

COMMENT ON COLUMN public.marketplace_orders.guarantee_fund_mode IS
  '[FUND-001] Snapshot do modo de garantia usado neste pedido.';

-- 3. Atualizar constraint total_check para incluir guarantee_fee_brl
ALTER TABLE public.marketplace_orders
  DROP CONSTRAINT IF EXISTS marketplace_orders_total_check_v2;

ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT marketplace_orders_total_check_v3
  CHECK (total_brl = (subtotal_brl + delivery_fee + guarantee_fee_brl - coins_discount_brl));

-- 4. Tabela marketplace_guarantee_fund (append-only audit trail)
CREATE TABLE IF NOT EXISTS public.marketplace_guarantee_fund (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        TEXT NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  seller_id       TEXT NOT NULL,
  buyer_id        TEXT NOT NULL,
  amount_brl      NUMERIC(8,2) NOT NULL CHECK (amount_brl > 0),
  fund_mode       TEXT NOT NULL CHECK (fund_mode IN ('seller_absorbs', 'buyer_pays', 'elocoins_social')),
  event_type      TEXT NOT NULL CHECK (event_type IN ('collected', 'claimed', 'refunded', 'expired')),
  beneficiary_id  TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Imutável: sem UPDATE/DELETE (trilha financeira LGPD)

COMMENT ON TABLE public.marketplace_guarantee_fund IS
  '[FUND-001] Ledger append-only do fundo de garantia do marketplace. '
  'Cada pedido com garantia gera um evento "collected". '
  'Disputas podem gerar "claimed" (a favor do comprador) ou "refunded" (devolvido ao vendedor).';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mkt_guarantee_fund_order ON public.marketplace_guarantee_fund (order_id);
CREATE INDEX IF NOT EXISTS idx_mkt_guarantee_fund_seller ON public.marketplace_guarantee_fund (seller_id);
CREATE INDEX IF NOT EXISTS idx_mkt_guarantee_fund_buyer ON public.marketplace_guarantee_fund (buyer_id);
CREATE INDEX IF NOT EXISTS idx_mkt_guarantee_fund_event ON public.marketplace_guarantee_fund (event_type);

-- RLS: server-only (service_role bypassa, users não acessam diretamente)
ALTER TABLE public.marketplace_guarantee_fund ENABLE ROW LEVEL SECURITY;

-- Buyers can see their own guarantee events
CREATE POLICY guarantee_fund_select_buyer ON public.marketplace_guarantee_fund
  FOR SELECT USING (buyer_id = auth.uid()::text);

-- Sellers can see their own guarantee events
CREATE POLICY guarantee_fund_select_seller ON public.marketplace_guarantee_fund
  FOR SELECT USING (seller_id = auth.uid()::text);

-- Inserts: service_role only (backend)
-- No UPDATE/DELETE policies (immutable)

-- 5. Gamification task
INSERT INTO public.gamification_tasks (
  slug, name, description, category,
  xp_reward, coin_reward,
  is_repeatable, max_completions, target_count,
  is_active
) VALUES (
  'enable_guarantee_fund',
  'Vendedor Protegido',
  'Ative o fundo de garantia na sua loja para proteger seus clientes.',
  'mercado',
  60, 15,
  false, 1, 1,
  true
) ON CONFLICT (slug) DO NOTHING;

COMMIT;
