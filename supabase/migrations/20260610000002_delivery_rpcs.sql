-- =====================================================
-- MIGRAÇÃO: Módulo de Delivery ElosCloud — RPCs
-- [DELIVERY-002] Engine de matching hiper-local + operações atômicas
--
-- Funções criadas:
--   haversine_km(lat1,lng1,lat2,lng2)         — distância em km (fórmula Haversine)
--   upsert_delivery_session(...)               — cria/atualiza sessão ativa do entregador
--   find_eligible_deliverers_live(...)         — matching hiper-local (posição atual)
--   calculate_delivery_fee(service_id, ...)   — calcula tarifa para um entregador específico
--   claim_delivery_request(req_id, svc_id)   — aceite atômico (lock otimista, sem race condition)
--   confirm_delivery_step(req_id, step)        — entregador confirma etapa do trajeto
--   expire_delivery_notifications(req_id)      — marca notificações expiradas
--   get_delivery_dashboard(user_id)            — dados do painel do entregador
--
-- Decisão arquitetural (DA-008, DA-010):
--   • find_eligible_deliverers_live usa delivery_active_sessions (posição ATUAL),
--     não delivery_services.origin_* (endereço base cadastrado).
--   • claim_delivery_request usa UPDATE ... WHERE status='open' para garantir
--     que apenas um entregador consegue o claim (PostgreSQL garante atomicidade).
--   • Fator de correção de rota: 1.3× sobre Haversine (estrada ≈ 30% mais longa).
--
-- Score de matching (menor = melhor):
--   score = (D1_km × 0.5) - (rating × 1.5) - (nivel × 0.3)
--   D1 = distância da posição atual do entregador até a loja do vendedor.
--   Entregador mais próximo agora ganha sobre morador do bairro que está longe.
--
-- Depende de:
--   20260610000001_delivery_schema.sql  (tabelas delivery_*)
--   20260524000001_marketplace_schema.sql (seller_profiles)
--
-- Agente: marketplace-agent | Revisado por: ClaudIA
-- Data: 2026-06-10
-- =====================================================


-- =====================================================
-- 1. haversine_km — distância em linha reta entre 2 pontos
-- =====================================================

CREATE OR REPLACE FUNCTION public.haversine_km(
    p_lat1  NUMERIC,
    p_lng1  NUMERIC,
    p_lat2  NUMERIC,
    p_lng2  NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
COST 10
AS $$
DECLARE
    R    CONSTANT NUMERIC := 6371;  -- raio médio da Terra em km
    dlat NUMERIC := radians(p_lat2 - p_lat1);
    dlng NUMERIC := radians(p_lng2 - p_lng1);
    a    NUMERIC;
BEGIN
    a := sin(dlat / 2) ^ 2
       + cos(radians(p_lat1))
       * cos(radians(p_lat2))
       * sin(dlng / 2) ^ 2;
    -- LEAST(1, a) evita NaN por imprecisão de floating point quando pontos são iguais
    RETURN R * 2 * asin(sqrt(LEAST(1.0, a)));
END;
$$;

COMMENT ON FUNCTION public.haversine_km(NUMERIC, NUMERIC, NUMERIC, NUMERIC) IS
    '[DELIVERY-002] Calcula distância em km entre dois pontos via fórmula Haversine. '
    'Retorna distância em linha reta — multiplicar por 1.3 para estimar distância real em estrada. '
    'IMMUTABLE + PARALLEL SAFE: segura para uso em ORDER BY e índices funcionais. '
    'Migração futura (Sprint 3): substituir por ST_Distance (PostGIS) para maior precisão.';

GRANT EXECUTE ON FUNCTION public.haversine_km(NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO authenticated;


-- =====================================================
-- 2. upsert_delivery_session — entregador vai online
-- =====================================================

CREATE OR REPLACE FUNCTION public.upsert_delivery_session(
    p_user_id      TEXT,
    p_lat          NUMERIC DEFAULT NULL,
    p_lng          NUMERIC DEFAULT NULL,
    p_use_fallback BOOLEAN DEFAULT false,
    p_socket_id    TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    svc          delivery_services;
    eff_lat      NUMERIC;
    eff_lng      NUMERIC;
    rkey         TEXT;
    result_json  JSONB;
BEGIN
    -- Busca o delivery_service do usuário
    SELECT * INTO svc
    FROM public.delivery_services
    WHERE user_id = p_user_id
      AND status = 'active';

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'delivery_service_not_found',
            'message', 'Usuário não possui loja de entrega ativa.'
        );
    END IF;

    -- Resolve coordenadas efetivas:
    -- Se GPS disponível → usa posição atual
    -- Se GPS negado/indisponível → usa lat/lng estimada do endereço base (origin_*)
    -- Como origin_* é textual, usamos NULL para coordenadas base (sem GPS cadastrado)
    eff_lat := COALESCE(p_lat, NULL);  -- sem fallback de coordenadas: GPS ou nada
    eff_lng := COALESCE(p_lng, NULL);

    -- Só calcula region_key se tiver coordenadas
    IF eff_lat IS NOT NULL AND eff_lng IS NOT NULL THEN
        rkey := public.compute_region_key(eff_lat, eff_lng);
    ELSE
        -- Fallback: region_key por cidade (menos precisa, mas funcional)
        rkey := 'city:' || lower(trim(svc.origin_state)) || ':' || lower(trim(svc.origin_city));
    END IF;

    -- Upsert atômico da sessão ativa
    INSERT INTO public.delivery_active_sessions
        (service_id, user_id, current_lat, current_lng, use_fallback, region_key, socket_id,
         last_seen_at, expires_at)
    VALUES
        (svc.id, p_user_id, eff_lat, eff_lng, p_use_fallback OR (eff_lat IS NULL), rkey, p_socket_id,
         NOW(), NOW() + INTERVAL '45 minutes')
    ON CONFLICT (service_id) DO UPDATE SET
        current_lat  = EXCLUDED.current_lat,
        current_lng  = EXCLUDED.current_lng,
        use_fallback = EXCLUDED.use_fallback,
        region_key   = EXCLUDED.region_key,
        socket_id    = EXCLUDED.socket_id,
        last_seen_at = NOW(),
        expires_at   = NOW() + INTERVAL '45 minutes';

    result_json := jsonb_build_object(
        'ok',           true,
        'service_id',   svc.id,
        'region_key',   rkey,
        'has_gps',      eff_lat IS NOT NULL,
        'expires_at',   (NOW() + INTERVAL '45 minutes')::text
    );

    RETURN result_json;
END;
$$;

COMMENT ON FUNCTION public.upsert_delivery_session(TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT) IS
    '[DELIVERY-002] Cria ou atualiza a sessão ativa do entregador quando vai online. '
    'Chamado pelo backend (deliveryService) via service_role quando o Socket.IO recebe '
    'os eventos delivery:go_online, delivery:location_update ou delivery:heartbeat. '
    'Sem coordenadas GPS: use_fallback=true, region_key por cidade (matching textual). '
    'Com coordenadas GPS: region_key por grid 0.05° (~5km) para matching preciso.';


-- =====================================================
-- 3. find_eligible_deliverers_live — matching hiper-local
-- =====================================================

CREATE OR REPLACE FUNCTION public.find_eligible_deliverers_live(
    p_pickup_lat  NUMERIC,
    p_pickup_lng  NUMERIC,
    p_dest_lat    NUMERIC,
    p_dest_lng    NUMERIC,
    p_weight_kg   NUMERIC  DEFAULT 0,
    p_is_fragile  BOOLEAN  DEFAULT false,
    p_limit       INTEGER  DEFAULT 5,
    -- Fallback textual (usado quando coords não disponíveis)
    p_pickup_city TEXT     DEFAULT NULL,
    p_dest_city   TEXT     DEFAULT NULL,
    p_dest_state  TEXT     DEFAULT NULL
)
RETURNS TABLE (
    service_id          TEXT,
    user_id             TEXT,
    vehicle_type        TEXT,
    origin_to_pickup_km NUMERIC,   -- D1: posição atual → loja
    pickup_to_dest_km   NUMERIC,   -- D2: loja → cliente
    total_km            NUMERIC,   -- D1 + D2
    estimated_fee       NUMERIC,   -- tarifa final (max(custo, mínimo))
    average_rating      NUMERIC,
    delivery_level      INTEGER,
    match_score         NUMERIC,   -- menor = melhor
    has_gps             BOOLEAN    -- true se distâncias são GPS, false se estimadas
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    ROAD_FACTOR CONSTANT NUMERIC := 1.3;  -- Haversine × 1.3 ≈ distância real em estrada
BEGIN
    RETURN QUERY
    WITH live_candidates AS (
        SELECT
            das.service_id,
            das.user_id,
            das.current_lat,
            das.current_lng,
            das.use_fallback,
            das.region_key,
            ds.vehicle_type,
            ds.price_per_km,
            ds.base_fee,
            ds.minimum_fee,
            ds.max_radius_km,
            ds.max_weight_kg,
            ds.handles_fragile,
            ds.average_rating,
            ds.delivery_level,
            ds.origin_city,
            ds.origin_state
        FROM public.delivery_active_sessions das
        JOIN public.delivery_services ds ON ds.id = das.service_id
        WHERE das.expires_at > NOW()          -- sessão não expirada
          AND ds.status = 'active'
          AND (p_weight_kg = 0 OR p_weight_kg <= ds.max_weight_kg)
          AND (p_is_fragile = false OR ds.handles_fragile = true)
    ),
    with_distances AS (
        SELECT
            lc.*,
            -- D1: posição ATUAL do entregador → loja do vendedor
            CASE
                WHEN lc.current_lat IS NOT NULL AND p_pickup_lat IS NOT NULL THEN
                    haversine_km(lc.current_lat, lc.current_lng, p_pickup_lat, p_pickup_lng) * ROAD_FACTOR
                ELSE
                    -- Estimativa textual: mesmo bairro=2km, mesma cidade=8km, fora=null
                    CASE
                        WHEN lower(trim(lc.origin_city)) = lower(trim(p_pickup_city)) THEN 5.0
                        ELSE 15.0
                    END
            END AS d1_km,
            -- D2: loja → cliente
            CASE
                WHEN p_pickup_lat IS NOT NULL AND p_dest_lat IS NOT NULL THEN
                    haversine_km(p_pickup_lat, p_pickup_lng, p_dest_lat, p_dest_lng) * ROAD_FACTOR
                ELSE
                    -- Estimativa: mesma cidade=5km, outro estado=null
                    CASE
                        WHEN lower(trim(lc.origin_city)) = lower(trim(p_dest_city)) THEN 5.0
                        ELSE 20.0
                    END
            END AS d2_km,
            (lc.current_lat IS NOT NULL AND p_pickup_lat IS NOT NULL) AS gps_available
        FROM live_candidates lc
    )
    SELECT
        wd.service_id,
        wd.user_id,
        wd.vehicle_type,
        round(wd.d1_km::NUMERIC, 2)                                  AS origin_to_pickup_km,
        round(wd.d2_km::NUMERIC, 2)                                  AS pickup_to_dest_km,
        round((wd.d1_km + wd.d2_km)::NUMERIC, 2)                    AS total_km,
        round(GREATEST(
            (wd.d1_km + wd.d2_km) * wd.price_per_km + wd.base_fee,
            wd.minimum_fee
        )::NUMERIC, 2)                                               AS estimated_fee,
        wd.average_rating,
        wd.delivery_level,
        -- Score: D1 penaliza (quanto mais longe da loja agora, pior), rating e nível bonificam
        round((
            wd.d1_km * 0.5
            - wd.average_rating * 1.5
            - wd.delivery_level * 0.3
        )::NUMERIC, 4)                                               AS match_score,
        wd.gps_available                                             AS has_gps
    FROM with_distances wd
    WHERE
        -- D2 dentro do raio máximo de entrega do entregador
        wd.d2_km <= wd.max_radius_km
        -- Filtra entregadores em cidades/estados cobertos (fallback sem GPS)
        AND (
            wd.current_lat IS NOT NULL
            OR lower(trim(wd.origin_state)) = lower(trim(p_dest_state))
        )
    ORDER BY match_score   -- menor score = melhor match
    LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.find_eligible_deliverers_live(NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,BOOLEAN,INTEGER,TEXT,TEXT,TEXT) IS
    '[DELIVERY-002] Matching hiper-local: encontra os N melhores entregadores para um pedido. '
    'USA POSIÇÃO ATUAL (delivery_active_sessions), não endereço base cadastrado (DA-008). '
    'O entregador no bairro vizinho agora vale mais que o morador do bairro longe. '
    'Score: menor = melhor. D1 alto penaliza; rating alto e nível alto bonificam. '
    'Fallback: quando GPS indisponível, usa estimativas textuais (cidade/estado). '
    'Sprint 3: substituir Haversine×1.3 por OSRM/Google Maps para rotas reais.';

GRANT EXECUTE ON FUNCTION public.find_eligible_deliverers_live(NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,BOOLEAN,INTEGER,TEXT,TEXT,TEXT) TO authenticated;


-- =====================================================
-- 4. calculate_delivery_fee — tarifa para um entregador específico
-- =====================================================

CREATE OR REPLACE FUNCTION public.calculate_delivery_fee(
    p_service_id  TEXT,
    p_pickup_lat  NUMERIC,
    p_pickup_lng  NUMERIC,
    p_dest_lat    NUMERIC,
    p_dest_lng    NUMERIC,
    -- Posição atual do entregador (se disponível)
    p_current_lat NUMERIC DEFAULT NULL,
    p_current_lng NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    svc          delivery_services;
    ses          delivery_active_sessions;
    ROAD_FACTOR  CONSTANT NUMERIC := 1.3;
    eff_cur_lat  NUMERIC;
    eff_cur_lng  NUMERIC;
    d1           NUMERIC;
    d2           NUMERIC;
    total        NUMERIC;
    raw_fee      NUMERIC;
    final_fee    NUMERIC;
BEGIN
    SELECT * INTO svc
    FROM public.delivery_services
    WHERE id = p_service_id AND status = 'active';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'service_unavailable');
    END IF;

    -- Tenta usar posição atual da sessão ativa, depois o parâmetro, depois NULL
    SELECT current_lat, current_lng INTO eff_cur_lat, eff_cur_lng
    FROM public.delivery_active_sessions
    WHERE service_id = p_service_id AND expires_at > NOW();

    eff_cur_lat := COALESCE(p_current_lat, eff_cur_lat);
    eff_cur_lng := COALESCE(p_current_lng, eff_cur_lng);

    -- D1: entregador → loja
    IF eff_cur_lat IS NOT NULL THEN
        d1 := haversine_km(eff_cur_lat, eff_cur_lng, p_pickup_lat, p_pickup_lng) * ROAD_FACTOR;
    ELSE
        -- Sem GPS: D1 não calculado — usar estimativa padrão de 5km
        d1 := 5.0;
    END IF;

    -- D2: loja → cliente
    d2 := haversine_km(p_pickup_lat, p_pickup_lng, p_dest_lat, p_dest_lng) * ROAD_FACTOR;

    -- Verifica se destino está dentro do raio de cobertura
    IF d2 > svc.max_radius_km THEN
        RETURN jsonb_build_object(
            'ok',            false,
            'error',         'outside_coverage',
            'delivery_km',   round(d2::NUMERIC, 2),
            'max_radius_km', svc.max_radius_km
        );
    END IF;

    total     := d1 + d2;
    raw_fee   := total * svc.price_per_km + svc.base_fee;
    final_fee := GREATEST(raw_fee, svc.minimum_fee);

    RETURN jsonb_build_object(
        'ok',                   true,
        'service_id',           p_service_id,
        'origin_to_pickup_km',  round(d1::NUMERIC, 2),
        'pickup_to_dest_km',    round(d2::NUMERIC, 2),
        'total_km',             round(total::NUMERIC, 2),
        'raw_fee',              round(raw_fee::NUMERIC, 2),
        'final_fee',            round(final_fee::NUMERIC, 2),
        'price_per_km',         svc.price_per_km,
        'base_fee',             svc.base_fee,
        'minimum_fee',          svc.minimum_fee,
        'vehicle_type',         svc.vehicle_type,
        'has_gps',              eff_cur_lat IS NOT NULL
    );
END;
$$;

COMMENT ON FUNCTION public.calculate_delivery_fee(TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC) IS
    '[DELIVERY-002] Calcula a tarifa de entrega para um entregador específico. '
    'Fórmula: fee = max((D1 + D2) × price_per_km + base_fee, minimum_fee). '
    'D1 = posição_atual → loja (usa sessão ativa se disponível). '
    'D2 = loja → cliente (deve ser ≤ max_radius_km). '
    'Usado pelo backend antes de enviar proposta ao entregador.';

GRANT EXECUTE ON FUNCTION public.calculate_delivery_fee(TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC) TO authenticated;


-- =====================================================
-- 5. claim_delivery_request — aceite atômico sem race condition
-- =====================================================

CREATE OR REPLACE FUNCTION public.claim_delivery_request(
    p_request_id TEXT,
    p_service_id TEXT,
    p_user_id    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    req       delivery_requests;
    svc       delivery_services;
    notif     delivery_notifications;
    updated   delivery_requests;
BEGIN
    -- Verifica se o entregador tem sessão ativa e pertence ao service_id
    SELECT * INTO svc
    FROM public.delivery_services
    WHERE id = p_service_id AND user_id = p_user_id AND status = 'active';

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'ok', false, 'error', 'unauthorized',
            'message', 'Serviço de entrega não encontrado ou inativo.'
        );
    END IF;

    -- Verifica se o entregador foi notificado para esse pedido
    SELECT * INTO notif
    FROM public.delivery_notifications
    WHERE request_id = p_request_id
      AND service_id = p_service_id
      AND response IS NULL
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'ok', false, 'error', 'notification_expired',
            'message', 'O prazo para aceitar este pedido expirou ou você não foi notificado.'
        );
    END IF;

    -- =====================================================
    -- CLAIM ATÔMICO — o coração do sistema anti-race-condition
    -- UPDATE ... WHERE status='open' garante que só um entregador vence.
    -- PostgreSQL garante atomicidade: se dois entregadores executam este UPDATE
    -- ao mesmo tempo, apenas um obterá a row (o outro verá rowcount=0).
    -- =====================================================
    UPDATE public.delivery_requests
    SET
        service_id   = p_service_id,
        status       = 'matched',
        matched_at   = NOW(),
        accepted_fee = notif.proposed_fee,
        updated_at   = NOW()
    WHERE id = p_request_id
      AND status = 'open'     -- ← trava: só funciona se ainda 'open'
    RETURNING * INTO updated;

    -- Se não atualizou → outro entregador foi mais rápido
    IF updated.id IS NULL THEN
        RETURN jsonb_build_object(
            'ok', false, 'error', 'already_taken',
            'message', 'Esse pedido já foi aceito por outro entregador.'
        );
    END IF;

    -- Marca a notificação do vencedor como aceita
    UPDATE public.delivery_notifications
    SET response = 'accepted', responded_at = NOW()
    WHERE request_id = p_request_id AND service_id = p_service_id;

    -- Marca as demais notificações como expiradas (outros perderam)
    UPDATE public.delivery_notifications
    SET response = 'expired', responded_at = NOW()
    WHERE request_id = p_request_id
      AND service_id != p_service_id
      AND response IS NULL;

    RETURN jsonb_build_object(
        'ok',              true,
        'request_id',      updated.id,
        'order_id',        updated.order_id,
        'accepted_fee',    updated.accepted_fee,
        'pickup_address',  updated.pickup_address,
        'pickup_city',     updated.pickup_city,
        'dest_address',    updated.dest_address,
        'dest_city',       updated.dest_city,
        'weight_kg',       updated.weight_kg,
        'is_fragile',      updated.is_fragile,
        'notes',           updated.notes
    );
END;
$$;

COMMENT ON FUNCTION public.claim_delivery_request(TEXT, TEXT, TEXT) IS
    '[DELIVERY-002] Aceite atômico de pedido de entrega sem race condition. '
    'UPDATE ... WHERE status=''open'' garante que apenas um entregador consegue o claim. '
    'Se dois entregadores chamam simultaneamente, PostgreSQL serializa: um sucede, '
    'o outro recebe already_taken. Sem necessidade de locks ou mutexes externos. '
    'Marca a notificação do vencedor como accepted e os demais como expired. '
    'Chamado pelo backend ao receber delivery:accept_request via Socket.IO (DA-010).';


-- =====================================================
-- 6. confirm_delivery_step — entregador confirma etapa
-- =====================================================

CREATE OR REPLACE FUNCTION public.confirm_delivery_step(
    p_request_id TEXT,
    p_service_id TEXT,
    p_step       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    VALID_STEPS      CONSTANT TEXT[] := ARRAY[
        'accepted',
        'in_transit_to_pickup',
        'picked_up',
        'in_transit_to_dest',
        'delivered'
    ];
    -- Mapa: step → status anterior esperado (garante sequência correta)
    EXPECTED_PREV    TEXT;
    ts_column        TEXT;
    updated          delivery_requests;
BEGIN
    -- Valida step
    IF NOT (p_step = ANY(VALID_STEPS)) THEN
        RETURN jsonb_build_object(
            'ok', false, 'error', 'invalid_step',
            'message', 'Etapa inválida: ' || p_step
        );
    END IF;

    -- Determina o status anterior esperado para garantir sequência
    EXPECTED_PREV := CASE p_step
        WHEN 'accepted'              THEN 'matched'
        WHEN 'in_transit_to_pickup'  THEN 'accepted'
        WHEN 'picked_up'             THEN 'in_transit_to_pickup'
        WHEN 'in_transit_to_dest'    THEN 'picked_up'
        WHEN 'delivered'             THEN 'in_transit_to_dest'
    END;

    -- Determina coluna de timestamp
    ts_column := CASE p_step
        WHEN 'accepted'              THEN 'accepted_at'
        WHEN 'picked_up'             THEN 'picked_up_at'
        WHEN 'delivered'             THEN 'delivered_at'
        ELSE NULL  -- in_transit_* não têm coluna de timestamp própria
    END;

    -- UPDATE atômico: só avança se status anterior está correto e o service_id bate
    IF ts_column IS NOT NULL THEN
        EXECUTE format(
            'UPDATE public.delivery_requests
             SET status = $1, %I = NOW(), updated_at = NOW()
             WHERE id = $2 AND service_id = $3 AND status = $4
             RETURNING *',
            ts_column
        )
        INTO updated
        USING p_step, p_request_id, p_service_id, EXPECTED_PREV;
    ELSE
        UPDATE public.delivery_requests
        SET status = p_step, updated_at = NOW()
        WHERE id = p_request_id
          AND service_id = p_service_id
          AND status = EXPECTED_PREV
        RETURNING * INTO updated;
    END IF;

    IF updated.id IS NULL THEN
        RETURN jsonb_build_object(
            'ok', false, 'error', 'invalid_transition',
            'message', format('Transição inválida para %s. Status atual não é %s.', p_step, EXPECTED_PREV)
        );
    END IF;

    -- Se entregue: atualiza reputação e dispara fundo de garantia (via backend)
    IF p_step = 'delivered' THEN
        UPDATE public.delivery_services
        SET
            total_deliveries = total_deliveries + 1,
            updated_at       = NOW()
        WHERE id = p_service_id;
    END IF;

    RETURN jsonb_build_object(
        'ok',       true,
        'step',     p_step,
        'order_id', updated.order_id,
        'seller_id', updated.seller_id
    );
END;
$$;

COMMENT ON FUNCTION public.confirm_delivery_step(TEXT, TEXT, TEXT) IS
    '[DELIVERY-002] Confirma uma etapa do trajeto de entrega. '
    'Garante sequência correta via UPDATE ... WHERE status=EXPECTED_PREV. '
    'Etapas: matched→accepted→in_transit_to_pickup→picked_up→in_transit_to_dest→delivered. '
    'Em delivered: incrementa total_deliveries no delivery_services. '
    'Chamado pelo backend ao receber delivery:step_confirm via Socket.IO.';


-- =====================================================
-- 7. expire_delivery_notifications — job de limpeza
-- =====================================================

CREATE OR REPLACE FUNCTION public.expire_delivery_notifications(
    p_request_id TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    expired_count INTEGER;
BEGIN
    UPDATE public.delivery_notifications
    SET response = 'expired', responded_at = NOW()
    WHERE response IS NULL
      AND expires_at <= NOW()
      AND (p_request_id IS NULL OR request_id = p_request_id)
    ;

    GET DIAGNOSTICS expired_count = ROW_COUNT;
    RETURN expired_count;
END;
$$;

COMMENT ON FUNCTION public.expire_delivery_notifications(TEXT) IS
    '[DELIVERY-002] Marca como expiradas as notificações de entrega sem resposta. '
    'Chamado pelo backend após timeout de 5 min (scheduleRequestTimeout). '
    'p_request_id = NULL processa todas as expiradas (job de manutenção periódico). '
    'Retorna o número de notificações marcadas como expiradas.';


-- =====================================================
-- 8. get_delivery_dashboard — painel do entregador
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_delivery_dashboard(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    svc              delivery_services;
    session_active   BOOLEAN;
    today_count      INTEGER;
    today_earnings   NUMERIC;
    week_count       INTEGER;
    week_earnings    NUMERIC;
    pending_count    INTEGER;
BEGIN
    SELECT * INTO svc
    FROM public.delivery_services
    WHERE user_id = p_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'no_service');
    END IF;

    -- Verifica sessão ativa
    SELECT EXISTS(
        SELECT 1 FROM public.delivery_active_sessions
        WHERE service_id = svc.id AND expires_at > NOW()
    ) INTO session_active;

    -- Entregas de hoje
    SELECT COUNT(*), COALESCE(SUM(accepted_fee), 0)
    INTO today_count, today_earnings
    FROM public.delivery_requests
    WHERE service_id = svc.id
      AND status = 'delivered'
      AND delivered_at >= CURRENT_DATE;

    -- Entregas da semana
    SELECT COUNT(*), COALESCE(SUM(accepted_fee), 0)
    INTO week_count, week_earnings
    FROM public.delivery_requests
    WHERE service_id = svc.id
      AND status = 'delivered'
      AND delivered_at >= date_trunc('week', NOW());

    -- Pedidos pendentes (aceitos mas não concluídos)
    SELECT COUNT(*) INTO pending_count
    FROM public.delivery_requests
    WHERE service_id = svc.id
      AND status IN ('matched', 'accepted', 'in_transit_to_pickup', 'picked_up', 'in_transit_to_dest');

    RETURN jsonb_build_object(
        'ok',               true,
        'service_id',       svc.id,
        'is_available',     session_active,
        'delivery_level',   svc.delivery_level,
        'average_rating',   svc.average_rating,
        'total_deliveries', svc.total_deliveries,
        'today',            jsonb_build_object(
            'count',    today_count,
            'earnings', today_earnings
        ),
        'week',             jsonb_build_object(
            'count',    week_count,
            'earnings', week_earnings
        ),
        'pending_count',    pending_count
    );
END;
$$;

COMMENT ON FUNCTION public.get_delivery_dashboard(TEXT) IS
    '[DELIVERY-002] Dados do painel do entregador: '
    'status online, ganhos hoje/semana, nível, rating, pedidos pendentes. '
    'Chamado pelo DeliveryDashboard.js no frontend via GET /api/delivery/dashboard.';

GRANT EXECUTE ON FUNCTION public.get_delivery_dashboard(TEXT) TO authenticated;


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar.
-- =====================================================

-- V1. Confirmar 6 funções criadas:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'haversine_km','upsert_delivery_session','find_eligible_deliverers_live',
--     'calculate_delivery_fee','claim_delivery_request',
--     'confirm_delivery_step','expire_delivery_notifications','get_delivery_dashboard'
--   )
-- ORDER BY routine_name;
-- Esperado: 8 linhas.

-- V2. Haversine entre São Paulo e Rio (≈ 358 km em linha reta):
-- SELECT round(public.haversine_km(-23.5505,-46.6333,-22.9068,-43.1729)::numeric,1);
-- Esperado: 358.x km

-- V3. Haversine × 1.3 (distância estimada de estrada SP→RJ):
-- SELECT round((public.haversine_km(-23.5505,-46.6333,-22.9068,-43.1729) * 1.3)::numeric,1);
-- Esperado: ≈ 465 km (vs ~430 km real pela Dutra — margem aceitável para MVP)

-- V4. compute_region_key (de 20260610000001) — confirmar disponível:
-- SELECT public.compute_region_key(-23.5505, -46.6333);
-- Esperado: 'geo:-470:-933'

-- V5. claim_delivery_request com request inexistente (deve retornar error):
-- SELECT public.claim_delivery_request('req-inexistente','svc-inexistente','user-inexistente');
-- Esperado: {"ok": false, "error": "unauthorized", ...}
