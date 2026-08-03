-- Fix: carona RPCs reference display_name/photo_url but users table has full_name/avatar_url
-- Bug pré-existente no schema de carona (20260620000002)

CREATE OR REPLACE FUNCTION search_caronas(
    p_pickup_lat    DOUBLE PRECISION,
    p_pickup_lng    DOUBLE PRECISION,
    p_dropoff_lat   DOUBLE PRECISION,
    p_dropoff_lng   DOUBLE PRECISION,
    p_departure_from TIMESTAMPTZ DEFAULT NOW(),
    p_departure_to   TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
    p_corridor_km    NUMERIC DEFAULT 5.0,
    p_vehicle_type   TEXT DEFAULT NULL,
    p_max_price      NUMERIC DEFAULT NULL,
    p_accepts_pets   BOOLEAN DEFAULT NULL,
    p_limit          INTEGER DEFAULT 20
)
RETURNS TABLE (
    ride_id             TEXT,
    driver_id           TEXT,
    driver_name         TEXT,
    driver_photo        TEXT,
    driver_profile_id   TEXT,
    origin_city         TEXT,
    origin_neighborhood TEXT,
    dest_city           TEXT,
    dest_neighborhood   TEXT,
    departure_at        TIMESTAMPTZ,
    estimated_arrival   TIMESTAMPTZ,
    price_per_seat_brl  NUMERIC,
    legal_cap_brl       NUMERIC,
    seats_available     INTEGER,
    total_seats         INTEGER,
    vehicle_type        TEXT,
    vehicle_model       TEXT,
    route_km            NUMERIC,
    accepts_luggage     BOOLEAN,
    accepts_pets        BOOLEAN,
    smoking_allowed     BOOLEAN,
    notes               TEXT,
    driver_avg_rating   NUMERIC,
    driver_total_rides  INTEGER,
    pickup_detour_km    NUMERIC,
    dropoff_detour_km   NUMERIC,
    match_score         NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.id                    AS ride_id,
        r.driver_id,
        u.full_name             AS driver_name,
        u.avatar_url            AS driver_photo,
        r.driver_profile_id,
        r.origin_city,
        r.origin_neighborhood,
        r.dest_city,
        r.dest_neighborhood,
        r.departure_at,
        r.estimated_arrival,
        r.price_per_seat_brl,
        r.legal_cap_brl,
        r.seats_available,
        r.total_seats,
        dp.vehicle_type,
        dp.vehicle_model,
        r.route_km,
        r.accepts_luggage,
        r.accepts_pets,
        r.smoking_allowed,
        r.notes,
        dp.average_rating       AS driver_avg_rating,
        dp.total_rides          AS driver_total_rides,
        ROUND((
            public.haversine_km(r.origin_lat, r.origin_lng, p_pickup_lat, p_pickup_lng)
            + public.haversine_km(p_pickup_lat, p_pickup_lng, r.dest_lat, r.dest_lng)
            - r.route_km
        )::NUMERIC, 2)         AS pickup_detour_km,
        ROUND((
            public.haversine_km(r.origin_lat, r.origin_lng, p_dropoff_lat, p_dropoff_lng)
            + public.haversine_km(p_dropoff_lat, p_dropoff_lng, r.dest_lat, r.dest_lng)
            - r.route_km
        )::NUMERIC, 2)         AS dropoff_detour_km,
        ROUND((
            (
                public.haversine_km(r.origin_lat, r.origin_lng, p_pickup_lat, p_pickup_lng)
                + public.haversine_km(p_pickup_lat, p_pickup_lng, r.dest_lat, r.dest_lng)
                - r.route_km
            ) * 0.4
            + COALESCE(r.price_per_seat_brl, 0) * 0.3
            + (5.0 - COALESCE(dp.average_rating, 3.0)) * 0.3
        )::NUMERIC, 2)         AS match_score
    FROM carona_rides r
    JOIN users u ON u.id = r.driver_id
    JOIN carona_driver_profiles dp ON dp.id = r.driver_profile_id
    WHERE r.status = 'open'
      AND r.seats_available > 0
      AND r.departure_at BETWEEN p_departure_from AND p_departure_to
      AND public.is_on_carona_route(
            r.origin_lat, r.origin_lng,
            r.dest_lat,   r.dest_lng,
            p_pickup_lat, p_pickup_lng,
            p_corridor_km
          )
      AND public.is_on_carona_route(
            r.origin_lat, r.origin_lng,
            r.dest_lat,   r.dest_lng,
            p_dropoff_lat, p_dropoff_lng,
            p_corridor_km
          )
      AND (p_vehicle_type IS NULL OR dp.vehicle_type = p_vehicle_type)
      AND (p_max_price    IS NULL OR r.price_per_seat_brl <= p_max_price)
      AND (p_accepts_pets IS NULL OR r.accepts_pets = p_accepts_pets)
    ORDER BY match_score ASC
    LIMIT p_limit;
END;
$$;
