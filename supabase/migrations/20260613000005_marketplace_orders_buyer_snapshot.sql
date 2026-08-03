-- Migration: 20260613000005_marketplace_orders_buyer_snapshot.sql
--
-- Adiciona snapshot imutável do comprador à tabela marketplace_orders.
--
-- Motivação:
--   Um pedido precisa carregar dados suficientes para ser executado em todo o
--   seu ciclo de vida — criação → pagamento → separação → entrega → avaliação.
--   Foto e nome do comprador são compartilhados com o vendedor e o entregador.
--   Se o comprador atualizar o perfil após a compra, o pedido não deve mudar.
--
-- Estratégia: snapshot no momento da criação (imutável por convenção de app).

ALTER TABLE marketplace_orders
  ADD COLUMN IF NOT EXISTS buyer_snapshot JSONB DEFAULT '{}' NOT NULL;

COMMENT ON COLUMN marketplace_orders.buyer_snapshot IS
  'Snapshot imutável do perfil do comprador capturado no momento da criação do pedido.
   Estrutura: { full_name TEXT, photo_url TEXT, username TEXT }.
   Compartilhado com vendedor e entregador durante o ciclo de vida do pedido.
   Nunca deve ser atualizado após a inserção.';

-- Índice parcial para consultas que verificam se o snapshot está preenchido
-- (útil para jobs de backfill de pedidos antigos)
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_missing_buyer_snapshot
  ON marketplace_orders ((buyer_snapshot = '{}'))
  WHERE buyer_snapshot = '{}';
