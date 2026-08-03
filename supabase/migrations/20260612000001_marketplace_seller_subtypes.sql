-- =============================================================================
-- MARKETPLACE: SELLER SUBTYPES + SELLER PROFILES EXPANSION
-- Ticket: MKTPLACE-SUBTYPE-001
-- Adds: marketplace_seller_subtypes lookup, seller_subtype FK,
--       food/service-specific columns on seller_profiles
-- Zero-downtime: only ADD COLUMN (nullable) + new table
-- =============================================================================

-- 1. Lookup table de subtipos de vendedor
CREATE TABLE marketplace_seller_subtypes (
  slug          text PRIMARY KEY,
  label         text NOT NULL,
  category      text NOT NULL CHECK (
    category IN ('alimentacao','servicos','produtos','imoveis','outros')
  ),
  icon          text,
  sort_order    int  DEFAULT 0
);

-- Alimentação
INSERT INTO marketplace_seller_subtypes (slug, label, category, icon, sort_order) VALUES
  ('padaria',           'Padaria',               'alimentacao', 'Croissant',         1),
  ('restaurante',       'Restaurante',            'alimentacao', 'UtensilsCrossed',   2),
  ('pensao',            'Pensão / Quentinha',     'alimentacao', 'Soup',              3),
  ('lanchonete',        'Lanchonete',             'alimentacao', 'Sandwich',          4),
  ('hotdog',            'Hot Dog / Carrinho',     'alimentacao', 'HotDog',            5),
  ('foodtruck',         'Food Truck',             'alimentacao', 'Truck',             6);

-- Serviços
INSERT INTO marketplace_seller_subtypes (slug, label, category, icon, sort_order) VALUES
  ('barbeiro',          'Barbearia',              'servicos',    'Scissors',          10),
  ('cabeleireiro',      'Cabeleireiro(a)',         'servicos',    'Scissors',          11),
  ('advogado',          'Escritório Jurídico',    'servicos',    'Scale',             12),
  ('pedreiro',          'Pedreiro / Obras',       'servicos',    'HardHat',           13),
  ('encanador',         'Encanador',              'servicos',    'Wrench',            14),
  ('contador',          'Contabilidade',          'servicos',    'Calculator',        15),
  ('promotor_eventos',  'Promotor de Eventos',    'servicos',    'PartyPopper',       16),
  ('produtor_cultural', 'Produtor Cultural',      'servicos',    'Music',             17),
  ('professor',         'Professor / Tutor',      'servicos',    'GraduationCap',     18);

-- Produtos físicos
INSERT INTO marketplace_seller_subtypes (slug, label, category, icon, sort_order) VALUES
  ('material_construcao','Material de Construção','produtos',    'HardHat',           20),
  ('vidracaria',        'Vidraçaria',             'produtos',    'Glasses',           21),
  ('esquadrias',        'Esquadrias',             'produtos',    'DoorClosed',        22),
  ('eletrica',          'Material Elétrico',      'produtos',    'Zap',               23),
  ('hidraulica',        'Material Hidráulico',    'produtos',    'Droplets',          24),
  ('mercearia',         'Mercearia / Quitanda',   'produtos',    'ShoppingBasket',    25),
  ('outros_produtos',   'Outros Produtos',        'produtos',    'Package',           26);

-- Imóveis
INSERT INTO marketplace_seller_subtypes (slug, label, category, icon, sort_order) VALUES
  ('corretor_imoveis',  'Corretor de Imóveis',    'imoveis',     'Home',              30),
  ('imobiliaria',       'Imobiliária',            'imoveis',     'Building',          31);

-- RLS: leitura pública (é lookup)
ALTER TABLE marketplace_seller_subtypes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mss_read_all" ON marketplace_seller_subtypes
  FOR SELECT USING (true);

-- 2. Expand seller_profiles
ALTER TABLE seller_profiles
  -- Subtipo (FK p/ lookup)
  ADD COLUMN IF NOT EXISTS seller_subtype           text REFERENCES marketplace_seller_subtypes(slug),
  -- Alimentação
  ADD COLUMN IF NOT EXISTS delivery_modes           text[]  DEFAULT '{}',     -- ['delivery','pickup','dine_in']
  ADD COLUMN IF NOT EXISTS avg_prep_time_min        int,                       -- tempo médio de preparo
  -- Serviços
  ADD COLUMN IF NOT EXISTS service_mode             text[]  DEFAULT '{}',     -- ['presencial','remoto']
  ADD COLUMN IF NOT EXISTS service_area_bairros     text[]  DEFAULT '{}',     -- bairros atendidos
  -- Informações gerais
  ADD COLUMN IF NOT EXISTS cover_image_url          text,                      -- banner da loja
  ADD COLUMN IF NOT EXISTS whatsapp                 text;                      -- contato rápido

-- CHECK constraints de integridade referencial por categoria
ALTER TABLE seller_profiles
  ADD CONSTRAINT sp_delivery_modes_valid CHECK (
    delivery_modes <@ ARRAY['delivery','pickup','dine_in']::text[]
  ),
  ADD CONSTRAINT sp_service_mode_valid CHECK (
    service_mode <@ ARRAY['presencial','remoto']::text[]
  );

-- Índice para busca por subtype
CREATE INDEX IF NOT EXISTS idx_seller_profiles_subtype
  ON seller_profiles(seller_subtype);

COMMENT ON COLUMN seller_profiles.seller_subtype      IS 'Subtipo do negócio (padaria, barbeiro, etc.) — FK p/ marketplace_seller_subtypes';
COMMENT ON COLUMN seller_profiles.delivery_modes      IS 'Modos de entrega disponíveis (alimentação): delivery | pickup | dine_in';
COMMENT ON COLUMN seller_profiles.avg_prep_time_min   IS 'Tempo médio de preparo em minutos (alimentação)';
COMMENT ON COLUMN seller_profiles.service_mode        IS 'Modalidade de atendimento (serviços): presencial | remoto';
COMMENT ON COLUMN seller_profiles.service_area_bairros IS 'Lista de bairros atendidos (serviços presenciais)';
COMMENT ON COLUMN seller_profiles.cover_image_url     IS 'URL da imagem de capa/banner da loja';
COMMENT ON COLUMN seller_profiles.whatsapp            IS 'Número de WhatsApp para contato rápido';
