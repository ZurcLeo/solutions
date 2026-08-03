-- =====================================================
-- MIGRAÇÃO: Módulo de Delivery ElosCloud — Schema completo
-- [DELIVERY-001] 6 tabelas + helper functions + RLS
--
-- Tabelas criadas:
--   1. delivery_services        — loja de entrega (perfil do entregador)
--   2. delivery_active_sessions — posição atual do entregador (opt-in, temporária)
--   3. delivery_requests        — pedido de entrega (contrato entre 3 partes)
--   4. delivery_proposals       — propostas de entregadores (matching manual)
--   5. delivery_notifications   — fan-out de notificações (audit + timeout)
--   6. delivery_guarantee_fund  — fundo de garantia imutável (2% por entrega)
--
-- Funções helper (SECURITY DEFINER — evitam recursão em RLS):
--   get_my_delivery_service_id()        — retorna delivery_services.id do usuário
--   is_delivery_request_party(req_id)   — verifica acesso ao delivery_request
--   compute_region_key(lat, lng)        — grid ~5km para rooms do Socket.IO
--
-- Modelo RLS — 3 Camadas (padrão ElosCloud):
--   Camada 1 — Server-Only:   delivery_guarantee_fund (financeiro imutável)
--   Camada 2 — User-Scoped:   delivery_active_sessions (só o próprio entregador)
--   Camada 3 — RBAC-Scoped:   delivery_services (leitura pública), requests/proposals
--
-- NOTA ARQUITETURAL — GPS vs Texto:
--   A decisão de privacidade (HYPER-LOC-001) usa localização TEXTUAL para dados
--   permanentes de usuários. delivery_active_sessions é uma EXCEÇÃO JUSTIFICADA:
--     • Sessão voluntária, opt-in, temporária (expira em 45 min)
--     • Contexto comercial: entregador oferece serviço remunerado
--     • GPS é necessário para o cálculo de km que fundamenta a precificação
--     • Dados não são persistidos após a sessão expirar
--   delivery_services.origin_* usa campos TEXTUAIS para o endereço base (privacidade).
--
-- Decisões arquiteturais aprovadas (ClaudIA + Léo, 2026-06-10):
--   DA-008: matching usa posição ATUAL (delivery_active_sessions), não endereço base
--   DA-009: sessão expira em 45 min sem heartbeat
--   DA-010: fan-out para top-5 entregadores; primeiro a aceitar vence (lock otimista)
--   DA-011: sem match em 5 min → expande raio 20%; após 3 tentativas → no_deliverer_found
--   DA-012: frete negociável por vendedor (seller_pays | buyer_pays | split)
--
-- Depende de:
--   20260524000001_marketplace_schema.sql  (seller_profiles, marketplace_orders)
--   20260513000000_identity_schema.sql     (users)
--
-- Agente: marketplace-agent | Revisado por: ClaudIA
-- Data: 2026-06-10
-- =====================================================


-- =====================================================
-- 1. delivery_services — perfil da loja de entrega
-- =====================================================

CREATE TABLE IF NOT EXISTS public.delivery_services (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id                 TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    -- Endereço base (textual — padrão de privacidade da plataforma)
    origin_address          TEXT NOT NULL,
    origin_neighborhood     TEXT,
    origin_city             TEXT NOT NULL,
    origin_state            VARCHAR(60) NOT NULL,

    -- Tarifa
    price_per_km            NUMERIC(8, 2) NOT NULL CHECK (price_per_km >= 0.50),
    minimum_fee             NUMERIC(8, 2) NOT NULL DEFAULT 5.00 CHECK (minimum_fee >= 0),
    base_fee                NUMERIC(8, 2) NOT NULL DEFAULT 0.00 CHECK (base_fee >= 0),

    -- Cobertura: raio máximo de entrega a partir da loja do vendedor (ponto B)
    max_radius_km           INTEGER NOT NULL DEFAULT 10
                                CHECK (max_radius_km BETWEEN 1 AND 100),

    -- Capacidade do veículo
    vehicle_type            TEXT NOT NULL
                                CHECK (vehicle_type IN ('bike','moto','carro','van','caminhonete')),
    max_weight_kg           NUMERIC(8, 2) NOT NULL DEFAULT 20.00 CHECK (max_weight_kg > 0),
    handles_fragile         BOOLEAN NOT NULL DEFAULT false,
    handles_refrigerated    BOOLEAN NOT NULL DEFAULT false,

    -- Disponibilidade configurada (horários de funcionamento)
    available_days          INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}',  -- 0=Dom .. 6=Sab
    available_from          TIME NOT NULL DEFAULT '08:00',
    available_to            TIME NOT NULL DEFAULT '18:00',

    -- Reputação
    total_deliveries        INTEGER NOT NULL DEFAULT 0 CHECK (total_deliveries >= 0),
    average_rating          NUMERIC(3, 2) NOT NULL DEFAULT 0.00
                                CHECK (average_rating BETWEEN 0 AND 5),
    delivery_level          INTEGER NOT NULL DEFAULT 1
                                CHECK (delivery_level BETWEEN 1 AND 5),

    -- ElosCoins e estado
    accepts_eloscoins       BOOLEAN NOT NULL DEFAULT false,
    status                  TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'suspended', 'inactive')),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (user_id)
);

COMMENT ON TABLE public.delivery_services IS
    '[DELIVERY-001] Perfil da loja de entrega. '
    'Um usuário pode ter no máximo uma loja de entrega (UNIQUE user_id). '
    'Orthogonal a seller_profiles: o mesmo usuário pode ser vendedor E entregador. '
    'Nível 1→5 desbloqueado por total_deliveries + average_rating (game-agent).';

COMMENT ON COLUMN public.delivery_services.price_per_km IS
    'Tarifa em R$/km cobrada pelo TRAJETO TOTAL: posição_atual → loja → cliente. '
    'O entregador paga D1 (chegar até a loja) porque esse deslocamento tem custo real. '
    'Esse modelo incentiva matching com entregadores geograficamente próximos da loja.';

COMMENT ON COLUMN public.delivery_services.max_radius_km IS
    'Raio máximo de entrega medido do ponto de COLETA (loja do vendedor) ao cliente. '
    'Não se aplica ao trajeto D1 (entregador→loja), que é cobrado mas sem limite fixo.';

COMMENT ON COLUMN public.delivery_services.available_days IS
    'Array de dias da semana disponíveis. 0=Domingo, 1=Segunda ... 6=Sábado. '
    'Padrão: {1,2,3,4,5} = dias úteis.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_services_user_id
    ON public.delivery_services (user_id);

CREATE INDEX IF NOT EXISTS idx_delivery_services_status_city
    ON public.delivery_services (status, origin_city)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_delivery_services_vehicle_level
    ON public.delivery_services (vehicle_type, delivery_level)
    WHERE status = 'active';


-- =====================================================
-- FUNÇÃO HELPER: get_my_delivery_service_id()
-- Criada após delivery_services (LANGUAGE sql valida em criação).
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_my_delivery_service_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id
    FROM public.delivery_services
    WHERE user_id = auth.uid()::text
      AND status = 'active'
    LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_my_delivery_service_id() IS
    '[DELIVERY-001] Retorna delivery_services.id do usuário autenticado (status=active). '
    'SECURITY DEFINER: usada em policies de delivery_* para evitar recursão RLS.';


-- =====================================================
-- FUNÇÃO HELPER: compute_region_key(lat, lng)
-- Grid de ~5km usado para rooms do Socket.IO.
-- =====================================================

CREATE OR REPLACE FUNCTION public.compute_region_key(p_lat NUMERIC, p_lng NUMERIC)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
    -- 0.05 graus ≈ 5.5 km → grid de células de ~5km
    SELECT 'geo:' || round(p_lat / 0.05)::text || ':' || round(p_lng / 0.05)::text
$$;

COMMENT ON FUNCTION public.compute_region_key(NUMERIC, NUMERIC) IS
    '[DELIVERY-001] Gera chave de região geográfica em grid de ~5km. '
    'Usada pelo realtime-agent para organizar rooms do Socket.IO por área. '
    'IMMUTABLE + PARALLEL SAFE: segura para uso em queries e índices.';

GRANT EXECUTE ON FUNCTION public.compute_region_key(NUMERIC, NUMERIC) TO authenticated;


-- =====================================================
-- RLS — delivery_services (após helpers disponíveis)
-- =====================================================

ALTER TABLE public.delivery_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "delivery_services_public_read" ON public.delivery_services;
CREATE POLICY "delivery_services_public_read"
    ON public.delivery_services
    FOR SELECT
    TO authenticated
    USING (status = 'active');

DROP POLICY IF EXISTS "delivery_services_own_all" ON public.delivery_services;
CREATE POLICY "delivery_services_own_all"
    ON public.delivery_services
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid()::text)
    WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "delivery_services_admin_read" ON public.delivery_services;
CREATE POLICY "delivery_services_admin_read"
    ON public.delivery_services
    FOR SELECT
    TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

REVOKE ALL ON public.delivery_services FROM anon;


-- =====================================================
-- 2. delivery_active_sessions — posição atual do entregador
-- EXCEÇÃO GPS: opt-in, comercial, temporária (ver nota arquitetural acima).
-- =====================================================

CREATE TABLE IF NOT EXISTS public.delivery_active_sessions (
    service_id              TEXT PRIMARY KEY REFERENCES public.delivery_services(id) ON DELETE CASCADE,
    user_id                 TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    -- Posição atual (GPS, opt-in, temporária)
    current_lat             NUMERIC(10, 7),   -- null → usa endereço base da delivery_service
    current_lng             NUMERIC(10, 7),
    use_fallback            BOOLEAN NOT NULL DEFAULT false,  -- true quando GPS recusado

    -- Grid para Socket.IO rooms
    region_key              TEXT NOT NULL,    -- compute_region_key(current_lat, current_lng)

    -- Controle de sessão
    socket_id               TEXT,             -- socket.id atual do entregador
    last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at              TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '45 minutes',

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (user_id),
    CONSTRAINT delivery_active_sessions_not_expired
        CHECK (expires_at > created_at)
);

COMMENT ON TABLE public.delivery_active_sessions IS
    '[DELIVERY-001][GPS-EXCEPTION] Sessão ativa do entregador disponível. '
    'EXCEÇÃO à política no-GPS (HYPER-LOC-001): dados temporários, comerciais, opt-in. '
    'Linha deletada quando entregador vai offline ou expires_at < NOW(). '
    'Usada pelo RPC find_eligible_deliverers_live como fonte de posição para matching. '
    'current_lat/lng = NULL → use_fallback=true → RPC usa origin_* de delivery_services.';

COMMENT ON COLUMN public.delivery_active_sessions.region_key IS
    'Chave de região gerada por compute_region_key(current_lat, current_lng). '
    'Atualizada a cada mudança de região (heartbeat ou location_update via Socket.IO). '
    'Usada pelo realtime-agent para mover o socket entre rooms de região.';

COMMENT ON COLUMN public.delivery_active_sessions.expires_at IS
    'Sessão expira 45 min após last_seen_at sem heartbeat. '
    'Entregador expirado = invisível ao matching. '
    'Renovado a cada delivery:heartbeat ou delivery:location_update via Socket.IO.';

-- Nota: WHERE expires_at > NOW() não é permitido em predicado de índice
-- (NOW() é VOLATILE). O filtro de sessões ativas é feito na query, não no índice.
CREATE INDEX IF NOT EXISTS idx_delivery_active_sessions_region
    ON public.delivery_active_sessions (region_key);

CREATE INDEX IF NOT EXISTS idx_delivery_active_sessions_expires
    ON public.delivery_active_sessions (expires_at);


-- RLS — delivery_active_sessions (Camada 2: só o próprio entregador)
ALTER TABLE public.delivery_active_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "delivery_sessions_own_all" ON public.delivery_active_sessions;
CREATE POLICY "delivery_sessions_own_all"
    ON public.delivery_active_sessions
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid()::text)
    WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "delivery_sessions_admin_read" ON public.delivery_active_sessions;
CREATE POLICY "delivery_sessions_admin_read"
    ON public.delivery_active_sessions
    FOR SELECT
    TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

REVOKE ALL ON public.delivery_active_sessions FROM anon;


-- =====================================================
-- 3. delivery_requests — contrato entre as 3 partes
-- =====================================================

CREATE TABLE IF NOT EXISTS public.delivery_requests (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    order_id                TEXT NOT NULL REFERENCES public.marketplace_orders(id),
    seller_id               TEXT NOT NULL REFERENCES public.seller_profiles(id),
    service_id              TEXT REFERENCES public.delivery_services(id),  -- null até o match

    -- Pontos do trajeto (snapshot no momento da criação)
    pickup_address          TEXT NOT NULL,
    pickup_neighborhood     TEXT,
    pickup_city             TEXT NOT NULL,
    pickup_state            VARCHAR(60) NOT NULL,
    pickup_lat              NUMERIC(10, 7),   -- GPS se disponível, null caso contrário
    pickup_lng              NUMERIC(10, 7),

    dest_address            TEXT NOT NULL,
    dest_neighborhood       TEXT,
    dest_city               TEXT NOT NULL,
    dest_state              VARCHAR(60) NOT NULL,
    dest_lat                NUMERIC(10, 7),
    dest_lng                NUMERIC(10, 7),

    -- Distâncias calculadas (preenchidas no match — em km, fator 1.3 já aplicado)
    origin_to_pickup_km     NUMERIC(8, 2),
    pickup_to_dest_km       NUMERIC(8, 2),
    total_km                NUMERIC(8, 2),

    -- Preço
    quoted_fee              NUMERIC(8, 2),    -- calculado pelo sistema no match
    accepted_fee            NUMERIC(8, 2),    -- confirmado pelo entregador ao aceitar

    -- Produto
    weight_kg               NUMERIC(6, 2) NOT NULL DEFAULT 0,
    is_fragile              BOOLEAN NOT NULL DEFAULT false,
    notes                   TEXT,

    -- Máquina de estados
    status                  TEXT NOT NULL DEFAULT 'open'
                                CHECK (status IN (
                                    'open',
                                    'matched',
                                    'accepted',
                                    'in_transit_to_pickup',
                                    'picked_up',
                                    'in_transit_to_dest',
                                    'delivered',
                                    'completed',
                                    'cancelled',
                                    'no_deliverer_found',
                                    'disputed'
                                )),

    -- Expiração do pedido aberto (sem match → no_deliverer_found)
    match_attempt           INTEGER NOT NULL DEFAULT 0,  -- 0→1→2→3 (max 3 tentativas)
    expires_at              TIMESTAMPTZ,       -- prazo para aceite dos entregadores notificados

    -- Timestamps de cada etapa
    matched_at              TIMESTAMPTZ,
    accepted_at             TIMESTAMPTZ,
    picked_up_at            TIMESTAMPTZ,
    delivered_at            TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ,
    cancelled_at            TIMESTAMPTZ,

    -- Avaliações pós-entrega
    seller_rating           SMALLINT CHECK (seller_rating BETWEEN 1 AND 5),
    buyer_rating            SMALLINT CHECK (buyer_rating BETWEEN 1 AND 5),
    seller_rating_note      TEXT,
    buyer_rating_note       TEXT,

    -- Disputa (delegada ao disputa-agent)
    dispute_id              TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.delivery_requests IS
    '[DELIVERY-001] Pedido de entrega — contrato entre vendedor, entregador e comprador. '
    'Criado quando vendedor solicita entrega após confirmar um marketplace_orders. '
    'Máquina de estados: open→matched→accepted→in_transit_to_pickup→picked_up→in_transit_to_dest→delivered→completed. '
    'Campos pickup_*/dest_* são snapshot no momento da criação (imutável após created_at). '
    'GPS (pickup_lat/lng, dest_lat/lng) é opcional — matching textual como fallback.';

COMMENT ON COLUMN public.delivery_requests.match_attempt IS
    'Contador de tentativas de matching. Incrementado cada vez que o sistema expande o raio. '
    'Após 3 tentativas sem aceite: status → no_deliverer_found, vendedor notificado.';

COMMENT ON COLUMN public.delivery_requests.quoted_fee IS
    'Tarifa calculada pelo sistema (Haversine × fator estrada × price_per_km). '
    'Calculada no momento do match. Nunca aceitar valor enviado pelo cliente.';

CREATE INDEX IF NOT EXISTS idx_delivery_requests_order_id
    ON public.delivery_requests (order_id);

CREATE INDEX IF NOT EXISTS idx_delivery_requests_seller_id
    ON public.delivery_requests (seller_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_requests_service_id
    ON public.delivery_requests (service_id, created_at DESC)
    WHERE service_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_requests_status
    ON public.delivery_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_requests_open_expires
    ON public.delivery_requests (expires_at)
    WHERE status = 'open';


-- =====================================================
-- FUNÇÃO HELPER: is_delivery_request_party(req_id)
-- =====================================================

CREATE OR REPLACE FUNCTION public.is_delivery_request_party(p_request_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.delivery_requests dr
        JOIN public.marketplace_orders mo ON mo.id = dr.order_id
        WHERE dr.id = p_request_id
          AND (
              -- É o entregador
              dr.service_id = get_my_delivery_service_id()
              -- É o vendedor
              OR dr.seller_id = get_my_seller_id()
              -- É o comprador
              OR mo.buyer_id = auth.uid()::text
          )
    );
$$;

COMMENT ON FUNCTION public.is_delivery_request_party(TEXT) IS
    '[DELIVERY-001] Verifica se o usuário é uma das 3 partes do pedido de entrega: '
    'entregador, vendedor ou comprador. SECURITY DEFINER para evitar recursão RLS.';


-- RLS — delivery_requests
ALTER TABLE public.delivery_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "delivery_requests_parties_read" ON public.delivery_requests;
CREATE POLICY "delivery_requests_parties_read"
    ON public.delivery_requests
    FOR SELECT
    TO authenticated
    USING (is_delivery_request_party(id));

DROP POLICY IF EXISTS "delivery_requests_seller_insert" ON public.delivery_requests;
CREATE POLICY "delivery_requests_seller_insert"
    ON public.delivery_requests
    FOR INSERT
    TO authenticated
    WITH CHECK (seller_id = get_my_seller_id());

DROP POLICY IF EXISTS "delivery_requests_admin_all" ON public.delivery_requests;
CREATE POLICY "delivery_requests_admin_all"
    ON public.delivery_requests
    FOR ALL
    TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

REVOKE ALL ON public.delivery_requests FROM anon;


-- =====================================================
-- 4. delivery_proposals — entregadores propõem (matching assistido)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.delivery_proposals (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    request_id              TEXT NOT NULL REFERENCES public.delivery_requests(id) ON DELETE CASCADE,
    service_id              TEXT NOT NULL REFERENCES public.delivery_services(id),
    user_id                 TEXT NOT NULL REFERENCES public.users(id),  -- cache para RLS

    -- Distâncias calculadas na proposta
    origin_to_pickup_km     NUMERIC(8, 2) NOT NULL,
    pickup_to_dest_km       NUMERIC(8, 2) NOT NULL,
    total_km                NUMERIC(8, 2) NOT NULL,
    proposed_fee            NUMERIC(8, 2) NOT NULL CHECK (proposed_fee > 0),

    eta_minutes             INTEGER,   -- estimativa de chegada à loja (em minutos)
    message                 TEXT,      -- mensagem opcional do entregador

    status                  TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at            TIMESTAMPTZ,

    UNIQUE (request_id, service_id)
);

COMMENT ON TABLE public.delivery_proposals IS
    '[DELIVERY-001] Propostas de entregadores para um pedido aberto. '
    'No matching assistido, o vendedor vê as propostas e escolhe a melhor. '
    'No matching automático (Sprint 2), o sistema escolhe por score e envia via Socket.IO. '
    'UNIQUE(request_id, service_id): um entregador só pode propor uma vez por pedido.';

CREATE INDEX IF NOT EXISTS idx_delivery_proposals_request_id
    ON public.delivery_proposals (request_id, status);

CREATE INDEX IF NOT EXISTS idx_delivery_proposals_service_id
    ON public.delivery_proposals (service_id, created_at DESC);


ALTER TABLE public.delivery_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "delivery_proposals_service_own" ON public.delivery_proposals;
CREATE POLICY "delivery_proposals_service_own"
    ON public.delivery_proposals
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid()::text)
    WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "delivery_proposals_seller_read" ON public.delivery_proposals;
CREATE POLICY "delivery_proposals_seller_read"
    ON public.delivery_proposals
    FOR SELECT
    TO authenticated
    USING (
        request_id IN (
            SELECT id FROM public.delivery_requests
            WHERE seller_id = get_my_seller_id()
        )
    );

DROP POLICY IF EXISTS "delivery_proposals_admin_all" ON public.delivery_proposals;
CREATE POLICY "delivery_proposals_admin_all"
    ON public.delivery_proposals
    FOR ALL
    TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

REVOKE ALL ON public.delivery_proposals FROM anon;


-- =====================================================
-- 5. delivery_notifications — fan-out de notificações
-- =====================================================

CREATE TABLE IF NOT EXISTS public.delivery_notifications (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    request_id              TEXT NOT NULL REFERENCES public.delivery_requests(id) ON DELETE CASCADE,
    service_id              TEXT NOT NULL REFERENCES public.delivery_services(id),
    user_id                 TEXT NOT NULL REFERENCES public.users(id),

    proposed_fee            NUMERIC(8, 2) NOT NULL,
    total_km                NUMERIC(8, 2) NOT NULL,
    match_score             NUMERIC(10, 4),   -- score no momento do matching (menor = melhor)

    notified_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at              TIMESTAMPTZ NOT NULL,  -- prazo para aceitar (5 min padrão)
    responded_at            TIMESTAMPTZ,
    response                TEXT CHECK (response IN ('accepted', 'declined', 'expired')),

    UNIQUE (request_id, service_id)
);

COMMENT ON TABLE public.delivery_notifications IS
    '[DELIVERY-001] Rastreia quais entregadores foram notificados de um pedido. '
    'Criado pelo deliveryService.notifyEligibleDeliverers() para cada candidato. '
    'Usado para: (a) timeout → marcar expirados, (b) audit de quem recusou/aceitou, '
    '(c) notificar os perdedores quando outro aceita. '
    'UNIQUE(request_id, service_id): um entregador é notificado uma vez por pedido por tentativa.';

CREATE INDEX IF NOT EXISTS idx_delivery_notif_request_id
    ON public.delivery_notifications (request_id, response);

CREATE INDEX IF NOT EXISTS idx_delivery_notif_expires
    ON public.delivery_notifications (expires_at)
    WHERE response IS NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_notif_user_id
    ON public.delivery_notifications (user_id, notified_at DESC);


-- Camada 1 — Server-Only (backend via service_role)
ALTER TABLE public.delivery_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "delivery_notifications_backend_only" ON public.delivery_notifications;
CREATE POLICY "delivery_notifications_backend_only"
    ON public.delivery_notifications
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

COMMENT ON POLICY "delivery_notifications_backend_only"
    ON public.delivery_notifications IS
    'Deny-all para anon/authenticated. Backend acessa via service_role (bypassa RLS). '
    'Entregador recebe notificações via Socket.IO — não precisa de acesso direto à tabela.';


-- =====================================================
-- 6. delivery_guarantee_fund — fundo de garantia imutável
-- =====================================================

CREATE TABLE IF NOT EXISTS public.delivery_guarantee_fund (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    request_id              TEXT NOT NULL REFERENCES public.delivery_requests(id),
    amount_brl              NUMERIC(8, 2) NOT NULL CHECK (amount_brl > 0),
    event_type              TEXT NOT NULL
                                CHECK (event_type IN ('collected', 'refunded', 'used')),
    refund_to               TEXT REFERENCES public.users(id),  -- null se event_type='collected'
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.delivery_guarantee_fund IS
    '[DELIVERY-001][RLS-3C-C1] Fundo de garantia das entregas — IMUTÁVEL. '
    '2% de cada entrega concluída → event_type=collected. '
    'Usado para reembolsos sem bloquear o entregador imediatamente → event_type=used. '
    'Reembolso ao comprador/vendedor prejudicado → event_type=refunded. '
    'Sem UPDATE/DELETE: é uma trilha financeira de auditoria (LGPD art. 37). '
    'Backend acessa via service_role; anon/authenticated bloqueados por RLS.';

CREATE INDEX IF NOT EXISTS idx_delivery_guarantee_request
    ON public.delivery_guarantee_fund (request_id, event_type);

CREATE INDEX IF NOT EXISTS idx_delivery_guarantee_created
    ON public.delivery_guarantee_fund (created_at DESC);


-- Camada 1 — Server-Only
ALTER TABLE public.delivery_guarantee_fund ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "delivery_guarantee_backend_only" ON public.delivery_guarantee_fund;
CREATE POLICY "delivery_guarantee_backend_only"
    ON public.delivery_guarantee_fund
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

COMMENT ON POLICY "delivery_guarantee_backend_only"
    ON public.delivery_guarantee_fund IS
    'Deny-all para anon/authenticated. Imutável por design — sem UPDATE/DELETE na aplicação.';


-- =====================================================
-- GRANTS — funções acessíveis ao role authenticated
-- =====================================================

GRANT EXECUTE ON FUNCTION public.get_my_delivery_service_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_delivery_request_party(TEXT) TO authenticated;


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar.
-- =====================================================

-- V1. Confirmar 6 tabelas criadas:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN (
--     'delivery_services','delivery_active_sessions','delivery_requests',
--     'delivery_proposals','delivery_notifications','delivery_guarantee_fund'
--   )
-- ORDER BY table_name;
-- Esperado: 6 linhas.

-- V2. RLS habilitado em todas:
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'delivery_services','delivery_active_sessions','delivery_requests',
--     'delivery_proposals','delivery_notifications','delivery_guarantee_fund'
--   )
-- ORDER BY tablename;
-- Esperado: 6 linhas, todas rowsecurity=true.

-- V3. Funções helper criadas:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'get_my_delivery_service_id','is_delivery_request_party','compute_region_key'
--   );
-- Esperado: 3 linhas.

-- V4. compute_region_key funcional:
-- SELECT public.compute_region_key(-23.5505, -46.6333);
-- Esperado: 'geo:-470:-933' (ou similar — grid de 0.05 graus)
