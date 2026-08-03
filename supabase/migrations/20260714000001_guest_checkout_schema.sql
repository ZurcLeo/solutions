-- =====================================================
-- GUEST-001 · Guest Checkout — Venda para Clientes sem Conta
--
-- Permite que visitantes (sem cadastro) naveguem lojas públicas
-- e façam pedidos via PIX/Cartão de Crédito.
--
-- Tabelas novas:
--   guest_buyers          — dados mínimos do comprador guest
--
-- ALTERs:
--   seller_profiles       — +accepts_guest_orders (toggle opt-out)
--   marketplace_orders    — buyer_id nullable, +guest_buyer_id, +guest_order_token
--
-- Data: 2026-07-14
-- =====================================================

BEGIN;

-- ═══ 1. guest_buyers ═══
CREATE TABLE IF NOT EXISTS public.guest_buyers (
  id         TEXT PRIMARY KEY DEFAULT 'gb_' || gen_random_uuid()::text,
  full_name  TEXT NOT NULL,
  email      TEXT NOT NULL,
  phone      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_buyers_email
  ON public.guest_buyers (lower(email));

-- updated_at auto-update via trigger
CREATE OR REPLACE FUNCTION public.guest_buyers_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_guest_buyers_updated_at
  BEFORE UPDATE ON public.guest_buyers
  FOR EACH ROW EXECUTE FUNCTION public.guest_buyers_set_updated_at();

COMMENT ON TABLE public.guest_buyers IS
  '[GUEST-001] Compradores visitantes (sem conta). '
  'Dados mínimos para processar pedido + Asaas customer. '
  'Isolado de users para não poluir gamificação/trust/KYC.';

-- RLS: service_role only (backend gerencia via service key)
ALTER TABLE public.guest_buyers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_buyers FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.guest_buyers TO service_role;


-- ═══ 2. seller_profiles: opt-out toggle ═══
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS accepts_guest_orders BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.seller_profiles.accepts_guest_orders IS
  '[GUEST-001] Se true, a loja é acessível via URL pública /negocio/:sellerId. '
  'Default true (D1: automático com opt-out).';


-- ═══ 3. marketplace_orders: suporte a guest ═══

-- 3a. Remover NOT NULL de buyer_id (guest orders têm buyer_id=NULL)
ALTER TABLE public.marketplace_orders ALTER COLUMN buyer_id DROP NOT NULL;

-- 3b. Novas colunas
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS guest_buyer_id TEXT REFERENCES public.guest_buyers(id);

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS guest_order_token TEXT;

-- 3c. CHECK: exatamente um dos dois (buyer ou guest) deve estar preenchido
-- Drop first in case re-running
ALTER TABLE public.marketplace_orders
  DROP CONSTRAINT IF EXISTS chk_buyer_source;

ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT chk_buyer_source CHECK (
    (buyer_id IS NOT NULL AND guest_buyer_id IS NULL) OR
    (buyer_id IS NULL AND guest_buyer_id IS NOT NULL)
  );

-- 3d. Indexes para guest columns
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_guest_token
  ON public.marketplace_orders (guest_order_token) WHERE guest_order_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_guest_buyer
  ON public.marketplace_orders (guest_buyer_id) WHERE guest_buyer_id IS NOT NULL;

-- 3e. Expandir payment_method CHECK para incluir 'credit_card'
ALTER TABLE public.marketplace_orders
  DROP CONSTRAINT IF EXISTS marketplace_orders_payment_method_check;

ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT marketplace_orders_payment_method_check
    CHECK (payment_method IS NULL OR payment_method IN (
      'pix', 'stripe', 'eloscoins', 'hybrid', 'offline_confirmed', 'pix_iconchat', 'credit_card'
    ));

COMMENT ON COLUMN public.marketplace_orders.guest_buyer_id IS
  '[GUEST-001] FK para guest_buyers. Preenchido quando pedido é de visitante (buyer_id=NULL).';

COMMENT ON COLUMN public.marketplace_orders.guest_order_token IS
  '[GUEST-001] Token HMAC-SHA256(orderId, GUEST_ORDER_SECRET) para tracking público do pedido. '
  'Determinístico — pode ser recomputado. Previne enumeração de pedidos.';

COMMIT;
