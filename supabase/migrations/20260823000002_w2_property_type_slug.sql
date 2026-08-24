-- W2: Tipo de imóvel como coluna top-level para filtros eficientes
ALTER TABLE marketplace_products
  ADD COLUMN IF NOT EXISTS property_type_slug TEXT;

-- CHECK: apenas valores válidos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_property_type_slug'
  ) THEN
    ALTER TABLE marketplace_products
      ADD CONSTRAINT chk_property_type_slug CHECK (
        property_type_slug IS NULL OR
        property_type_slug IN (
          'apartamento','casa','terreno','sala_comercial',
          'kitnet','cobertura','sobrado','chacara','galpao','loja'
        )
      );
  END IF;
END $$;

-- Índice para filtro
CREATE INDEX IF NOT EXISTS idx_products_property_type_slug
  ON marketplace_products(property_type_slug)
  WHERE property_type_slug IS NOT NULL;
