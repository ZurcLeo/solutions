-- =============================================================================
-- MARKETPLACE: marketplace_products — adiciona coluna service_mode
-- Ticket: MKTPLACE-PRODUCTS-001
-- Contexto: ProductValidator.js e marketplaceService.js já usavam service_mode
--           para produtos do tipo 'service', mas a coluna não foi criada na
--           migration 20260612000002_marketplace_product_types.sql.
-- Zero-downtime: ADD COLUMN nullable sem DEFAULT volátil
-- =============================================================================

ALTER TABLE marketplace_products
  ADD COLUMN IF NOT EXISTS service_mode text
    CHECK (service_mode IN ('presencial', 'remoto', 'hibrido'));

COMMENT ON COLUMN marketplace_products.service_mode IS
  'Modalidade de atendimento do serviço: presencial | remoto | hibrido (exclusivo product_type=service)';
