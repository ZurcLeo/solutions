-- [ELOS-BE/FE-007] Ciclo de vida de pedido por vertical
-- Novos status para fluxo de produtos com envio + timestamps de transição + regularização de drift

-- ═══════════════════════════════════════════════════════════════
-- 1. Regularizar colunas cancelled_* (drift — usadas no código, nunca migradas)
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS cancelled_at          TIMESTAMPTZ;
ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS cancelled_by          TEXT;
ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS cancellation_reason   TEXT;

-- ═══════════════════════════════════════════════════════════════
-- 2. Timestamps de transição (cada mudança de status registra quando aconteceu)
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS paid_at        TIMESTAMPTZ;
ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS preparing_at   TIMESTAMPTZ;  -- food: in_progress start
ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS separating_at  TIMESTAMPTZ;  -- product: separação
ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS posted_at      TIMESTAMPTZ;  -- produto postado (Correios/ME)
ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS in_transit_at  TIMESTAMPTZ;  -- em rota de entrega
ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS delivered_at   TIMESTAMPTZ;  -- entregue ao comprador
ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS completed_at   TIMESTAMPTZ;  -- pedido concluído

-- ═══════════════════════════════════════════════════════════════
-- 3. Flow do pedido — determina quais transições são válidas
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS status_flow TEXT NOT NULL DEFAULT 'food';

COMMENT ON COLUMN marketplace_orders.status_flow IS
  'Flow de status deste pedido: food | product_shipping | product_pickup | service | default';

-- ═══════════════════════════════════════════════════════════════
-- 4. Expandir CHECK constraint de status para incluir novos estados
-- ═══════════════════════════════════════════════════════════════
-- Drop o constraint antigo (nome da migration original)
ALTER TABLE marketplace_orders DROP CONSTRAINT IF EXISTS marketplace_orders_status_check;

-- Novo constraint com todos os status possíveis
ALTER TABLE marketplace_orders ADD CONSTRAINT marketplace_orders_status_check
  CHECK (status IN (
    'pending',         -- aguardando pagamento
    'paid',            -- pagamento confirmado
    'in_progress',     -- em preparo (food/service)
    'separating',      -- em separação (products)
    'posted',          -- postado nos correios/transportadora
    'in_transit',      -- em rota de entrega
    'delivered',       -- entregue ao comprador
    'completed',       -- concluído (final)
    'disputed',        -- em disputa
    'cancelled'        -- cancelado
  ));

-- ═══════════════════════════════════════════════════════════════
-- 5. Backfill: pedidos existentes — inferir status_flow
-- ═══════════════════════════════════════════════════════════════
-- Pedidos de sellers de alimentação → food
UPDATE marketplace_orders o
SET status_flow = 'food'
WHERE EXISTS (
  SELECT 1 FROM seller_profiles sp
  WHERE sp.id = o.seller_id AND sp.category = 'alimentacao'
)
AND o.status_flow = 'food';  -- idempotente (já é o default)

-- Pedidos de sellers de produtos com fulfillment_type shipping → product_shipping
UPDATE marketplace_orders o
SET status_flow = 'product_shipping'
WHERE EXISTS (
  SELECT 1 FROM seller_profiles sp
  WHERE sp.id = o.seller_id AND sp.category = 'produtos'
)
AND o.fulfillment_type = 'shipping';

-- Pedidos de sellers de produtos com pickup → product_pickup
UPDATE marketplace_orders o
SET status_flow = 'product_pickup'
WHERE EXISTS (
  SELECT 1 FROM seller_profiles sp
  WHERE sp.id = o.seller_id AND sp.category = 'produtos'
)
AND (o.fulfillment_type = 'pickup' OR o.fulfillment_type IS NULL);

-- Pedidos de sellers de serviços → service
UPDATE marketplace_orders o
SET status_flow = 'service'
WHERE EXISTS (
  SELECT 1 FROM seller_profiles sp
  WHERE sp.id = o.seller_id AND sp.category = 'servicos'
);

-- ═══════════════════════════════════════════════════════════════
-- 6. Backfill: paid_at para pedidos que já estão paid ou adiante
-- ═══════════════════════════════════════════════════════════════
UPDATE marketplace_orders
SET paid_at = updated_at
WHERE status IN ('paid', 'in_progress', 'completed')
  AND paid_at IS NULL;

-- completed_at para pedidos já concluídos
UPDATE marketplace_orders
SET completed_at = updated_at
WHERE status = 'completed'
  AND completed_at IS NULL;

-- preparing_at para pedidos in_progress (food)
UPDATE marketplace_orders
SET preparing_at = updated_at
WHERE status = 'in_progress'
  AND preparing_at IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- 7. Índice para queries de status por flow
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_orders_status_flow ON marketplace_orders (status_flow, status);
