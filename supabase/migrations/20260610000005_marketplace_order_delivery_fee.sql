-- =====================================================
-- MIGRAÇÃO: Campo delivery_fee em marketplace_orders
-- [DELIVERY-004] Armazena o valor do frete pago pelo comprador
--
-- Diferente de delivery_requests.accepted_fee, este campo
-- reflete exatamente o que o comprador pagou no checkout,
-- considerando regras de freight_mode (seller_pays/split).
--
-- Data: 2026-06-10
-- =====================================================

ALTER TABLE public.marketplace_orders
    ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(8, 2) NOT NULL DEFAULT 0.00;

COMMENT ON COLUMN public.marketplace_orders.delivery_fee IS
    '[DELIVERY-004] Valor do frete cobrado do comprador neste pedido. '
    'Calculado no checkout baseado no matching de entregadores e freight_mode do vendedor.';

-- Atualiza restrição de total para incluir o frete
ALTER TABLE public.marketplace_orders
    DROP CONSTRAINT IF EXISTS marketplace_orders_total_lte_subtotal;

ALTER TABLE public.marketplace_orders
    ADD CONSTRAINT marketplace_orders_total_check_v2
    CHECK (total_brl = (subtotal_brl + delivery_fee - coins_discount_brl));
