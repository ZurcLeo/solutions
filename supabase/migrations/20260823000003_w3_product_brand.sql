-- W3: Campo marca/brand para produtos físicos
ALTER TABLE marketplace_products
  ADD COLUMN IF NOT EXISTS brand TEXT;

-- Índice para busca por marca
CREATE INDEX IF NOT EXISTS idx_products_brand
  ON marketplace_products(brand)
  WHERE brand IS NOT NULL;
