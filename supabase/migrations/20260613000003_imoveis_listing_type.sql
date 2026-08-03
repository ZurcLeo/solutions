-- =============================================================================
-- MIGRATION: Imóveis — listing_type no produto, seller_subtype como identidade
-- Ticket: MKTPLACE-IMOVEIS-003
--
-- Problema: seller_subtype era usado como tipo de anúncio (aluguel_fixo/temporada/venda),
--           mas é exclusivo — um corretor não pode ser aluguel_fixo E venda ao mesmo tempo.
--
-- Solução:
--   1. listing_type TEXT na marketplace_products — tipo do anúncio (aluguel_fixo|temporada|venda)
--   2. seller_subtype de imoveis passa a descrever QUEM é o vendedor:
--      corretor_imobiliaria (aluga fixo + vende) | agencia_locatario (temporada/Airbnb)
--
-- Zero-downtime:
--   - ADD COLUMN nullable (sem DEFAULT forçado)
--   - UPDATE de seller_subtype mapeado dos valores antigos
--   - DELETE/INSERT na lookup com CASCADE seguro (UPDATE seller_profiles antes)
-- =============================================================================

-- 1. Novo campo listing_type em marketplace_products
ALTER TABLE public.marketplace_products
  ADD COLUMN IF NOT EXISTS listing_type TEXT
  CHECK (listing_type IN ('aluguel_fixo', 'temporada', 'venda'));

COMMENT ON COLUMN public.marketplace_products.listing_type IS
  'Tipo de anúncio para imóveis: aluguel_fixo | temporada | venda. Independente do subtipo do vendedor.';

CREATE INDEX IF NOT EXISTS idx_mp_listing_type
  ON public.marketplace_products(listing_type)
  WHERE listing_type IS NOT NULL;

-- 2. Migrar seller_profiles que usam os antigos subtypes de imoveis
--    aluguel_fixo → corretor_imobiliaria
--    venda        → corretor_imobiliaria
--    temporada    → agencia_locatario
UPDATE public.seller_profiles
SET seller_subtype = CASE seller_subtype
  WHEN 'aluguel_fixo' THEN 'corretor_imobiliaria'
  WHEN 'venda'        THEN 'corretor_imobiliaria'
  WHEN 'temporada'    THEN 'agencia_locatario'
END
WHERE seller_subtype IN ('aluguel_fixo', 'venda', 'temporada');

-- 3. Migrar listing_type nos produtos a partir do seller_subtype antigo da FK
--    (retrocompatibilidade: inferir a partir de produto.property_details se possível)
UPDATE public.marketplace_products mp
SET listing_type = s.seller_subtype
FROM public.seller_profiles s
WHERE mp.seller_id = s.id
  AND s.seller_subtype IN ('aluguel_fixo', 'venda', 'temporada')
  AND mp.listing_type IS NULL
  AND mp.product_type = 'property';

-- 4. Remover subtypes antigos da lookup e inserir os novos
DELETE FROM public.marketplace_seller_subtypes
  WHERE slug IN ('aluguel_fixo', 'temporada', 'venda');

INSERT INTO public.marketplace_seller_subtypes (slug, label, category, icon, sort_order) VALUES
  ('corretor_imobiliaria', 'Corretor / Imobiliária', 'imoveis', 'Building2',    32),
  ('agencia_locatario',    'Agência / Locatário',    'imoveis', 'CalendarClock', 33)
ON CONFLICT (slug) DO UPDATE
  SET label = EXCLUDED.label, icon = EXCLUDED.icon, sort_order = EXCLUDED.sort_order;

COMMENT ON TABLE public.marketplace_seller_subtypes IS
  'Lookup de subtipos de vendedor por categoria. imoveis: corretor_imobiliaria | agencia_locatario';
