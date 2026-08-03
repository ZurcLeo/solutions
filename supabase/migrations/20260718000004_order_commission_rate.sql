-- Add commission_rate to marketplace_orders to persist the rate applied at order time
ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,4);
COMMENT ON COLUMN marketplace_orders.commission_rate IS 'Taxa de comissão aplicada no momento do pedido (0.05 = 5%)';
