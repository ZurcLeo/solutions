-- =====================================================
-- MIGRACAO: preferred_deliverer_service_id em marketplace_orders
-- [DELIVERY-006] Registra a preferencia do comprador por entregador
--
-- Quando o comprador seleciona um entregador na vitrine do
-- ProductDetail, o service_id e salvo no pedido. No matching
-- pos-pagamento (requestDelivery), esse entregador e contatado
-- primeiro. Se nao aceitar no timeout, cai no pool normal.
--
-- Depende de:
--   20260524000001_marketplace_schema.sql (marketplace_orders)
--   20260610000001_delivery_schema.sql (delivery_services)
--
-- Agente: marketplace-agent | Revisado por: ClaudIA
-- Data: 2026-06-19
-- =====================================================

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS preferred_deliverer_service_id TEXT
    REFERENCES public.delivery_services(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.marketplace_orders.preferred_deliverer_service_id IS
  '[DELIVERY-006] ID da loja de entrega preferida pelo comprador durante o checkout. '
  'Usado como dica no matching automatico (requestDelivery): esse entregador e '
  'notificado primeiro. NULL = sem preferencia (matching puro por posicao/distancia). '
  'ON DELETE SET NULL: se o entregador desativar a conta, o pedido nao quebra.';
