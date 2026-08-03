-- =====================================================
-- [HYPER-001] PostGIS + fulfillment_types + location
-- Épico: Descoberta Hiper-Local (ElosCloud Mercado Local)
--
-- Alterações:
--   • seller_profiles  — location GEOGRAPHY + location_public + location_consented_at + índice GIST
--   • marketplace_products — fulfillment_types TEXT[] + CHECK + índice GIN
--   • marketplace_orders   — fulfillment_type (snapshot) + delivery_address + scheduled_at
--
-- 6 slugs válidos de fulfillment:
--   pickup | local_delivery | shipping | in_person_service | remote_service | barter_meeting
--
-- Zero-downtime:
--   • Novos campos NULLABLE ou com DEFAULT → sem bloqueio de tabela
--   • Produtos/pedidos existentes recebem DEFAULT '{pickup}' / 'pickup' automaticamente
--   • Índices criados com CONCURRENTLY (requer fora de transaction block → ver nota abaixo)
--
-- NOTA POSTGIS: Supabase já disponibiliza PostGIS por padrão.
-- CREATE EXTENSION IF NOT EXISTS postgis é idempotente.
--
-- Depende de: 20260524000001_marketplace_schema.sql (seller_profiles, marketplace_products, marketplace_orders)
-- Agente: infra-agent | Revisado por: ClaudIA
-- Data: 2026-05-25
-- =====================================================


-- =====================================================
-- 0. PostGIS
-- =====================================================

CREATE EXTENSION IF NOT EXISTS postgis;

COMMENT ON EXTENSION postgis IS
    '[HYPER-001] Extensão geoespacial usada para busca por distância (ST_DWithin, ST_Distance) '
    'no Mercado Local hiper-local.';


-- =====================================================
-- 1. seller_profiles — campos de localização LGPD-safe
-- =====================================================

ALTER TABLE public.seller_profiles
    ADD COLUMN IF NOT EXISTS location               GEOGRAPHY(Point, 4326),
    ADD COLUMN IF NOT EXISTS location_public        TEXT,
    ADD COLUMN IF NOT EXISTS location_consented_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.seller_profiles.location IS
    '[HYPER-001] Coordenadas geográficas do vendedor — GEOGRAPHY(Point, 4326) WGS84. '
    'NUNCA exposta via API: usada exclusivamente para cálculo de distância server-side. '
    'Preenchida apenas após consentimento LGPD (location_consented_at NOT NULL). '
    'Removida via DELETE /api/marketplace/seller/location (HYPER-005, direito ao esquecimento).';

COMMENT ON COLUMN public.seller_profiles.location_public IS
    '[HYPER-001] Representação textual da localização — ex: "Rocinha, RJ". '
    'Exibida ao comprador no catálogo; não contém coordenadas brutas. '
    'Definida pelo vendedor ou inferida de address_neighborhood + address_city.';

COMMENT ON COLUMN public.seller_profiles.location_consented_at IS
    '[HYPER-001][LGPD Art. 7 I] Timestamp do consentimento explícito do vendedor '
    'para coleta e armazenamento de coordenadas geográficas precisas. '
    'NULL = coordenadas não coletadas. Preenchido via tela de consentimento (HYPER-005).';

-- Índice GIST para ST_DWithin / ST_Distance — partial (só linhas com location preenchido)
CREATE INDEX IF NOT EXISTS idx_seller_location
    ON public.seller_profiles USING GIST (location)
    WHERE location IS NOT NULL;


-- =====================================================
-- 2. marketplace_products — fulfillment_types
-- =====================================================

ALTER TABLE public.marketplace_products
    ADD COLUMN IF NOT EXISTS fulfillment_types  TEXT[]  NOT NULL  DEFAULT '{pickup}';

-- CHECK: array não-vazio e todos os slugs dentro do conjunto válido
-- cardinality() retorna 0 para array vazio e NULL para NULL (coluna é NOT NULL aqui)
-- <@ verifica se fulfillment_types é subconjunto do array de slugs válidos
ALTER TABLE public.marketplace_products
    ADD CONSTRAINT marketplace_products_fulfillment_check
    CHECK (
        cardinality(fulfillment_types) > 0
        AND fulfillment_types <@ ARRAY[
            'pickup',
            'local_delivery',
            'shipping',
            'in_person_service',
            'remote_service',
            'barter_meeting'
        ]::TEXT[]
    );

COMMENT ON COLUMN public.marketplace_products.fulfillment_types IS
    '[HYPER-001] Modalidades de entrega/execução disponíveis para este produto. '
    'Slugs válidos: pickup | local_delivery | shipping | in_person_service | remote_service | barter_meeting. '
    'Defaults por categoria de vendedor (aplicados no onboarding — HYPER-004): '
    '  alimentacao → {local_delivery,pickup} '
    '  servicos    → {in_person_service,remote_service} '
    '  produtos    → {pickup,shipping} '
    '  obra        → {in_person_service} '
    '  is_barter_only=true → {barter_meeting}. '
    'Pelo menos um slug obrigatório (cardinality > 0). '
    'Produtos existentes recebem DEFAULT ''{pickup}'' automaticamente (zero-downtime).';

-- Índice GIN para consultas ANY(), @> e &&
CREATE INDEX IF NOT EXISTS idx_marketplace_products_fulfillment
    ON public.marketplace_products USING GIN (fulfillment_types);


-- =====================================================
-- 3. marketplace_orders — snapshot de fulfillment + entrega
-- =====================================================

-- fulfillment_type: snapshot imutável do tipo selecionado pelo comprador
-- DEFAULT 'pickup' garante zero-downtime para pedidos existentes
ALTER TABLE public.marketplace_orders
    ADD COLUMN IF NOT EXISTS fulfillment_type   TEXT        NOT NULL  DEFAULT 'pickup',
    ADD COLUMN IF NOT EXISTS delivery_address   JSONB,
    ADD COLUMN IF NOT EXISTS scheduled_at       TIMESTAMPTZ;

ALTER TABLE public.marketplace_orders
    ADD CONSTRAINT marketplace_orders_fulfillment_type_check
    CHECK (
        fulfillment_type IN (
            'pickup',
            'local_delivery',
            'shipping',
            'in_person_service',
            'remote_service',
            'barter_meeting'
        )
    );

COMMENT ON COLUMN public.marketplace_orders.fulfillment_type IS
    '[HYPER-001] Snapshot imutável da modalidade de entrega contratada no momento do pedido. '
    'Copiado de marketplace_products.fulfillment_types (tipo selecionado pelo comprador). '
    'NUNCA atualizar após created_at — faz parte do contrato do pedido.';

COMMENT ON COLUMN public.marketplace_orders.delivery_address IS
    '[HYPER-001] Endereço de entrega para local_delivery e shipping. '
    'Formato esperado: {"street":"...","number":"...","complement":"...","neighborhood":"...","city":"...","state":"...","zip":"..."}. '
    'NULL para pickup, in_person_service, remote_service e barter_meeting. '
    'Nunca armazena coordenadas — apenas endereço textual.';

COMMENT ON COLUMN public.marketplace_orders.scheduled_at IS
    '[HYPER-001] Data/hora agendada para serviços presenciais (in_person_service) '
    'e encontros de troca (barter_meeting). '
    'NULL para modalidades sem agendamento (pickup, local_delivery, shipping, remote_service).';


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar esta migration.
-- =====================================================

-- V1. PostGIS habilitado:
-- SELECT extname, extversion FROM pg_extension WHERE extname = 'postgis';
-- Esperado: 1 linha.

-- V2. Colunas de localização em seller_profiles:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'seller_profiles'
--   AND column_name IN ('location', 'location_public', 'location_consented_at')
-- ORDER BY column_name;
-- Esperado: 3 linhas.

-- V3. Índice GIST criado:
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE schemaname = 'public' AND tablename = 'seller_profiles'
--   AND indexname = 'idx_seller_location';
-- Esperado: 1 linha com "USING gist".

-- V4. fulfillment_types em marketplace_products:
-- SELECT column_name, data_type, column_default FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'marketplace_products'
--   AND column_name = 'fulfillment_types';
-- Esperado: 1 linha, data_type = 'ARRAY', column_default = '{pickup}'.

-- V5. Índice GIN criado:
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE schemaname = 'public' AND tablename = 'marketplace_products'
--   AND indexname = 'idx_marketplace_products_fulfillment';
-- Esperado: 1 linha com "USING gin".

-- V6. Colunas de fulfillment em marketplace_orders:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'marketplace_orders'
--   AND column_name IN ('fulfillment_type', 'delivery_address', 'scheduled_at')
-- ORDER BY column_name;
-- Esperado: 3 linhas.

-- V7. Smoke test — produtos existentes têm fulfillment_types = '{pickup}':
-- SELECT COUNT(*) FROM public.marketplace_products WHERE fulfillment_types = '{pickup}';
-- (Não é zero → confirma que o DEFAULT foi aplicado retroativamente)
