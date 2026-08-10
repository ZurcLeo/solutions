-- =============================================================================
-- HOTFIX: Fix round(double precision, integer) → round(numeric, 2)
--
-- PostgreSQL's 2-arg round() requires NUMERIC, not DOUBLE PRECISION.
-- The relevance_score CTE output is DOUBLE PRECISION (from LEAST(1.0, ...)).
-- Fix: cast to NUMERIC before ROUND.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.products_near(
    p_lat             FLOAT    DEFAULT NULL,
    p_lng             FLOAT    DEFAULT NULL,
    p_fulfillment     TEXT[]   DEFAULT NULL,
    p_max_browse_km   FLOAT   DEFAULT 10,
    p_neighborhood    TEXT     DEFAULT NULL,
    p_city            TEXT     DEFAULT NULL,
    p_state           TEXT     DEFAULT NULL,
    p_limit           INT      DEFAULT 20,
    p_offset          INT      DEFAULT 0,
    p_query           TEXT     DEFAULT NULL,
    p_min_price       NUMERIC  DEFAULT NULL,
    p_max_price       NUMERIC  DEFAULT NULL,
    p_category        TEXT     DEFAULT NULL
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
    property_details            JSONB,
    product_type                TEXT,
    property_status             TEXT,
    listing_type                TEXT,
    total_count                 BIGINT,
    relevance                   NUMERIC,
    is_boosted                  BOOLEAN
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
    v_has_query   BOOLEAN;
    v_tsquery     tsquery;
    v_w_geo       NUMERIC;
    v_w_text      NUMERIC;
    v_w_plan      NUMERIC;
    v_w_prod      NUMERIC;
BEGIN
    v_use_geo  := (p_lat IS NOT NULL AND p_lng IS NOT NULL);
    v_has_text := (p_neighborhood IS NOT NULL OR p_city IS NOT NULL OR p_state IS NOT NULL);
    v_has_query := (p_query IS NOT NULL AND TRIM(p_query) <> '');

    IF v_use_geo THEN
        v_buyer_pt := ST_MakePoint(p_lng, p_lat)::geography;
    END IF;

    IF v_has_query THEN
        v_tsquery := plainto_tsquery('portuguese', p_query);
        v_w_geo  := 0.45;
        v_w_text := 0.30;
        v_w_plan := 0.15;
        v_w_prod := 0.10;
    ELSE
        v_w_geo  := 0.60;
        v_w_text := 0.0;
        v_w_plan := 0.25;
        v_w_prod := 0.15;
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
            END AS geo_score_calc,

            CASE
                WHEN v_has_query
                THEN ts_rank(p.search_vector, v_tsquery)
                ELSE 0.0
            END AS text_rank,

            COALESCE(sp.boost_multiplier, 1.0) AS plan_boost

        FROM public.marketplace_products p
        JOIN public.seller_profiles s ON s.id = p.seller_id
        LEFT JOIN public.user_preferences up ON up.user_id = s.user_id
        LEFT JOIN public.subscription_plans sp ON sp.slug = s.plan_slug AND sp.is_active = true
        WHERE
            p.active = true
            AND s.status = 'active'
            AND COALESCE((up.privacy_prefs->>'appear_in_searches')::boolean, true) = true
            AND (
                NOT v_has_query
                OR p.search_vector @@ v_tsquery
            )
            AND (p_min_price IS NULL OR p.price_brl >= p_min_price)
            AND (p_max_price IS NULL OR p.price_brl <= p_max_price)
            AND (p_category IS NULL OR p.category = p_category)
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
            LEAST(1.0, GREATEST(0.0,
                v_w_geo  * (c.geo_score_calc / 3.0) +
                v_w_text * c.text_rank +
                v_w_plan * (c.plan_boost / 2.0) +
                v_w_prod * 0.0
            )) AS relevance_score,
            (c.plan_boost > 1.0) AS is_boosted_flag,
            COUNT(*) OVER() AS total_count
        FROM candidates c
        ORDER BY
            LEAST(1.0, GREATEST(0.0,
                v_w_geo  * (c.geo_score_calc / 3.0) +
                v_w_text * c.text_rank +
                v_w_plan * (c.plan_boost / 2.0) +
                v_w_prod * 0.0
            )) DESC,
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
        r.total_count,
        -- FIX: cast to NUMERIC before ROUND (PostgreSQL requires numeric for 2-arg round)
        ROUND(r.relevance_score::NUMERIC, 2) AS relevance,
        r.is_boosted_flag           AS is_boosted
    FROM ranked r;
END;
$$;
