-- =====================================================
-- MIGRAÇÃO: Carona Solidária — Schema Principal
-- [CARONA-001] 7 tabelas + RLS + triggers + indexes
--
-- Modelo BlaBlaCar: motoristas compartilham viagens que
-- já fariam; passageiros dividem custo de combustível.
-- Teto legal: R$0,99/km (INSS) ÷ vagas.
--
-- Tabelas:
--   1. carona_driver_profiles  — perfil verificado do motorista
--   2. carona_rides            — viagem postada (agendada)
--   3. carona_seats            — reserva de vaga por passageiro
--   4. carona_checkins         — log de embarque/desembarque digital
--   5. carona_ratings          — avaliação bilateral motorista↔passageiro
--   6. carona_billing_events   — audit trail imutável de cobranças
--   7. carona_reports          — denúncias de segurança
--
-- Depende de:
--   20260513000000_identity_schema.sql (users)
--
-- Agente: claudia-agent | Revisado por: Léo (PO)
-- Data: 2026-06-20
-- =====================================================


-- =====================================================
-- 1. carona_driver_profiles
--    Perfil de motorista verificado — gate de segurança
--    Trust Level 3+ E veículo verificado por admin
-- =====================================================

CREATE TABLE IF NOT EXISTS public.carona_driver_profiles (
    id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id               TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    -- Veículo (SEM MOTO — segurança do passageiro)
    vehicle_type          TEXT NOT NULL
                              CHECK (vehicle_type IN ('carro', 'van', 'caminhonete')),
    vehicle_model         TEXT NOT NULL,
    vehicle_color         TEXT,
    vehicle_year          INTEGER CHECK (vehicle_year IS NULL OR vehicle_year BETWEEN 1990 AND 2050),
    vehicle_plate         TEXT NOT NULL,  -- visível apenas para passageiros confirmados

    -- Verificação documental (Supabase Storage)
    vehicle_doc_url       TEXT,     -- foto do CRLV
    vehicle_photo_url     TEXT,     -- foto do veículo
    cnh_url               TEXT,     -- foto da CNH (opcional, recomendado)

    -- Status de verificação
    verification_status   TEXT NOT NULL DEFAULT 'pending'
                              CHECK (verification_status IN ('pending', 'verified', 'rejected')),
    rejection_reason      TEXT,
    verified_at           TIMESTAMPTZ,
    verified_by           TEXT,    -- admin user_id

    -- Estatísticas (atualizadas via RPCs)
    average_rating        NUMERIC(3, 2) NOT NULL DEFAULT 0.00,
    total_rides           INTEGER NOT NULL DEFAULT 0,

    -- Controle
    is_active             BOOLEAN NOT NULL DEFAULT true,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (user_id)      -- um perfil de motorista por usuário
);

COMMENT ON TABLE public.carona_driver_profiles IS
    '[CARONA-001] Perfil de motorista verificado para Carona Solidária. '
    'Gate duplo: Trust Level 3+ (verificado no backend) E verification_status=verified. '
    'Sem moto por segurança: passageiro fisicamente dentro do veículo. '
    'vehicle_plate visível apenas para passageiros confirmados (RLS).';

-- Índices
CREATE INDEX IF NOT EXISTS idx_carona_drivers_user
    ON public.carona_driver_profiles (user_id);

CREATE INDEX IF NOT EXISTS idx_carona_drivers_status
    ON public.carona_driver_profiles (verification_status)
    WHERE verification_status = 'pending';


-- =====================================================
-- 2. carona_rides
--    Viagem postada pelo motorista (pré-agendada)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.carona_rides (
    id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    driver_id             TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    driver_profile_id     TEXT NOT NULL REFERENCES public.carona_driver_profiles(id),

    -- Origem (textual + coordenadas)
    origin_address        TEXT NOT NULL,
    origin_neighborhood   TEXT,
    origin_city           TEXT NOT NULL,
    origin_state          VARCHAR(60) NOT NULL,
    origin_lat            NUMERIC(10, 7),
    origin_lng            NUMERIC(10, 7),
    origin_cep            TEXT,

    -- Destino (textual + coordenadas)
    dest_address          TEXT NOT NULL,
    dest_neighborhood     TEXT,
    dest_city             TEXT NOT NULL,
    dest_state            VARCHAR(60) NOT NULL,
    dest_lat              NUMERIC(10, 7),
    dest_lng              NUMERIC(10, 7),
    dest_cep              TEXT,

    -- Agenda
    departure_at          TIMESTAMPTZ NOT NULL,
    estimated_arrival     TIMESTAMPTZ,
    duration_minutes      INTEGER,        -- estimado via Google Maps ou Haversine

    -- Vagas
    total_seats           INTEGER NOT NULL DEFAULT 1
                              CHECK (total_seats BETWEEN 1 AND 4),
    seats_available       INTEGER NOT NULL DEFAULT 1,

    -- Preço (teto legal enforced no backend)
    -- price_per_seat = min(driver_price, (route_km × 0.99) / total_seats)
    route_km              NUMERIC(8, 2),
    price_per_seat_brl    NUMERIC(8, 2) NOT NULL CHECK (price_per_seat_brl >= 0),
    legal_cap_brl         NUMERIC(8, 2),  -- computado: (route_km × 0.99) / total_seats
    distance_source       TEXT DEFAULT 'haversine'
                              CHECK (distance_source IN ('google_maps', 'haversine')),

    -- Preferências da viagem
    accepts_luggage       BOOLEAN NOT NULL DEFAULT false,
    accepts_pets          BOOLEAN NOT NULL DEFAULT false,
    smoking_allowed       BOOLEAN NOT NULL DEFAULT false,
    notes                 TEXT CHECK (notes IS NULL OR length(notes) <= 500),

    -- Recorrência
    is_recurring          BOOLEAN NOT NULL DEFAULT false,
    parent_ride_id        TEXT REFERENCES public.carona_rides(id) ON DELETE SET NULL,
    recurrence_rule       JSONB,   -- { freq: 'weekly', days: [1,3,5], until: '2026-12-31' }

    -- Máquina de estados
    status                TEXT NOT NULL DEFAULT 'open'
                              CHECK (status IN (
                                  'open',         -- aceitando passageiros
                                  'full',         -- todas as vagas preenchidas
                                  'departed',     -- motorista fez check-in, viagem em andamento
                                  'completed',    -- todos desembarcaram
                                  'cancelled',    -- motorista cancelou
                                  'expired'       -- departure_at passou sem ação
                              )),

    -- Gate de confiança para passageiros
    required_trust_level  INTEGER NOT NULL DEFAULT 2,

    -- EloCoins
    accepts_eloscoins     BOOLEAN NOT NULL DEFAULT false,

    -- Timestamps
    departed_at           TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    cancelled_at          TIMESTAMPTZ,
    cancellation_reason   TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Regra: seats_available não pode exceder total_seats
    CONSTRAINT seats_within_total CHECK (seats_available >= 0 AND seats_available <= total_seats)
);

COMMENT ON TABLE public.carona_rides IS
    '[CARONA-001] Viagem de carona solidária postada pelo motorista. '
    'Modelo BlaBlaCar: divisão de custo de combustível, não transporte remunerado. '
    'Teto legal (R$0,99/km ÷ vagas) verificado no backend via calculate_carona_price(). '
    'Suporta recorrência: parent_ride_id + recurrence_rule JSONB.';

-- Índices (caminho crítico de busca)
CREATE INDEX IF NOT EXISTS idx_carona_rides_departure_status
    ON public.carona_rides (departure_at, status)
    WHERE status IN ('open', 'full');

CREATE INDEX IF NOT EXISTS idx_carona_rides_origin_dest_geo
    ON public.carona_rides (origin_lat, origin_lng, dest_lat, dest_lng)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_carona_rides_driver
    ON public.carona_rides (driver_id, departure_at DESC);

CREATE INDEX IF NOT EXISTS idx_carona_rides_origin_city
    ON public.carona_rides (origin_city, dest_city, departure_at)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_carona_rides_parent
    ON public.carona_rides (parent_ride_id)
    WHERE parent_ride_id IS NOT NULL;


-- =====================================================
-- 3. carona_seats
--    Reserva de vaga por passageiro
-- =====================================================

CREATE TABLE IF NOT EXISTS public.carona_seats (
    id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    ride_id               TEXT NOT NULL REFERENCES public.carona_rides(id) ON DELETE CASCADE,
    passenger_id          TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    -- Embarque/desembarque do passageiro na rota
    pickup_address        TEXT NOT NULL,
    pickup_neighborhood   TEXT,
    pickup_city           TEXT NOT NULL,
    pickup_lat            NUMERIC(10, 7),
    pickup_lng            NUMERIC(10, 7),
    dropoff_address       TEXT NOT NULL,
    dropoff_neighborhood  TEXT,
    dropoff_city          TEXT NOT NULL,
    dropoff_lat           NUMERIC(10, 7),
    dropoff_lng           NUMERIC(10, 7),

    -- Distância do segmento (desvio do motorista para este passageiro)
    segment_km            NUMERIC(8, 2),

    -- Pagamento
    amount_brl            NUMERIC(8, 2) NOT NULL,            -- valor pago pelo passageiro
    platform_fee_brl      NUMERIC(8, 2) NOT NULL DEFAULT 0.00,  -- 0 assinante, R$1 outros
    payment_intent_id     TEXT,                               -- Stripe PaymentIntent ID
    payment_status        TEXT NOT NULL DEFAULT 'pending'
                              CHECK (payment_status IN (
                                  'pending', 'authorized', 'captured', 'refunded', 'failed'
                              )),

    -- Estado do assento
    status                TEXT NOT NULL DEFAULT 'pending_payment'
                              CHECK (status IN (
                                  'pending_payment',     -- aguardando Stripe authorization
                                  'confirmed',           -- pagamento autorizado, vaga travada
                                  'boarded',             -- passageiro embarcou (check-in digital)
                                  'completed',           -- passageiro desembarcou
                                  'cancelled_passenger', -- passageiro cancelou
                                  'cancelled_driver',    -- motorista cancelou (cascata)
                                  'no_show_passenger',   -- passageiro não apareceu
                                  'no_show_driver'       -- motorista cancelou em cima da hora
                              )),

    -- Cancelamento
    cancellation_reason   TEXT,
    cancelled_at          TIMESTAMPTZ,

    -- Timestamps
    boarded_at            TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (ride_id, passenger_id)  -- uma vaga por passageiro por viagem
);

COMMENT ON TABLE public.carona_seats IS
    '[CARONA-001] Reserva de vaga em carona solidária. '
    'Cada passageiro reserva 1 vaga por viagem. Decremento atômico via book_carona_seat() RPC. '
    'Stripe manual capture: hold ao reservar, capture na partida, void ao cancelar. '
    'platform_fee_brl: R$0 para assinantes Brasileirinho, R$1,00 para demais.';

-- Índices
CREATE INDEX IF NOT EXISTS idx_carona_seats_ride_passenger
    ON public.carona_seats (ride_id, passenger_id);

CREATE INDEX IF NOT EXISTS idx_carona_seats_passenger_status
    ON public.carona_seats (passenger_id, status);

CREATE INDEX IF NOT EXISTS idx_carona_seats_ride_status
    ON public.carona_seats (ride_id, status)
    WHERE status NOT IN ('cancelled_passenger', 'cancelled_driver');


-- =====================================================
-- 4. carona_checkins
--    Log de embarque/desembarque digital
-- =====================================================

CREATE TABLE IF NOT EXISTS public.carona_checkins (
    id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    seat_id               TEXT NOT NULL REFERENCES public.carona_seats(id) ON DELETE CASCADE,
    ride_id               TEXT NOT NULL REFERENCES public.carona_rides(id),
    passenger_id          TEXT NOT NULL,
    event_type            TEXT NOT NULL
                              CHECK (event_type IN ('boarded', 'alighted')),
    lat                   NUMERIC(10, 7),
    lng                   NUMERIC(10, 7),
    device_time           TIMESTAMPTZ,    -- hora do dispositivo (pode divergir do servidor)
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.carona_checkins IS
    '[CARONA-001] Log imutável de eventos de embarque/desembarque. '
    'Registrado pelo motorista ou passageiro no momento do evento. '
    'device_time captura a hora do dispositivo para auditoria LGPD.';

CREATE INDEX IF NOT EXISTS idx_carona_checkins_seat
    ON public.carona_checkins (seat_id);

CREATE INDEX IF NOT EXISTS idx_carona_checkins_ride
    ON public.carona_checkins (ride_id, event_type);


-- =====================================================
-- 5. carona_ratings
--    Avaliação bilateral motorista↔passageiro
--    Imutável por design (trilha de auditoria — LGPD)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.carona_ratings (
    id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    ride_id               TEXT NOT NULL REFERENCES public.carona_rides(id),
    seat_id               TEXT NOT NULL REFERENCES public.carona_seats(id),
    rater_id              TEXT NOT NULL REFERENCES public.users(id),
    rated_id              TEXT NOT NULL REFERENCES public.users(id),
    rater_role            TEXT NOT NULL
                              CHECK (rater_role IN ('driver', 'passenger')),
    rated_role            TEXT NOT NULL
                              CHECK (rated_role IN ('driver', 'passenger')),
    score                 SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
    comment               TEXT CHECK (comment IS NULL OR length(comment) <= 500),
    tags                  TEXT[],   -- ex: ['pontual','seguro','amigavel','carro_limpo']
    is_anonymous          BOOLEAN NOT NULL DEFAULT false,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Regras de integridade
    UNIQUE (seat_id, rater_id),           -- uma avaliação por pessoa por assento
    CHECK (rater_role != rated_role),      -- papéis distintos
    CHECK (rater_id   != rated_id)         -- sem auto-avaliação
);

COMMENT ON TABLE public.carona_ratings IS
    '[CARONA-001] Avaliações bilaterais pós-carona. '
    'Motorista avalia cada passageiro; cada passageiro avalia o motorista. '
    'Imutável: sem UPDATE/DELETE (LGPD art. 37). Janela: 7 dias após completed_at. '
    'Tags sugeridas: pontual, seguro, amigavel, carro_limpo, boa_conversa, cancelou_em_cima.';

-- Índices
CREATE INDEX IF NOT EXISTS idx_carona_ratings_ride
    ON public.carona_ratings (ride_id);

CREATE INDEX IF NOT EXISTS idx_carona_ratings_rater
    ON public.carona_ratings (rater_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_carona_ratings_rated_driver
    ON public.carona_ratings (rated_id, created_at DESC)
    WHERE rated_role = 'driver';


-- =====================================================
-- 6. carona_billing_events
--    Audit trail imutável de cobranças da plataforma
-- =====================================================

CREATE TABLE IF NOT EXISTS public.carona_billing_events (
    id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    seat_id               TEXT NOT NULL REFERENCES public.carona_seats(id),
    ride_id               TEXT NOT NULL REFERENCES public.carona_rides(id),
    passenger_id          TEXT NOT NULL,
    event_type            TEXT NOT NULL
                              CHECK (event_type IN (
                                  'fee_charged',            -- R$1 cobrado
                                  'fee_waived_subscriber',  -- assinante: R$0
                                  'fee_refunded',           -- reembolso
                                  'capture',                -- Stripe capture
                                  'void'                    -- Stripe void
                              )),
    amount_brl            NUMERIC(8, 2) NOT NULL,
    platform_fee_brl      NUMERIC(8, 2) NOT NULL DEFAULT 0.00,
    metadata              JSONB NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.carona_billing_events IS
    '[CARONA-001] Trilha de auditoria imutável para cobranças de carona. '
    'Append-only: sem UPDATE/DELETE via RLS. '
    'Registra tanto a contribuição do passageiro quanto a taxa da plataforma.';

CREATE INDEX IF NOT EXISTS idx_carona_billing_seat
    ON public.carona_billing_events (seat_id);

CREATE INDEX IF NOT EXISTS idx_carona_billing_ride
    ON public.carona_billing_events (ride_id);


-- =====================================================
-- 7. carona_reports
--    Denúncias de segurança
-- =====================================================

CREATE TABLE IF NOT EXISTS public.carona_reports (
    id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    ride_id               TEXT NOT NULL REFERENCES public.carona_rides(id),
    seat_id               TEXT REFERENCES public.carona_seats(id),   -- opcional
    reporter_id           TEXT NOT NULL REFERENCES public.users(id),
    reported_id           TEXT NOT NULL REFERENCES public.users(id),
    reason                TEXT NOT NULL
                              CHECK (reason IN (
                                  'unsafe_driving',
                                  'verbal_abuse',
                                  'no_show',
                                  'overcharge',
                                  'inappropriate_behavior',
                                  'vehicle_mismatch',
                                  'other'
                              )),
    description           TEXT CHECK (description IS NULL OR length(description) <= 1000),
    status                TEXT NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
    admin_notes           TEXT,
    resolved_at           TIMESTAMPTZ,
    resolved_by           TEXT,   -- admin user_id
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.carona_reports IS
    '[CARONA-001] Denúncias de segurança em caronas. '
    'Carona é o contexto de maior vulnerabilidade da plataforma. '
    'Denúncias graves (unsafe_driving, verbal_abuse) geram trust event negativo imediato.';

CREATE INDEX IF NOT EXISTS idx_carona_reports_ride
    ON public.carona_reports (ride_id);

CREATE INDEX IF NOT EXISTS idx_carona_reports_reported
    ON public.carona_reports (reported_id, status)
    WHERE status IN ('open', 'reviewing');


-- =====================================================
-- 8. Triggers: updated_at automático
-- =====================================================

-- Reutiliza trg_fn_set_updated_at se já existir, senão cria
CREATE OR REPLACE FUNCTION public.trg_fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_carona_driver_profiles_updated_at
    BEFORE UPDATE ON public.carona_driver_profiles
    FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

CREATE TRIGGER trg_carona_rides_updated_at
    BEFORE UPDATE ON public.carona_rides
    FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

CREATE TRIGGER trg_carona_seats_updated_at
    BEFORE UPDATE ON public.carona_seats
    FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();


-- =====================================================
-- 9. Trigger: auto-fill/update ride status
--    Quando seats_available chega a 0, status → 'full'
--    Quando volta acima de 0, status → 'open' (se estava 'full')
-- =====================================================

CREATE OR REPLACE FUNCTION public.trg_fn_carona_ride_seats_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.seats_available = 0 AND NEW.status = 'open' THEN
        NEW.status := 'full';
    ELSIF NEW.seats_available > 0 AND OLD.seats_available = 0 AND NEW.status = 'full' THEN
        NEW.status := 'open';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_carona_rides_seats_sync
    BEFORE UPDATE ON public.carona_rides
    FOR EACH ROW
    WHEN (OLD.seats_available IS DISTINCT FROM NEW.seats_available)
    EXECUTE FUNCTION trg_fn_carona_ride_seats_sync();


-- =====================================================
-- 10. RLS Policies
-- =====================================================

-- -- carona_driver_profiles --
ALTER TABLE public.carona_driver_profiles ENABLE ROW LEVEL SECURITY;

-- Leitura: próprio perfil + admin
DROP POLICY IF EXISTS "carona_drivers_own_read" ON public.carona_driver_profiles;
CREATE POLICY "carona_drivers_own_read"
    ON public.carona_driver_profiles FOR SELECT TO authenticated
    USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "carona_drivers_admin_read" ON public.carona_driver_profiles;
CREATE POLICY "carona_drivers_admin_read"
    ON public.carona_driver_profiles FOR SELECT TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

-- Dados públicos visíveis para passageiros confirmados (via RPC, não RLS direto)
-- vehicle_plate só exposto via RPC para passageiros com seat confirmado

-- Insert: próprio usuário
DROP POLICY IF EXISTS "carona_drivers_own_insert" ON public.carona_driver_profiles;
CREATE POLICY "carona_drivers_own_insert"
    ON public.carona_driver_profiles FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid()::text);

-- Update: próprio usuário (dados pessoais) + admin (verification_status)
DROP POLICY IF EXISTS "carona_drivers_own_update" ON public.carona_driver_profiles;
CREATE POLICY "carona_drivers_own_update"
    ON public.carona_driver_profiles FOR UPDATE TO authenticated
    USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "carona_drivers_admin_update" ON public.carona_driver_profiles;
CREATE POLICY "carona_drivers_admin_update"
    ON public.carona_driver_profiles FOR UPDATE TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

-- Delete: proibido (soft delete via is_active)
DROP POLICY IF EXISTS "carona_drivers_no_delete" ON public.carona_driver_profiles;
CREATE POLICY "carona_drivers_no_delete"
    ON public.carona_driver_profiles FOR DELETE TO authenticated
    USING (false);


-- -- carona_rides --
ALTER TABLE public.carona_rides ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer autenticado pode ver rides abertas/cheias
DROP POLICY IF EXISTS "carona_rides_public_read" ON public.carona_rides;
CREATE POLICY "carona_rides_public_read"
    ON public.carona_rides FOR SELECT TO authenticated
    USING (status IN ('open', 'full'));

-- Leitura: motorista vê todas as suas
DROP POLICY IF EXISTS "carona_rides_driver_read" ON public.carona_rides;
CREATE POLICY "carona_rides_driver_read"
    ON public.carona_rides FOR SELECT TO authenticated
    USING (driver_id = auth.uid()::text);

-- Leitura: admin vê tudo
DROP POLICY IF EXISTS "carona_rides_admin_read" ON public.carona_rides;
CREATE POLICY "carona_rides_admin_read"
    ON public.carona_rides FOR SELECT TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

-- Insert: próprio motorista
DROP POLICY IF EXISTS "carona_rides_driver_insert" ON public.carona_rides;
CREATE POLICY "carona_rides_driver_insert"
    ON public.carona_rides FOR INSERT TO authenticated
    WITH CHECK (driver_id = auth.uid()::text);

-- Update: próprio motorista
DROP POLICY IF EXISTS "carona_rides_driver_update" ON public.carona_rides;
CREATE POLICY "carona_rides_driver_update"
    ON public.carona_rides FOR UPDATE TO authenticated
    USING (driver_id = auth.uid()::text);

-- Delete: proibido (usa status cancelled)
DROP POLICY IF EXISTS "carona_rides_no_delete" ON public.carona_rides;
CREATE POLICY "carona_rides_no_delete"
    ON public.carona_rides FOR DELETE TO authenticated
    USING (false);


-- -- carona_seats --
ALTER TABLE public.carona_seats ENABLE ROW LEVEL SECURITY;

-- Leitura: passageiro vê as suas
DROP POLICY IF EXISTS "carona_seats_passenger_read" ON public.carona_seats;
CREATE POLICY "carona_seats_passenger_read"
    ON public.carona_seats FOR SELECT TO authenticated
    USING (passenger_id = auth.uid()::text);

-- Leitura: motorista da viagem vê todos os assentos
DROP POLICY IF EXISTS "carona_seats_driver_read" ON public.carona_seats;
CREATE POLICY "carona_seats_driver_read"
    ON public.carona_seats FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.carona_rides
            WHERE id = ride_id AND driver_id = auth.uid()::text
        )
    );

-- Admin
DROP POLICY IF EXISTS "carona_seats_admin_read" ON public.carona_seats;
CREATE POLICY "carona_seats_admin_read"
    ON public.carona_seats FOR SELECT TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

-- Insert: próprio passageiro
DROP POLICY IF EXISTS "carona_seats_passenger_insert" ON public.carona_seats;
CREATE POLICY "carona_seats_passenger_insert"
    ON public.carona_seats FOR INSERT TO authenticated
    WITH CHECK (passenger_id = auth.uid()::text);

-- Update: passageiro (cancelar) + motorista da viagem (confirmar embarque)
DROP POLICY IF EXISTS "carona_seats_passenger_update" ON public.carona_seats;
CREATE POLICY "carona_seats_passenger_update"
    ON public.carona_seats FOR UPDATE TO authenticated
    USING (passenger_id = auth.uid()::text);

DROP POLICY IF EXISTS "carona_seats_driver_update" ON public.carona_seats;
CREATE POLICY "carona_seats_driver_update"
    ON public.carona_seats FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.carona_rides
            WHERE id = ride_id AND driver_id = auth.uid()::text
        )
    );

-- Delete: proibido
DROP POLICY IF EXISTS "carona_seats_no_delete" ON public.carona_seats;
CREATE POLICY "carona_seats_no_delete"
    ON public.carona_seats FOR DELETE TO authenticated
    USING (false);


-- -- carona_checkins --
ALTER TABLE public.carona_checkins ENABLE ROW LEVEL SECURITY;

-- Leitura: partes da viagem (motorista + passageiro do assento)
DROP POLICY IF EXISTS "carona_checkins_parties_read" ON public.carona_checkins;
CREATE POLICY "carona_checkins_parties_read"
    ON public.carona_checkins FOR SELECT TO authenticated
    USING (
        passenger_id = auth.uid()::text
        OR EXISTS (
            SELECT 1 FROM public.carona_rides
            WHERE id = ride_id AND driver_id = auth.uid()::text
        )
    );

-- Insert: motorista da viagem (registra embarque/desembarque)
DROP POLICY IF EXISTS "carona_checkins_driver_insert" ON public.carona_checkins;
CREATE POLICY "carona_checkins_driver_insert"
    ON public.carona_checkins FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.carona_rides
            WHERE id = ride_id AND driver_id = auth.uid()::text
        )
    );

-- Sem update/delete (imutável)
DROP POLICY IF EXISTS "carona_checkins_no_update" ON public.carona_checkins;
CREATE POLICY "carona_checkins_no_update"
    ON public.carona_checkins FOR UPDATE TO authenticated
    USING (false);

DROP POLICY IF EXISTS "carona_checkins_no_delete" ON public.carona_checkins;
CREATE POLICY "carona_checkins_no_delete"
    ON public.carona_checkins FOR DELETE TO authenticated
    USING (false);


-- -- carona_ratings --
ALTER TABLE public.carona_ratings ENABLE ROW LEVEL SECURITY;

-- Leitura: partes da viagem
DROP POLICY IF EXISTS "carona_ratings_parties_read" ON public.carona_ratings;
CREATE POLICY "carona_ratings_parties_read"
    ON public.carona_ratings FOR SELECT TO authenticated
    USING (
        rater_id = auth.uid()::text
        OR rated_id = auth.uid()::text
    );

-- Admin
DROP POLICY IF EXISTS "carona_ratings_admin_read" ON public.carona_ratings;
CREATE POLICY "carona_ratings_admin_read"
    ON public.carona_ratings FOR SELECT TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

-- Insert: rater_id = próprio + verificação de ser parte feita na RPC
DROP POLICY IF EXISTS "carona_ratings_party_insert" ON public.carona_ratings;
CREATE POLICY "carona_ratings_party_insert"
    ON public.carona_ratings FOR INSERT TO authenticated
    WITH CHECK (rater_id = auth.uid()::text);

-- Imutável: sem update/delete
DROP POLICY IF EXISTS "carona_ratings_no_update" ON public.carona_ratings;
CREATE POLICY "carona_ratings_no_update"
    ON public.carona_ratings FOR UPDATE TO authenticated
    USING (false);

DROP POLICY IF EXISTS "carona_ratings_no_delete" ON public.carona_ratings;
CREATE POLICY "carona_ratings_no_delete"
    ON public.carona_ratings FOR DELETE TO authenticated
    USING (false);


-- -- carona_billing_events --
ALTER TABLE public.carona_billing_events ENABLE ROW LEVEL SECURITY;

-- Leitura: passageiro vê os seus
DROP POLICY IF EXISTS "carona_billing_passenger_read" ON public.carona_billing_events;
CREATE POLICY "carona_billing_passenger_read"
    ON public.carona_billing_events FOR SELECT TO authenticated
    USING (passenger_id = auth.uid()::text);

-- Admin
DROP POLICY IF EXISTS "carona_billing_admin_read" ON public.carona_billing_events;
CREATE POLICY "carona_billing_admin_read"
    ON public.carona_billing_events FOR SELECT TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

-- Insert: apenas via SECURITY DEFINER RPCs (service_role)
-- Nenhuma policy de INSERT para authenticated — inserção apenas via backend/RPC
DROP POLICY IF EXISTS "carona_billing_no_insert" ON public.carona_billing_events;
CREATE POLICY "carona_billing_no_insert"
    ON public.carona_billing_events FOR INSERT TO authenticated
    WITH CHECK (false);

-- Imutável
DROP POLICY IF EXISTS "carona_billing_no_update" ON public.carona_billing_events;
CREATE POLICY "carona_billing_no_update"
    ON public.carona_billing_events FOR UPDATE TO authenticated
    USING (false);

DROP POLICY IF EXISTS "carona_billing_no_delete" ON public.carona_billing_events;
CREATE POLICY "carona_billing_no_delete"
    ON public.carona_billing_events FOR DELETE TO authenticated
    USING (false);


-- -- carona_reports --
ALTER TABLE public.carona_reports ENABLE ROW LEVEL SECURITY;

-- Leitura: reporter vê as suas
DROP POLICY IF EXISTS "carona_reports_reporter_read" ON public.carona_reports;
CREATE POLICY "carona_reports_reporter_read"
    ON public.carona_reports FOR SELECT TO authenticated
    USING (reporter_id = auth.uid()::text);

-- Admin vê tudo
DROP POLICY IF EXISTS "carona_reports_admin_read" ON public.carona_reports;
CREATE POLICY "carona_reports_admin_read"
    ON public.carona_reports FOR SELECT TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

-- Insert: qualquer autenticado pode denunciar
DROP POLICY IF EXISTS "carona_reports_insert" ON public.carona_reports;
CREATE POLICY "carona_reports_insert"
    ON public.carona_reports FOR INSERT TO authenticated
    WITH CHECK (reporter_id = auth.uid()::text);

-- Update: apenas admin (mudar status)
DROP POLICY IF EXISTS "carona_reports_admin_update" ON public.carona_reports;
CREATE POLICY "carona_reports_admin_update"
    ON public.carona_reports FOR UPDATE TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

-- Delete: proibido
DROP POLICY IF EXISTS "carona_reports_no_delete" ON public.carona_reports;
CREATE POLICY "carona_reports_no_delete"
    ON public.carona_reports FOR DELETE TO authenticated
    USING (false);


-- =====================================================
-- 11. Revoke anon access
-- =====================================================

REVOKE ALL ON public.carona_driver_profiles FROM anon;
REVOKE ALL ON public.carona_rides            FROM anon;
REVOKE ALL ON public.carona_seats            FROM anon;
REVOKE ALL ON public.carona_checkins         FROM anon;
REVOKE ALL ON public.carona_ratings          FROM anon;
REVOKE ALL ON public.carona_billing_events   FROM anon;
REVOKE ALL ON public.carona_reports          FROM anon;


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar.
-- =====================================================

-- V1. Tabelas criadas:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name LIKE 'carona_%'
-- ORDER BY table_name;
-- Esperado: 7 tabelas.

-- V2. RLS habilitado em todas:
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public' AND tablename LIKE 'carona_%';
-- Esperado: rowsecurity = true para todas.

-- V3. Triggers criados:
-- SELECT trigger_name, event_object_table FROM information_schema.triggers
-- WHERE trigger_name LIKE 'trg_carona%';
-- Esperado: 4 triggers (3 updated_at + 1 seats_sync).

-- V4. Índices criados:
-- SELECT indexname FROM pg_indexes
-- WHERE indexname LIKE 'idx_carona%'
-- ORDER BY indexname;
-- Esperado: ~15 índices.
