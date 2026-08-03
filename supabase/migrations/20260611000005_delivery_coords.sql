-- =====================================================
-- MIGRAÇÃO: Coordenadas de localização com consentimento
-- [DELIVERY-LOC-001] Lat/lng para vendedor e comprador
--
-- Contexto:
--   As rotas de entrega usavam apenas fallback textual (bairro/cidade)
--   porque nenhuma das partes tinha fluxo de captura de coordenadas.
--   Esta migration adiciona os campos que permitem matching GPS preciso
--   sem quebrar o fallback textual existente (todos os campos são NULLABLE).
--
-- Alterações:
--   seller_profiles  — address_lat, address_lng, address_lat_consented_at
--   marketplace_orders — delivery_lat, delivery_lng
--
-- Modelo de consentimento:
--   seller_profiles:
--     • Capturado via mapa arrastável (AddressPickerMap + LocationConsentDialog)
--     • Consentimento explícito registrado em address_lat_consented_at
--     • Persistente: localização da loja não muda com frequência
--   marketplace_orders:
--     • Capturado no checkout via AddressPickerMap
--     • Snapshot por pedido — NÃO persiste no perfil do usuário (decisão privacidade)
--     • Usado apenas para calcular rota D2 do delivery_request
--
-- Zero-downtime:
--   • Todos os campos NULLABLE — sem lock de tabela
--   • Fallback textual continua funcionando quando campos são NULL
--
-- Depende de:
--   20260524000001_marketplace_schema.sql (seller_profiles, marketplace_orders)
--   20260610000001_delivery_schema.sql    (delivery_requests)
--
-- Agente: marketplace-agent | Revisado por: ClaudIA
-- Data: 2026-06-11
-- =====================================================


-- =====================================================
-- 1. seller_profiles — coordenadas da loja do vendedor
-- =====================================================

ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS address_lat             NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS address_lng             NUMERIC(11, 7),
  ADD COLUMN IF NOT EXISTS address_lat_consented_at TIMESTAMPTZ;

COMMENT ON COLUMN public.seller_profiles.address_lat IS
  '[DELIVERY-LOC-001] Latitude da loja do vendedor. '
  'Coletado via AddressPickerMap (Leaflet + Nominatim) com consentimento explícito via '
  'LocationConsentDialog (LGPD). NULL → matching usa fallback textual (address_city). '
  'Coordenadas em par: address_lat e address_lng sempre NULL ou ambos preenchidos.';

COMMENT ON COLUMN public.seller_profiles.address_lng IS
  '[DELIVERY-LOC-001] Longitude da loja do vendedor. Ver address_lat.';

COMMENT ON COLUMN public.seller_profiles.address_lat_consented_at IS
  '[DELIVERY-LOC-001] Timestamp do consentimento explícito do vendedor para uso das '
  'coordenadas. Necessário para trilha de auditoria LGPD (art. 7°, I). '
  'Preenchido pelo backend em createSellerProfile/updateSellerProfile quando lat/lng chegam.';

-- Índice parcial para queries de matching que filtram por cidade+coords
CREATE INDEX IF NOT EXISTS idx_seller_profiles_coords
  ON public.seller_profiles (address_lat, address_lng)
  WHERE address_lat IS NOT NULL AND address_lng IS NOT NULL;


-- =====================================================
-- 2. marketplace_orders — snapshot de entrega do comprador
-- =====================================================

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS delivery_lat NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS delivery_lng NUMERIC(11, 7);

COMMENT ON COLUMN public.marketplace_orders.delivery_lat IS
  '[DELIVERY-LOC-001] Latitude do endereço de entrega capturado no checkout. '
  'Snapshot por pedido — NÃO persiste no perfil do comprador (decisão de privacidade). '
  'Propagado para delivery_requests.dest_lat ao criar o delivery_request. '
  'NULL → delivery_request usa fallback textual (delivery_city).';

COMMENT ON COLUMN public.marketplace_orders.delivery_lng IS
  '[DELIVERY-LOC-001] Longitude do endereço de entrega. Ver delivery_lat.';


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar.
-- =====================================================

-- V1. Confirmar colunas em seller_profiles:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'seller_profiles'
--   AND column_name IN ('address_lat','address_lng','address_lat_consented_at')
-- ORDER BY column_name;
-- Esperado: 3 linhas, todas nullable=YES.

-- V2. Confirmar colunas em marketplace_orders:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'marketplace_orders'
--   AND column_name IN ('delivery_lat','delivery_lng')
-- ORDER BY column_name;
-- Esperado: 2 linhas, ambas nullable=YES.

-- V3. Índice criado:
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'seller_profiles' AND indexname = 'idx_seller_profiles_coords';
-- Esperado: 1 linha.
