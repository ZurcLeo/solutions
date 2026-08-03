-- Migration: icon_payment_support
-- Adiciona suporte a pagamentos via IconChat (pix_iconchat) e index DLQ.

-- 1. Expandir CHECK de payment_method para incluir 'pix_iconchat'
ALTER TABLE public.marketplace_orders
  DROP CONSTRAINT IF EXISTS marketplace_orders_payment_method_check;

ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT marketplace_orders_payment_method_check
    CHECK (payment_method IS NULL OR payment_method IN (
      'pix', 'stripe', 'eloscoins', 'hybrid', 'offline_confirmed', 'pix_iconchat'
    ));

-- 2. Index para DLQ admin queries (webhooks abandonados)
CREATE INDEX IF NOT EXISTS idx_wdl_abandoned
    ON public.webhook_delivery_log (created_at DESC)
    WHERE status = 'abandoned';
