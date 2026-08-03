-- =====================================================
-- [HYPER-002] Função products_near — Busca geoespacial
-- Épico: Descoberta Hiper-Local (ElosCloud Mercado Local)
--
-- Função: public.products_near(lat, lng, fulfillment_filter[], max_browse_km, neighborhood, city, limit, offset)
-- Encapsula a lógica de filtragem por tipo de fulfillment + distância PostGIS.
--
-- Regras de distância por tipo:
--   local_delivery / in_person_service → buyer dentro do raio do vendedor (service_radius_km)
--   pickup                             → vendedor dentro do raio de browsing do comprador (max_browse_km)
--   shipping / remote_service          → sem filtro geográfico (sempre incluídos)
--   barter_meeting                     → texto (neighborhood/city); geo opcional
--
-- Ordenação: geo-locais em primeiro (por dist ASC) → nacionais → barter/sem match
-- Privacidade:
--   - Coords do comprador: recebidas, usadas, NUNCA armazenadas
--   - distance_band: faixa textual (<1km, 1-3km, 3-10km, >10km, online) — nunca valor exato
--   - seller.location: NUNCA retornado no output (campo GEOGRAPHY é interno)
--
-- Depende de: 20260525000013_hyper001_postgis_fulfillment.sql (postgis + colunas)
-- Agente: marketplace-agent + infra-agent | Revisado por: ClaudIA
-- Data: 2026-05-25
-- =====================================================


CREATE OR REPLACE FUNCTION public.products_near(
    p_lat             FLOAT    DEFAULT NULL,
    p_lng             FLOAT    DEFAULT NULL,
    p_fulfillment     TEXT[]   DEFAULT NULL,   -- NULL = sem filtro de tipo
    p_max_browse_km   FLOAT    DEFAULT 10.0,   -- raio de browsing para 'pickup'
    p_neighborhood    TEXT     DEFAULT NULL,   -- filtro textual de bairro (fallback)
    p_city            TEXT     DEFAULT NULL,   -- filtro textual de cidade (fallback)
    p_limit           INT      DEFAULT 20,
    p_offset          INT      DEFAULT 0
)
RETURNS TABLE (
    id                          TEXT,
    seller_id                   TEXT,
    name                        TEXT,
    description                 TEXT,
    category                    TEXT,
    price_brl                   NUMERIC,
    max_coins_discount          INT,
    stock                       INT,
    images                      TEXT[],
    fulfillment_types           TEXT[],
    created_at                  TIMESTAMPTZ,
    seller_business_name        TEXT,
    seller_trading_name         TEXT,
    seller_location_public      TEXT,
    seller_category             TEXT,
    seller_accepts_eloscoins    BOOLEAN,
    seller_coins_discount_rate  NUMERIC,
    seller_max_coins_per_order  INT,
    seller_service_radius_km    INT,
    distance_band               TEXT,
    total_count                 BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_buyer_pt  GEOGRAPHY;
    v_use_geo   BOOLEAN;
BEGIN
    v_use_geo := (p_lat IS NOT NULL AND p_lng IS NOT NULL);

    IF v_use_geo THEN
        v_buyer_pt := ST_MakePoint(p_lng, p_lat)::geography;
    END IF;

    RETURN QUERY
    WITH candidates AS (
        SELECT
            p.id,
            p.seller_id,
            p.name,
            p.description,
            p.category,
            p.price_brl,
            p.max_coins_discount,
            p.stock,
            p.images,
            p.fulfillment_types,
            p.created_at,
            s.business_name         AS seller_business_name,
            s.trading_name          AS seller_trading_name,
            s.location_public       AS seller_location_public,
            s.category              AS seller_category,
            s.accepts_eloscoins     AS seller_accepts_eloscoins,
            s.coins_discount_rate   AS seller_coins_discount_rate,
            s.max_coins_per_order   AS seller_max_coins_per_order,
            s.service_radius_km     AS seller_service_radius_km,

            -- Distância em metros (NULL se sem coords ou vendedor sem location)
            CASE
                WHEN v_use_geo AND s.location IS NOT NULL
                THEN ST_Distance(s.location, v_buyer_pt)
                ELSE NULL
            END AS dist_m,

            -- Prioridade de ordenação
            --   1 = geo-local dentro do raio (melhor)
            --   2 = nacional / online
            --   3 = sem match geo (out-of-range, sem location, barter)
            --   Sem coords: tudo = 1 → ordenação cai para created_at DESC
            CASE
                WHEN NOT v_use_geo THEN 1
                WHEN v_use_geo AND s.location IS NOT NULL AND (
                    (
                        (p.fulfillment_types && ARRAY['local_delivery','in_person_service']::TEXT[])
                        AND ST_DWithin(s.location, v_buyer_pt, s.service_radius_km::float * 1000)
                    )
                    OR (
                        'pickup' = ANY(p.fulfillment_types)
                        AND ST_DWithin(s.location, v_buyer_pt, p_max_browse_km * 1000)
                    )
                ) THEN 1
                WHEN p.fulfillment_types && ARRAY['shipping','remote_service']::TEXT[] THEN 2
                ELSE 3
            END AS sort_priority

        FROM public.marketplace_products p
        JOIN public.seller_profiles s ON s.id = p.seller_id
        WHERE
            p.active = true
            AND s.status = 'active'

            -- ── Filtro por tipo de fulfillment ─────────────────────────────
            AND (
                p_fulfillment IS NULL
                OR cardinality(p_fulfillment) = 0
                OR p.fulfillment_types && p_fulfillment
            )

            -- ── Filtro geoespacial ──────────────────────────────────────────
            -- Bypassa inteiro se sem coords (v_use_geo = false).
            -- Com coords: ao menos UM tipo compatível deve passar seu critério de distância.
            AND (
                NOT v_use_geo
                OR (
                    -- Tipos sem restrição geográfica (sempre passam se no filtro)
                    (
                        'shipping' = ANY(p.fulfillment_types)
                        AND (p_fulfillment IS NULL OR 'shipping' = ANY(p_fulfillment))
                    )
                    OR (
                        'remote_service' = ANY(p.fulfillment_types)
                        AND (p_fulfillment IS NULL OR 'remote_service' = ANY(p_fulfillment))
                    )
                    OR (
                        'barter_meeting' = ANY(p.fulfillment_types)
                        AND (p_fulfillment IS NULL OR 'barter_meeting' = ANY(p_fulfillment))
                    )
                    -- local_delivery / in_person_service: buyer dentro do raio do vendedor
                    OR (
                        (
                            (
                                'local_delivery' = ANY(p.fulfillment_types)
                                AND (p_fulfillment IS NULL OR 'local_delivery' = ANY(p_fulfillment))
                            )
                            OR (
                                'in_person_service' = ANY(p.fulfillment_types)
                                AND (p_fulfillment IS NULL OR 'in_person_service' = ANY(p_fulfillment))
                            )
                        )
                        AND (
                            s.location IS NULL   -- vendedor sem location: inclui como fallback
                            OR ST_DWithin(s.location, v_buyer_pt, s.service_radius_km::float * 1000)
                        )
                    )
                    -- pickup: vendedor dentro do raio de browsing do comprador
                    OR (
                        'pickup' = ANY(p.fulfillment_types)
                        AND (p_fulfillment IS NULL OR 'pickup' = ANY(p_fulfillment))
                        AND (
                            s.location IS NULL
                            OR ST_DWithin(s.location, v_buyer_pt, p_max_browse_km * 1000)
                        )
                    )
                )
            )

            -- ── Fallback textual por bairro/cidade ─────────────────────────
            -- Aplicado independentemente de coords (complementa geo ou substitui quando sem coords).
            AND (
                p_neighborhood IS NULL
                OR s.address_neighborhood ILIKE '%' || p_neighborhood || '%'
                OR s.location_public ILIKE '%' || p_neighborhood || '%'
            )
            AND (
                p_city IS NULL
                OR s.address_city ILIKE '%' || p_city || '%'
                OR s.location_public ILIKE '%' || p_city || '%'
            )
    ),
    -- COUNT(*) OVER() antes do LIMIT para retornar total sem query extra
    ranked AS (
        SELECT
            c.*,
            COUNT(*) OVER() AS total_count
        FROM candidates c
        ORDER BY
            c.sort_priority ASC,
            c.dist_m        ASC NULLS LAST,
            c.created_at    DESC
        LIMIT  p_limit
        OFFSET p_offset
    )
    SELECT
        r.id,
        r.seller_id,
        r.name,
        r.description,
        r.category,
        r.price_brl,
        r.max_coins_discount,
        r.stock,
        r.images,
        r.fulfillment_types,
        r.created_at,
        r.seller_business_name,
        r.seller_trading_name,
        r.seller_location_public,
        r.seller_category,
        r.seller_accepts_eloscoins,
        r.seller_coins_discount_rate,
        r.seller_max_coins_per_order,
        r.seller_service_radius_km,
        -- Faixa de distância — nunca valor exato (privacidade)
        CASE
            WHEN r.dist_m IS NULL                     THEN 'online'
            WHEN r.dist_m < 1000                      THEN '<1km'
            WHEN r.dist_m < 3000                      THEN '1-3km'
            WHEN r.dist_m < 10000                     THEN '3-10km'
            ELSE                                           '>10km'
        END AS distance_band,
        r.total_count
    FROM ranked r;
END;
$$;

COMMENT ON FUNCTION public.products_near(FLOAT, FLOAT, TEXT[], FLOAT, TEXT, TEXT, INT, INT) IS
    '[HYPER-002] Busca geoespacial de produtos do Mercado Local. '
    'Parâmetros de entrada: coords opcionais (lat/lng), filtro de fulfillment_types, '
    'raio de browsing (pickup), fallback textual (neighborhood, city), paginação. '
    'Retorna produtos ordenados: geo-locais mais próximos → nacionais/online → barter. '
    'seller.location (GEOGRAPHY) nunca é retornado. '
    'distance_band é faixa textual (<1km | 1-3km | 3-10km | >10km | online). '
    'SECURITY DEFINER: evita RLS em seller_profiles via authenticated role.';


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- =====================================================

-- V1. Função criada:
-- SELECT routine_name, routine_type FROM information_schema.routines
-- WHERE routine_schema = 'public' AND routine_name = 'products_near';
-- Esperado: 1 linha.

-- V2. Smoke test sem coords (retorna todos os produtos ativos):
-- SELECT id, name, distance_band, total_count
-- FROM public.products_near(NULL, NULL, NULL, 10, NULL, NULL, 5, 0);
-- Esperado: até 5 produtos com distance_band = 'online'.

-- V3. Smoke test com coords fictícias no RJ (sem produtos geo-indexados ainda):
-- SELECT id, name, fulfillment_types, distance_band
-- FROM public.products_near(-22.9068, -43.1729, NULL, 10, NULL, NULL, 5, 0);
-- Esperado: produtos com shipping/remote_service/pickup (sem location) incluídos.

-- V4. Confirmar GIST index usado via EXPLAIN:
-- EXPLAIN ANALYZE
-- SELECT * FROM public.products_near(-22.9068, -43.1729, ARRAY['local_delivery'], 10, NULL, NULL, 20, 0);
-- Verificar no plan: "Index Scan using idx_seller_location" aparece antes de Seq Scan.
