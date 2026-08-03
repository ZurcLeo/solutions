-- =============================================================================
-- MARKETPLACE: IMÓVEIS — SUBTIPOS POR MODALIDADE
-- Ticket: MKTPLACE-IMOVEIS-001
-- Adds: 3 novos slugs na lookup marketplace_seller_subtypes
--       (aluguel_fixo, temporada, venda)
-- Zero-downtime: INSERT only
-- =============================================================================

INSERT INTO marketplace_seller_subtypes (slug, label, category, icon, sort_order) VALUES
  ('aluguel_fixo', 'Aluguel Fixo',       'imoveis', 'Home',          32),
  ('temporada',    'Temporada / Airbnb',  'imoveis', 'CalendarClock', 33),
  ('venda',        'Venda de Imóvel',     'imoveis', 'Building',      34)
ON CONFLICT (slug) DO NOTHING;

COMMENT ON TABLE marketplace_seller_subtypes IS 'Lookup de subtipos de vendedor por categoria. imoveis: aluguel_fixo | temporada | venda';
