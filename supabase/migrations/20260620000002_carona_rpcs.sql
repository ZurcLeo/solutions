-- =====================================================
-- MIGRAÇÃO: Carona Solidária — RPCs
-- [CARONA-002] 7 funções SQL para lógica de negócio
--
-- Funções:
--   1. is_on_carona_route()         — matching por corredor Haversine
--   2. calculate_carona_price()     — teto legal R$0,99/km ÷ vagas
--   3. search_caronas()             — busca principal passageiro
--   4. book_carona_seat()           — reserva atômica de vaga
--   5. release_carona_seat()        — devolve vaga ao cancelar
--   6. expire_stale_caronas()       — cron: expira viagens passadas
--   7. get_driver_carona_dashboard() — stats do motorista
--   8. _update_driver_carona_rating() — recalcula média do motorista
--   9. submit_carona_rating()       — submissão validada de avaliação
--
-- Reutiliza: haversine_km() (20260610000002_delivery_rpcs.sql)
--
-- Depende de:
--   20260620000001_carona_schema.sql
--   20260610000002_delivery_rpcs.sql (haversine_km)
--
-- Agente: claudia-agent | Revisado por: Léo (PO)
-- Data: 2026-06-20
-- =====================================================


-- =====================================================
-- 1. is_on_carona_route()
--    Verifica se um ponto está dentro do "corredor" da rota
--    Usa desigualdade triangular: d(O,P) + d(P,D) - d(O,D) <= corredor
-- =====================================================

CREATE OR REPLACE FUNCTION public.is_on_carona_route(
    p_origin_lat    NUMERIC,
    p_origin_lng    NUMERIC,
    p_dest_lat      NUMERIC,
    p_dest_lng      NUMERIC,
    p_point_lat     NUMERIC,
    p_point_lng     NUMERIC,
    p_corridor_km   NUMERIC DEFAULT 5.0
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
    v_route_km      NUMERIC;
    v_origin_to_pt  NUMERIC;
    v_pt_to_dest    NUMERIC;
    v_detour        NUMERIC;
BEGIN
    -- Distância direta da rota
    v_route_km     := public.haversine_km(p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng);

    -- Distâncias do ponto à origem e destino
    v_origin_to_pt := public.haversine_km(p_origin_lat, p_origin_lng, p_point_lat, p_point_lng);
    v_pt_to_dest   := public.haversine_km(p_point_lat, p_point_lng, p_dest_lat, p_dest_lng);

    -- Desvio = quanto o ponto foge da linha reta
    v_detour := (v_origin_to_pt + v_pt_to_dest) - v_route_km;

    -- Ponto está na rota se o desvio está dentro do corredor
    -- E o ponto não está antes da origem nem depois do destino
    RETURN v_detour <= p_corridor_km
       AND v_origin_to_pt <= v_route_km + p_corridor_km
       AND v_pt_to_dest   <= v_route_km + p_corridor_km;
END;
$$;

COMMENT ON FUNCTION public.is_on_carona_route(NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC) IS
    '[CARONA-002] Verifica se um ponto (pickup/dropoff do passageiro) está '
    'dentro do corredor da rota do motorista. Usa desigualdade triangular. '
    'Default: 5km de corredor. IMMUTABLE + PARALLEL SAFE para uso em índices.';


-- =====================================================
-- 2. calculate_carona_price()
--    Aplica teto legal INSS: R$0,99/km ÷ vagas
--    Motorista pode cobrar menos, nunca mais
-- =====================================================

CREATE OR REPLACE FUNCTION public.calculate_carona_price(
    p_route_km      NUMERIC,
    p_total_seats   INTEGER,
    p_driver_price  NUMERIC
)
RETURNS TABLE (
    price_per_seat_brl NUMERIC,
    legal_cap_brl      NUMERIC,
    was_capped         BOOLEAN
)
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
    v_inss_rate     CONSTANT NUMERIC := 0.99;  -- R$/km referência INSS/Receita Federal
    v_legal_cap     NUMERIC;
    v_effective     NUMERIC;
BEGIN
    -- Teto = (distância × R$0,99) ÷ vagas totais
    v_legal_cap := ROUND((p_route_km * v_inss_rate) / GREATEST(p_total_seats, 1), 2);

    -- Preço efetivo: menor entre o que o motorista quer e o teto legal
    v_effective := LEAST(p_driver_price, v_legal_cap);

    -- Nunca negativo
    v_effective := GREATEST(v_effective, 0);

    RETURN QUERY SELECT v_effective, v_legal_cap, (p_driver_price > v_legal_cap);
END;
$$;

COMMENT ON FUNCTION public.calculate_carona_price(NUMERIC, INTEGER, NUMERIC) IS
    '[CARONA-002] Calcula preço por vaga com teto legal INSS (R$0,99/km). '
    'Retorna preço efetivo, teto legal, e flag se o preço foi limitado. '
    'Protege juridicamente motorista e plataforma: divisão de custo, não lucro.';


-- =====================================================
-- 3. search_caronas()
--    Busca principal: passageiro busca caronas compatíveis
--    Filtra por corredor (pickup E dropoff na rota)
--    Ordena por match_score
-- =====================================================

CREATE OR REPLACE FUNCTION public.search_caronas(
    p_pickup_lat      NUMERIC,
    p_pickup_lng      NUMERIC,
    p_dropoff_lat     NUMERIC,
    p_dropoff_lng     NUMERIC,
    p_departure_from  TIMESTAMPTZ DEFAULT NOW(),
    p_departure_to    TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
    p_corridor_km     NUMERIC DEFAULT 5.0,
    p_vehicle_type    TEXT DEFAULT NULL,
    p_max_price       NUMERIC DEFAULT NULL,
    p_accepts_pets    BOOLEAN DEFAULT NULL,
    p_limit           INTEGER DEFAULT 20
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
        u.display_name          AS driver_name,
        u.photo_url             AS driver_photo,
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
        -- Desvio do pickup: quanto o ponto foge da rota
        ROUND((
            public.haversine_km(r.origin_lat, r.origin_lng, p_pickup_lat, p_pickup_lng)
            + public.haversine_km(p_pickup_lat, p_pickup_lng, r.dest_lat, r.dest_lng)
            - r.route_km
        )::NUMERIC, 2)         AS pickup_detour_km,
        -- Desvio do dropoff
        ROUND((
            public.haversine_km(r.origin_lat, r.origin_lng, p_dropoff_lat, p_dropoff_lng)
            + public.haversine_km(p_dropoff_lat, p_dropoff_lng, r.dest_lat, r.dest_lng)
            - r.route_km
        )::NUMERIC, 2)         AS dropoff_detour_km,
        -- Score: menor = melhor (desvio pesa 40%, preço 30%, rating inverte 30%)
        ROUND((
            (
                public.haversine_km(r.origin_lat, r.origin_lng, p_pickup_lat, p_pickup_lng)
                + public.haversine_km(p_pickup_lat, p_pickup_lng, r.dest_lat, r.dest_lng)
                - r.route_km
            ) * 0.4
            + r.price_per_seat_brl * 0.3
            - COALESCE(dp.average_rating, 0) * 0.3
        )::NUMERIC, 4)         AS match_score

    FROM   public.carona_rides r
    JOIN   public.users u ON u.id = r.driver_id
    JOIN   public.carona_driver_profiles dp ON dp.id = r.driver_profile_id

    WHERE  r.status = 'open'
      AND  r.seats_available > 0
      AND  r.departure_at >= p_departure_from
      AND  r.departure_at <= p_departure_to

      -- Coordenadas preenchidas
      AND  r.origin_lat IS NOT NULL
      AND  r.dest_lat IS NOT NULL

      -- Pickup do passageiro está no corredor da rota
      AND  public.is_on_carona_route(
               r.origin_lat, r.origin_lng,
               r.dest_lat, r.dest_lng,
               p_pickup_lat, p_pickup_lng,
               p_corridor_km
           )

      -- Dropoff do passageiro está no corredor da rota
      AND  public.is_on_carona_route(
               r.origin_lat, r.origin_lng,
               r.dest_lat, r.dest_lng,
               p_dropoff_lat, p_dropoff_lng,
               p_corridor_km
           )

      -- Dropoff deve estar "depois" do pickup na rota (direção correta)
      AND  public.haversine_km(r.origin_lat, r.origin_lng, p_pickup_lat, p_pickup_lng)
           < public.haversine_km(r.origin_lat, r.origin_lng, p_dropoff_lat, p_dropoff_lng)

      -- Filtros opcionais
      AND  (p_vehicle_type IS NULL OR dp.vehicle_type = p_vehicle_type)
      AND  (p_max_price IS NULL OR r.price_per_seat_brl <= p_max_price)
      AND  (p_accepts_pets IS NULL OR r.accepts_pets = p_accepts_pets)

    ORDER BY match_score ASC
    LIMIT  p_limit;
END;
$$;

COMMENT ON FUNCTION public.search_caronas(NUMERIC, NUMERIC, NUMERIC, NUMERIC, TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC, TEXT, NUMERIC, BOOLEAN, INTEGER) IS
    '[CARONA-002] Busca principal de caronas para passageiro. '
    'Filtra por corredor Haversine (pickup E dropoff na rota do motorista). '
    'Verifica direção correta (dropoff após pickup na rota). '
    'Ordena por match_score: desvio×0.4 + preço×0.3 - rating×0.3.';

GRANT EXECUTE ON FUNCTION public.search_caronas(NUMERIC, NUMERIC, NUMERIC, NUMERIC, TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC, TEXT, NUMERIC, BOOLEAN, INTEGER)
    TO authenticated;


-- =====================================================
-- 4. book_carona_seat()
--    Reserva atômica: decrementa seats_available
--    Previne overbooking via WHERE seats_available > 0
-- =====================================================

CREATE OR REPLACE FUNCTION public.book_carona_seat(
    p_ride_id       TEXT,
    p_passenger_id  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ride   RECORD;
    v_rows   INTEGER;
BEGIN
    -- 1. Verifica se a viagem existe e está aberta
    SELECT * INTO v_ride
    FROM public.carona_rides
    WHERE id = p_ride_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'not_found',
            'message', 'Viagem não encontrada.');
    END IF;

    IF v_ride.status NOT IN ('open') THEN
        RETURN jsonb_build_object('success', false, 'error', 'not_available',
            'message', 'Esta viagem não está mais aceitando passageiros.');
    END IF;

    -- 2. Verifica se passageiro não é o motorista
    IF p_passenger_id = v_ride.driver_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'self_booking',
            'message', 'Motorista não pode reservar vaga na própria viagem.');
    END IF;

    -- 3. Verifica se já tem reserva
    IF EXISTS (
        SELECT 1 FROM public.carona_seats
        WHERE ride_id = p_ride_id
          AND passenger_id = p_passenger_id
          AND status NOT IN ('cancelled_passenger', 'cancelled_driver')
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'already_booked',
            'message', 'Você já tem uma reserva nesta viagem.');
    END IF;

    -- 4. Decremento atômico — previne race condition
    UPDATE public.carona_rides
    SET    seats_available = seats_available - 1
    WHERE  id = p_ride_id
      AND  seats_available > 0
      AND  status = 'open';

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'no_seats',
            'message', 'Não há vagas disponíveis nesta viagem.');
    END IF;

    RETURN jsonb_build_object('success', true, 'seats_remaining',
        (SELECT seats_available FROM public.carona_rides WHERE id = p_ride_id));

EXCEPTION WHEN unique_violation THEN
    -- Race condition: outro passageiro com mesmo ID (improvável mas seguro)
    RETURN jsonb_build_object('success', false, 'error', 'already_booked',
        'message', 'Você já tem uma reserva nesta viagem.');
END;
$$;

COMMENT ON FUNCTION public.book_carona_seat(TEXT, TEXT) IS
    '[CARONA-002] Reserva atômica de vaga. UPDATE ... WHERE seats_available > 0 '
    'elimina race condition de overbooking. Não cria o row em carona_seats — isso '
    'é feito pelo backend após o Stripe PaymentIntent ser criado.';

GRANT EXECUTE ON FUNCTION public.book_carona_seat(TEXT, TEXT) TO authenticated;


-- =====================================================
-- 5. release_carona_seat()
--    Devolve vaga ao cancelar reserva
-- =====================================================

CREATE OR REPLACE FUNCTION public.release_carona_seat(
    p_ride_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.carona_rides
    SET    seats_available = LEAST(seats_available + 1, total_seats)
    WHERE  id = p_ride_id
      AND  status IN ('open', 'full');
    -- Trigger trg_carona_rides_seats_sync cuida de full → open
END;
$$;

COMMENT ON FUNCTION public.release_carona_seat(TEXT) IS
    '[CARONA-002] Devolve vaga quando passageiro cancela. '
    'LEAST previne seats_available > total_seats. '
    'Trigger seats_sync atualiza status full→open automaticamente.';


-- =====================================================
-- 6. expire_stale_caronas()
--    Job cron: expira viagens passadas sem ação
-- =====================================================

CREATE OR REPLACE FUNCTION public.expire_stale_caronas()
RETURNS TABLE (expired_count INTEGER, voided_seats_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_expired   INTEGER;
    v_voided    INTEGER;
BEGIN
    -- 1. Expira rides cuja partida já passou e status ainda é open/full
    WITH expired AS (
        UPDATE public.carona_rides
        SET    status = 'expired',
               updated_at = NOW()
        WHERE  departure_at < NOW() - INTERVAL '30 minutes'
          AND  status IN ('open', 'full')
        RETURNING id
    )
    SELECT COUNT(*)::INTEGER INTO v_expired FROM expired;

    -- 2. Cancela seats pendentes/confirmados de rides expiradas
    WITH voided AS (
        UPDATE public.carona_seats s
        SET    status = 'cancelled_driver',
               cancellation_reason = 'Viagem expirada automaticamente',
               cancelled_at = NOW(),
               updated_at = NOW()
        FROM   public.carona_rides r
        WHERE  s.ride_id = r.id
          AND  r.status = 'expired'
          AND  s.status IN ('pending_payment', 'confirmed')
        RETURNING s.id
    )
    SELECT COUNT(*)::INTEGER INTO v_voided FROM voided;

    RETURN QUERY SELECT v_expired, v_voided;
END;
$$;

COMMENT ON FUNCTION public.expire_stale_caronas() IS
    '[CARONA-002] Job cron: expira viagens cuja partida passou há 30+ minutos '
    'sem que o motorista fizesse check-in. Cancela seats pendentes. '
    'Stripe voids devem ser feitos pelo backend ao processar os resultados.';


-- =====================================================
-- 7. get_driver_carona_dashboard()
--    Estatísticas do motorista
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_driver_carona_dashboard(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile     RECORD;
    v_today       INTEGER;
    v_week        INTEGER;
    v_month       INTEGER;
    v_earnings    NUMERIC;
    v_upcoming    INTEGER;
    v_pending_ratings INTEGER;
BEGIN
    -- Perfil do motorista
    SELECT * INTO v_profile
    FROM public.carona_driver_profiles
    WHERE user_id = p_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('has_profile', false);
    END IF;

    -- Viagens completadas hoje
    SELECT COUNT(*)::INTEGER INTO v_today
    FROM public.carona_rides
    WHERE driver_id = p_user_id
      AND status = 'completed'
      AND completed_at >= CURRENT_DATE;

    -- Viagens completadas esta semana
    SELECT COUNT(*)::INTEGER INTO v_week
    FROM public.carona_rides
    WHERE driver_id = p_user_id
      AND status = 'completed'
      AND completed_at >= date_trunc('week', NOW());

    -- Viagens completadas este mês
    SELECT COUNT(*)::INTEGER INTO v_month
    FROM public.carona_rides
    WHERE driver_id = p_user_id
      AND status = 'completed'
      AND completed_at >= date_trunc('month', NOW());

    -- Ganhos do mês (soma dos amount_brl dos seats completados)
    SELECT COALESCE(SUM(s.amount_brl), 0) INTO v_earnings
    FROM public.carona_seats s
    JOIN public.carona_rides r ON r.id = s.ride_id
    WHERE r.driver_id = p_user_id
      AND s.status = 'completed'
      AND s.completed_at >= date_trunc('month', NOW());

    -- Próximas viagens agendadas
    SELECT COUNT(*)::INTEGER INTO v_upcoming
    FROM public.carona_rides
    WHERE driver_id = p_user_id
      AND status IN ('open', 'full')
      AND departure_at > NOW();

    -- Avaliações pendentes (viagens completadas sem rating do motorista)
    SELECT COUNT(DISTINCT s.id)::INTEGER INTO v_pending_ratings
    FROM public.carona_seats s
    JOIN public.carona_rides r ON r.id = s.ride_id
    WHERE r.driver_id = p_user_id
      AND s.status = 'completed'
      AND s.completed_at >= NOW() - INTERVAL '7 days'
      AND NOT EXISTS (
          SELECT 1 FROM public.carona_ratings cr
          WHERE cr.seat_id = s.id
            AND cr.rater_id = p_user_id
      );

    RETURN jsonb_build_object(
        'has_profile',         true,
        'profile_id',          v_profile.id,
        'verification_status', v_profile.verification_status,
        'vehicle_type',        v_profile.vehicle_type,
        'vehicle_model',       v_profile.vehicle_model,
        'average_rating',      v_profile.average_rating,
        'total_rides',         v_profile.total_rides,
        'is_active',           v_profile.is_active,
        'today_count',         v_today,
        'week_count',          v_week,
        'month_count',         v_month,
        'month_earnings_brl',  v_earnings,
        'upcoming_rides',      v_upcoming,
        'pending_ratings',     v_pending_ratings
    );
END;
$$;

COMMENT ON FUNCTION public.get_driver_carona_dashboard(TEXT) IS
    '[CARONA-002] Dashboard do motorista de carona solidária. '
    'Retorna perfil, stats de viagens (hoje/semana/mês), ganhos, próximas viagens, '
    'e avaliações pendentes (janela de 7 dias).';

GRANT EXECUTE ON FUNCTION public.get_driver_carona_dashboard(TEXT) TO authenticated;


-- =====================================================
-- 8. _update_driver_carona_rating()
--    Recalcula average_rating do motorista (PRIVADA)
-- =====================================================

CREATE OR REPLACE FUNCTION public._update_driver_carona_rating(p_driver_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_avg   NUMERIC(3, 2);
    v_count INTEGER;
BEGIN
    -- Calcula média de ratings recebidos como driver
    SELECT ROUND(AVG(cr.score)::NUMERIC, 2), COUNT(*)::INTEGER
    INTO   v_avg, v_count
    FROM   public.carona_ratings cr
    WHERE  cr.rated_id = p_driver_id
      AND  cr.rated_role = 'driver';

    -- Atualiza perfil
    UPDATE public.carona_driver_profiles
    SET    average_rating = COALESCE(v_avg, 0.00),
           total_rides    = (
               SELECT COUNT(*) FROM public.carona_rides
               WHERE driver_id = p_driver_id AND status = 'completed'
           ),
           updated_at     = NOW()
    WHERE  user_id = p_driver_id;
END;
$$;

COMMENT ON FUNCTION public._update_driver_carona_rating(TEXT) IS
    '[CARONA-002] Recalcula carona_driver_profiles.average_rating. '
    'Chamada por submit_carona_rating quando rated_role = driver. '
    'SECURITY DEFINER: atualiza perfil sem RLS. Prefixo _ = privada.';


-- =====================================================
-- 9. submit_carona_rating()
--    Submissão validada de avaliação bilateral
-- =====================================================

CREATE OR REPLACE FUNCTION public.submit_carona_rating(
    p_ride_id    TEXT,
    p_seat_id    TEXT,
    p_rated_id   TEXT,
    p_rated_role TEXT,
    p_score      SMALLINT,
    p_comment    TEXT    DEFAULT NULL,
    p_tags       TEXT[]  DEFAULT NULL,
    p_anonymous  BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rater_id    TEXT := auth.uid()::text;
    v_rater_role  TEXT;
    v_ride        RECORD;
    v_seat        RECORD;
    v_new_id      TEXT;
BEGIN
    -- 0. Validações de input
    IF p_rated_role NOT IN ('driver', 'passenger') THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_role',
            'message', 'rated_role deve ser driver ou passenger.');
    END IF;
    IF p_score NOT BETWEEN 1 AND 5 THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_score',
            'message', 'score deve estar entre 1 e 5.');
    END IF;
    IF p_comment IS NOT NULL AND length(p_comment) > 500 THEN
        RETURN jsonb_build_object('success', false, 'error', 'comment_too_long',
            'message', 'comment deve ter no máximo 500 caracteres.');
    END IF;

    -- 1. Carrega viagem
    SELECT * INTO v_ride FROM public.carona_rides WHERE id = p_ride_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'ride_not_found',
            'message', 'Viagem não encontrada.');
    END IF;

    -- 2. Carrega assento
    SELECT * INTO v_seat FROM public.carona_seats WHERE id = p_seat_id AND ride_id = p_ride_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'seat_not_found',
            'message', 'Assento não encontrado nesta viagem.');
    END IF;

    -- 3. Seat deve estar completo
    IF v_seat.status != 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'not_completed',
            'message', 'Só é possível avaliar após a viagem ser concluída.');
    END IF;

    -- 4. Janela de 7 dias
    IF v_seat.completed_at IS NOT NULL
       AND v_seat.completed_at < NOW() - INTERVAL '7 days' THEN
        RETURN jsonb_build_object('success', false, 'error', 'window_expired',
            'message', 'O prazo de avaliação (7 dias) expirou.');
    END IF;

    -- 5. Determina rater_role
    IF v_rater_id = v_ride.driver_id THEN
        v_rater_role := 'driver';
    ELSIF v_rater_id = v_seat.passenger_id THEN
        v_rater_role := 'passenger';
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'not_a_party',
            'message', 'Você não é parte desta viagem.');
    END IF;

    -- 6. Sem auto-avaliação
    IF v_rater_id = p_rated_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'self_rating',
            'message', 'Não é permitido avaliar a si mesmo.');
    END IF;
    IF v_rater_role = p_rated_role THEN
        RETURN jsonb_build_object('success', false, 'error', 'same_role',
            'message', 'Avaliador e avaliado devem ter papéis distintos.');
    END IF;

    -- 7. Sem duplo voto
    IF EXISTS (
        SELECT 1 FROM public.carona_ratings
        WHERE seat_id = p_seat_id AND rater_id = v_rater_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'already_rated',
            'message', 'Você já avaliou para este assento.');
    END IF;

    -- 8. Insere avaliação
    INSERT INTO public.carona_ratings (
        ride_id, seat_id,
        rater_id, rater_role,
        rated_id, rated_role,
        score, comment, tags, is_anonymous
    )
    VALUES (
        p_ride_id, p_seat_id,
        v_rater_id, v_rater_role,
        p_rated_id, p_rated_role,
        p_score, p_comment, p_tags, p_anonymous
    )
    RETURNING id INTO v_new_id;

    -- 9. Recalcula média do motorista se foi avaliado
    IF p_rated_role = 'driver' THEN
        PERFORM public._update_driver_carona_rating(p_rated_id);
    END IF;

    RETURN jsonb_build_object('success', true, 'rating_id', v_new_id);

EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_rated',
        'message', 'Você já avaliou para este assento.');
END;
$$;

COMMENT ON FUNCTION public.submit_carona_rating(TEXT, TEXT, TEXT, TEXT, SMALLINT, TEXT, TEXT[], BOOLEAN) IS
    '[CARONA-002] Submissão de avaliação bilateral de carona — ponto único de entrada. '
    'Validações: seat completed, janela 7 dias, é parte, sem auto-avaliação, sem duplo voto. '
    'Retorna { success, rating_id } ou { success: false, error, message }.';

GRANT EXECUTE ON FUNCTION public.submit_carona_rating(TEXT, TEXT, TEXT, TEXT, SMALLINT, TEXT, TEXT[], BOOLEAN)
    TO authenticated;


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- =====================================================

-- V1. Funções criadas:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'is_on_carona_route',
--     'calculate_carona_price',
--     'search_caronas',
--     'book_carona_seat',
--     'release_carona_seat',
--     'expire_stale_caronas',
--     'get_driver_carona_dashboard',
--     '_update_driver_carona_rating',
--     'submit_carona_rating'
--   );
-- Esperado: 9 linhas.

-- V2. Teste is_on_carona_route (Madureira → Tijuca, ponto em Méier):
-- SELECT public.is_on_carona_route(
--   -22.8744, -43.3381,  -- Madureira (origem)
--   -22.9245, -43.2436,  -- Tijuca (destino)
--   -22.9023, -43.2796,  -- Méier (ponto a testar)
--   5.0                   -- corredor 5km
-- );
-- Esperado: true (Méier está no caminho Madureira→Tijuca).

-- V3. Teste calculate_carona_price:
-- SELECT * FROM public.calculate_carona_price(20.0, 3, 10.00);
-- Esperado: price_per_seat_brl = 6.60, legal_cap_brl = 6.60, was_capped = true
-- (20km × 0.99 / 3 = 6.60 < 10.00 → preço limitado)

-- V4. Teste calculate_carona_price (preço abaixo do teto):
-- SELECT * FROM public.calculate_carona_price(20.0, 3, 5.00);
-- Esperado: price_per_seat_brl = 5.00, legal_cap_brl = 6.60, was_capped = false
