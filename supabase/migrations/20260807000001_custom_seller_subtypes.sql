-- 20260807000001_custom_seller_subtypes.sql
-- Subtipos "Outros" com label customizado para categorias sem escape hatch.

-- 1. Inserir subtipos "Outros" nas categorias que ainda não têm
INSERT INTO marketplace_seller_subtypes (slug, category, label, sort_order)
VALUES
  ('outros_alimentacao', 'alimentacao', 'Outro tipo', 99),
  ('outros_servicos',    'servicos',    'Outro tipo', 99),
  ('outros_imoveis',     'imoveis',     'Outro tipo', 99)
ON CONFLICT DO NOTHING;

-- 2. Coluna para label personalizado quando subtipo é "outros_*"
ALTER TABLE seller_profiles
  ADD COLUMN IF NOT EXISTS seller_subtype_custom TEXT;

-- 3. Constraint: se preenchido, deve ter entre 3 e 60 caracteres (trimmed)
ALTER TABLE seller_profiles
  ADD CONSTRAINT chk_seller_subtype_custom_length
  CHECK (seller_subtype_custom IS NULL OR char_length(trim(seller_subtype_custom)) BETWEEN 3 AND 60);
