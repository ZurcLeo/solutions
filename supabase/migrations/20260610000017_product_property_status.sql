-- IMOV-009: Status do imóvel (state machine)
ALTER TABLE marketplace_products
  ADD COLUMN IF NOT EXISTS property_status text DEFAULT 'disponivel'
  CHECK (property_status IN ('disponivel','reservado','alugado','vendido','inativo'));

CREATE INDEX IF NOT EXISTS idx_marketplace_products_property_status
  ON marketplace_products(property_status)
  WHERE property_status IS NOT NULL;
