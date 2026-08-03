-- =============================================================================
-- MIGRATION: PREFS-003 — Privacy enforcement in products_near RPC
-- Ticket: PREFS-003
--
-- Problema: Sellers que desativaram appear_in_searches em user_preferences
--           ainda aparecem nos resultados de busca do Mercado Local.
--
-- Solução: LEFT JOIN user_preferences e filtrar na WHERE clause.
--           Quando não há registro em user_preferences, assume permitido
--           (default: appear_in_searches = true).
--
-- Zero-downtime: apenas recria a função existente com filtro adicional.
-- =============================================================================

-- DROP ambas as sobrecargas existentes para recriar com RETURNS TABLE alterado
DROP FUNCTION IF EXISTS public.products_near(FLOAT, FLOAT, TEXT[], FLOAT, TEXT, TEXT, INT, INT);
DROP FUNCTION IF EXISTS public.products_near(FLOAT, FLOAT, TEXT[], FLOAT, TEXT, TEXT, TEXT, INT, INT);

CREATE FUNCTION public.products_near(
    p_lat             FLOAT    DEFAULT NULL,
    p_lng             FLOAT    DEFAULT NULL,
    p_fulfillment     TEXT[]   DEFAULT NULL,
    p_max_browse_km   FLOAT    DEFAULT 10,
    p_neighborhood    TEXT     DEFAULT NULL,
    p_city            TEXT     DEFAULT NULL,
    p_state           TEXT     DEFAULT NULL,
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
    geo_level                   INT,
    geo_score                   NUMERIC,
    -- campos de imóveis
    property_details            JSONB,
    product_type                TEXT,
    property_status             TEXT,
    listing_type                TEXT,
    total_count                 BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_buyer_pt    GEOGRAPHY;
    v_use_geo     BOOLEAN;
    v_has_text    BOOLEAN;
BEGIN
    v_use_geo  := (p_lat IS NOT NULL AND p_lng IS NOT NULL);
    v_has_text := (p_neighborhood IS NOT NULL OR p_city IS NOT NULL OR p_state IS NOT NULL);

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
            -- campos de imóveis
            p.property_details,
            p.product_type::TEXT    AS product_type,
            p.property_status,
            p.listing_type,

            CASE
                WHEN v_use_geo AND s.location IS NOT NULL
                THEN ST_Distance(s.location, v_buyer_pt)
                ELSE NULL
            END AS dist_m,

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
            END AS sort_priority,

            CASE
                WHEN NOT v_has_text THEN NULL
                ELSE public.get_location_level(
                    p_neighborhood, p_city, p_state,
                    s.address_neighborhood, s.address_city, s.address_state
                )
            END AS geo_level_calc,

            CASE
                WHEN NOT v_has_text THEN 1.0
                ELSE
                    CASE public.get_location_level(
                        p_neighborhood, p_city, p_state,
                        s.address_neighborhood, s.address_city, s.address_state
                    )
                        WHEN 0 THEN 3.0
                        WHEN 1 THEN 1.8
                        WHEN 2 THEN 1.2
                        ELSE 0.6
                    END
            END AS geo_score_calc

        FROM public.marketplace_products p
        JOIN public.seller_profiles s ON s.id = p.seller_id
        -- PREFS-003: LEFT JOIN para filtrar sellers que desativaram appear_in_searches
        LEFT JOIN public.user_preferences up ON up.user_id = s.user_id
        WHERE
            p.active = true
            AND s.status = 'active'

            -- PREFS-003: excluir sellers que desativaram appear_in_searches
            -- Sem registro em user_preferences = default (permitido)
            AND COALESCE((up.privacy_prefs->>'appear_in_searches')::boolean, true) = true

            AND (
                p_fulfillment IS NULL
                OR cardinality(p_fulfillment) = 0
                OR p.fulfillment_types && p_fulfillment
            )

            AND (
                NOT v_use_geo
                OR (
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
                            s.location IS NULL
                            OR ST_DWithin(s.location, v_buyer_pt, s.service_radius_km::float * 1000)
                        )
                    )
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
            AND (
                p_state IS NULL
                OR s.address_state ILIKE '%' || p_state || '%'
            )
    ),
    ranked AS (
        SELECT
            c.*,
            COUNT(*) OVER() AS total_count
        FROM candidates c
        ORDER BY
            c.geo_score_calc DESC,
            c.sort_priority   ASC,
            c.dist_m          ASC NULLS LAST,
            c.created_at      DESC
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
        CASE
            WHEN r.dist_m IS NULL   THEN 'online'
            WHEN r.dist_m < 1000    THEN '<1km'
            WHEN r.dist_m < 3000    THEN '1-3km'
            WHEN r.dist_m < 10000   THEN '3-10km'
            ELSE                         '>10km'
        END AS distance_band,
        r.geo_level_calc   AS geo_level,
        r.geo_score_calc   AS geo_score,
        r.property_details,
        r.product_type,
        r.property_status,
        r.listing_type,
        r.total_count
    FROM ranked r;
END;
$$;

COMMENT ON FUNCTION public.products_near(FLOAT, FLOAT, TEXT[], FLOAT, TEXT, TEXT, TEXT, INT, INT) IS
    'RPC de busca geo/textual de produtos. v4: PREFS-003 filtra sellers com appear_in_searches=false via LEFT JOIN user_preferences.';
