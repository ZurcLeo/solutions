-- =============================================================================
-- S6: Add 6 new seller subtypes to marketplace_seller_subtypes
-- Wires the subtypes added in sellerTypeConfig.js (S3) into the DB lookup table.
-- Safe: INSERT with ON CONFLICT DO NOTHING (idempotent).
-- =============================================================================

-- Serviços: 4 new subtypes (sort_order 19-22)
INSERT INTO marketplace_seller_subtypes (slug, label, category, icon, sort_order) VALUES
  ('passeador_pets',      'Passeador de Pets',       'servicos', 'Dog',        19),
  ('diarista',            'Diarista',                'servicos', 'SprayCan',   20),
  ('limpeza_residencial', 'Limpeza Residencial',     'servicos', 'Home',       21),
  ('reparos_informatica', 'Reparos de Informática',  'servicos', 'Monitor',    22)
ON CONFLICT (slug) DO NOTHING;

-- Produtos: 2 new subtypes (sort_order 27-28)
INSERT INTO marketplace_seller_subtypes (slug, label, category, icon, sort_order) VALUES
  ('revendedora_autonoma','Revendedora Autônoma',    'produtos', 'Briefcase',  27),
  ('consultora_beleza',   'Consultora de Beleza',    'produtos', 'Sparkles',   28)
ON CONFLICT (slug) DO NOTHING;
