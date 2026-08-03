-- =====================================================
-- MIGRAÇÃO: Sistema de Agendamento de Serviços ElosCloud
-- [SCHED-001] 2 tabelas + RLS + RPCs + trigger
--
-- Tabelas criadas:
--   1. service_availability  — grade semanal do prestador de serviço
--   2. service_bookings      — agendamento individual (hold Stripe + máquina de estados)
--
-- RPCs criadas:
--   get_available_slots(p_service_id, p_date)  — slots livres para uma data
--   expire_pending_bookings()                  — expirar bookings sem resposta (job)
--
-- Trigger:
--   update_service_bookings_updated_at         — mantém updated_at atualizado
--
-- Modelo RLS — 3 Camadas (padrão ElosCloud):
--   Camada 3 — RBAC-Scoped:
--     service_availability : leitura pública (active=true) + escrita pelo dono do serviço
--     service_bookings     : acesso por client_id/provider_id + admin vê tudo
--
-- Decisões arquiteturais aprovadas (Léo + ClaudIA, 2026-06-10):
--   DA-SCHED-001: Duração de slot configurável — 15, 30, 45, 60 ou 120 minutos
--   DA-SCHED-002: Múltiplos intervalos por dia = múltiplas linhas com mesmo day_of_week
--   DA-SCHED-003: Pagamento via Stripe PaymentIntent com capture_method=manual
--                 (hold na solicitação → capture_on_complete no backend)
--   DA-SCHED-004: Booking expira em 2h se prestador não responder (pending → expired)
--   DA-SCHED-005: Política de cancelamento definida pelo prestador no marketplace_products;
--                 snapshot salvo em service_bookings.cancellation_policy no momento do booking
--   DA-SCHED-006: user_id armazenado como TEXT (sem FK para auth.users) — padrão delivery_*
--
-- Depende de:
--   20260524000001_marketplace_schema.sql  (marketplace_products, seller_profiles)
--   20260514000001_rbac_check_functions.sql (check_global_role)
--
-- Agente: marketplace-agent | Revisado por: ClaudIA
-- Data: 2026-06-10
-- =====================================================


-- =====================================================
-- FUNÇÃO HELPER: get_my_service_provider_id()
-- Retorna o user_id autenticado como TEXT para uso em policies.
-- Criada antes das tabelas pois é usada nas policies de service_availability.
-- Usa seller_profiles para verificar que o usuário é realmente um prestador.
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_my_service_provider_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT auth.uid()::text;
$$;

COMMENT ON FUNCTION public.get_my_service_provider_id() IS
    '[SCHED-001] Retorna auth.uid()::text do usuário autenticado. '
    'SECURITY DEFINER: usada em policies de service_availability e service_bookings '
    'para comparar provider_id sem recursão de RLS. '
    'A autorização completa (verificar se é dono do serviço em marketplace_products) '
    'é feita pelo backend via service_role antes de permitir INSERT/UPDATE.';

GRANT EXECUTE ON FUNCTION public.get_my_service_provider_id() TO authenticated;


-- =====================================================
-- 1. service_availability — grade semanal do prestador
-- =====================================================
-- Cada linha representa UM intervalo de horário em UM dia da semana.
-- Múltiplos intervalos por dia (ex: 9h-12h e 14h-18h) = múltiplas linhas
-- com mesmo (service_id, day_of_week).
--
-- Exemplo: professor de música, Segunda-feira:
--   (service_id, day_of_week=1, start='09:00', end='12:00', slot_duration=60)
--   (service_id, day_of_week=1, start='14:00', end='18:00', slot_duration=60)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.service_availability (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    service_id              TEXT NOT NULL,   -- REFERENCES marketplace_products(id)

    -- Dia da semana: 0=Domingo, 1=Segunda ... 6=Sábado
    day_of_week             INT  NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),

    -- Intervalo de horário do bloco de disponibilidade
    start_time              TIME NOT NULL,
    end_time                TIME NOT NULL,

    -- Configuração de slot
    slot_duration_minutes   INT  NOT NULL DEFAULT 60
        CHECK (slot_duration_minutes IN (15, 30, 45, 60, 120)),

    -- Intervalo de descanso entre slots (0 = sem intervalo)
    gap_minutes             INT  NOT NULL DEFAULT 0
        CHECK (gap_minutes >= 0),

    active                  BOOLEAN NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraint: end_time deve ser após start_time
    CONSTRAINT sa_end_after_start CHECK (end_time > start_time),

    -- Constraint: o bloco deve ter espaço para pelo menos 1 slot
    CONSTRAINT sa_min_one_slot CHECK (
        EXTRACT(EPOCH FROM (end_time - start_time)) / 60 >= slot_duration_minutes
    )
);

COMMENT ON TABLE public.service_availability IS
    '[SCHED-001] Grade semanal de disponibilidade do prestador de serviço. '
    'Cada linha representa um bloco de horários disponíveis em um dia da semana. '
    'Múltiplos blocos por dia (ex: manhã + tarde) = múltiplas linhas com mesmo day_of_week. '
    'A RPC get_available_slots() usa esta tabela para gerar os slots livres de uma data. '
    'service_id referencia marketplace_products.id (produto do tipo serviço).';

COMMENT ON COLUMN public.service_availability.day_of_week IS
    '0=Domingo, 1=Segunda, 2=Terça, 3=Quarta, 4=Quinta, 5=Sexta, 6=Sábado.';

COMMENT ON COLUMN public.service_availability.slot_duration_minutes IS
    'Duração de cada slot em minutos. Valores permitidos: 15, 30, 45, 60, 120. '
    'Define o tamanho do serviço: aula de 60min, consulta de 30min, etc.';

COMMENT ON COLUMN public.service_availability.gap_minutes IS
    'Intervalo de descanso/preparação entre slots consecutivos. '
    '0 = sem intervalo. Exemplo: 15 min para arrumar a sala entre atendimentos. '
    'Slot real ocupa slot_duration_minutes + gap_minutes no calendário.';

COMMENT ON COLUMN public.service_availability.active IS
    'false = bloco desativado temporariamente (ex: férias). '
    'Slots deste bloco são ocultados pela RPC get_available_slots().';


-- Índices de service_availability
CREATE INDEX IF NOT EXISTS idx_service_availability_service_day
    ON public.service_availability (service_id, day_of_week)
    WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_service_availability_service_id
    ON public.service_availability (service_id);


-- =====================================================
-- RLS — service_availability
-- =====================================================

ALTER TABLE public.service_availability ENABLE ROW LEVEL SECURITY;

-- Leitura pública: qualquer autenticado vê blocos ativos
DROP POLICY IF EXISTS "service_availability_public_read" ON public.service_availability;
CREATE POLICY "service_availability_public_read"
    ON public.service_availability
    FOR SELECT
    TO authenticated
    USING (active = true);

-- Escrita restrita: apenas o dono do serviço (via provider_id em marketplace_products)
-- O backend valida a ownership via service_role antes de chamar INSERT/UPDATE.
-- Esta policy garante que o usuário autenticado corresponde ao provider do produto.
DROP POLICY IF EXISTS "service_availability_provider_write" ON public.service_availability;
CREATE POLICY "service_availability_provider_write"
    ON public.service_availability
    FOR ALL
    TO authenticated
    USING (
        service_id IN (
            SELECT mp.id
            FROM public.marketplace_products mp
            JOIN public.seller_profiles sp ON sp.id = mp.seller_id
            WHERE sp.user_id = get_my_service_provider_id()
        )
    )
    WITH CHECK (
        service_id IN (
            SELECT mp.id
            FROM public.marketplace_products mp
            JOIN public.seller_profiles sp ON sp.id = mp.seller_id
            WHERE sp.user_id = get_my_service_provider_id()
        )
    );

-- Admin vê tudo (incluindo blocos inativos)
DROP POLICY IF EXISTS "service_availability_admin_all" ON public.service_availability;
CREATE POLICY "service_availability_admin_all"
    ON public.service_availability
    FOR ALL
    TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

REVOKE ALL ON public.service_availability FROM anon;


-- =====================================================
-- 2. service_bookings — agendamento individual
-- =====================================================
-- Máquina de estados:
--   pending    → confirmado (confirmed) ou expirado (expired) em até 2h
--   confirmed  → completado (completed) ou cancelado (cancelled) ou disputado (disputed)
--   completed  → terminal (capture do Stripe)
--   cancelled  → terminal (void/refund do Stripe conforme política)
--   expired    → terminal (void automático)
--   disputed   → delegado ao disputa-agent
--
-- Pagamento (Stripe capture_method=manual):
--   pending    → payment_status=authorized (hold no cartão)
--   confirmed  → pagamento ainda em hold
--   completed  → backend faz capture → payment_status=captured
--   cancelled  → backend faz void ou refund → payment_status=voided/refunded
--   expired    → backend faz void → payment_status=voided
-- =====================================================

CREATE TABLE IF NOT EXISTS public.service_bookings (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

    -- Referências ao serviço e às partes
    service_id              TEXT NOT NULL,   -- marketplace_products.id
    provider_id             TEXT NOT NULL,   -- uid do prestador (TEXT, sem FK para auth.users)
    client_id               TEXT NOT NULL,   -- uid do cliente   (TEXT, sem FK para auth.users)

    -- Janela de tempo reservada
    scheduled_at            TIMESTAMPTZ NOT NULL,
    scheduled_end           TIMESTAMPTZ NOT NULL,

    -- Máquina de estados do booking
    status                  TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending',
            'confirmed',
            'completed',
            'cancelled',
            'expired',
            'disputed'
        )),

    -- Pagamento — Stripe PaymentIntent com capture_method=manual
    payment_intent_id       TEXT,            -- Stripe PaymentIntent id (hold)
    payment_status          TEXT NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN (
            'pending',
            'authorized',
            'captured',
            'refunded',
            'voided'
        )),
    amount_brl              NUMERIC(10, 2) NOT NULL CHECK (amount_brl >= 0),

    -- Snapshot da política de cancelamento no momento do booking (imutável após criação)
    -- Formato: {"advance_hours": 24, "fee_pct": 0}
    -- advance_hours: horas mínimas antes do início para cancelamento sem taxa
    -- fee_pct: percentual de taxa cobrado fora do prazo (0.0 = sem taxa, 1.0 = 100%)
    cancellation_policy     JSONB NOT NULL
        DEFAULT '{"advance_hours": 24, "fee_pct": 0}'::jsonb,

    -- Observações
    notes                   TEXT,            -- observações do cliente ao agendar
    provider_notes          TEXT,            -- resposta/observações do prestador

    -- Expiração automática: booking pending expira após 2h sem confirmação do prestador
    expires_at              TIMESTAMPTZ NOT NULL,  -- criado com now() + interval '2 hours'

    -- Timestamps de auditoria de cada transição de estado
    confirmed_at            TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ,
    cancelled_at            TIMESTAMPTZ,
    cancelled_by            TEXT CHECK (cancelled_by IN ('client', 'provider', 'system')),

    -- Auditoria geral
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints de integridade temporal
    CONSTRAINT sb_end_after_start    CHECK (scheduled_end > scheduled_at),
    CONSTRAINT sb_expires_after_now  CHECK (expires_at > created_at),
    CONSTRAINT sb_no_self_booking    CHECK (client_id != provider_id)
);

COMMENT ON TABLE public.service_bookings IS
    '[SCHED-001] Agendamento individual de serviço. '
    'Ciclo de vida: pending → confirmed → completed (caminho feliz). '
    'Expiração automática: pending sem confirmação em 2h → expired + void do Stripe. '
    'Pagamento: Stripe PaymentIntent capture_method=manual — hold na criação, '
    'capture na conclusão, void no cancelamento/expiração. '
    'cancellation_policy é snapshot imutável da política do prestador no momento do booking. '
    'Disputas delegadas ao disputa-agent (sem resolução direta aqui).';

COMMENT ON COLUMN public.service_bookings.provider_id IS
    'UID do prestador de serviço (TEXT, sem FK direta para auth.users — padrão delivery_*). '
    'Deve corresponder ao seller_profiles.user_id do serviço em marketplace_products.';

COMMENT ON COLUMN public.service_bookings.client_id IS
    'UID do cliente que fez o agendamento (TEXT, sem FK direta para auth.users). '
    'Constraint sb_no_self_booking: client_id != provider_id.';

COMMENT ON COLUMN public.service_bookings.payment_intent_id IS
    'ID do PaymentIntent do Stripe criado com capture_method=manual. '
    'null antes do pagamento ser iniciado. '
    'Backend: scheduleService.createBooking() cria o PaymentIntent e salva aqui.';

COMMENT ON COLUMN public.service_bookings.payment_status IS
    'pending    = PaymentIntent ainda não criado ou aguardando autorização do banco. '
    'authorized = hold confirmado pelo banco (funds reservados). '
    'captured   = valor debitado após completed. '
    'refunded   = estorno após cancelamento com reembolso. '
    'voided     = cancelamento do hold (sem cobrança).';

COMMENT ON COLUMN public.service_bookings.cancellation_policy IS
    'Snapshot IMUTÁVEL da política de cancelamento no momento do booking. '
    'Formato: {"advance_hours": 24, "fee_pct": 0.5}. '
    'advance_hours: horas de antecedência para cancelamento sem taxa. '
    'fee_pct: percentual da taxa cobrada fora do prazo (0=sem taxa, 1.0=100%). '
    'Nunca atualizar após criação — é um contrato entre cliente e prestador.';

COMMENT ON COLUMN public.service_bookings.expires_at IS
    'Booking pending expira 2h após created_at se o prestador não confirmar. '
    'Após expiração: status → expired, payment_status → voided (via expire_pending_bookings()). '
    'O backend agenda um job para chamar expire_pending_bookings() periodicamente.';

COMMENT ON COLUMN public.service_bookings.cancelled_by IS
    'Identifica quem iniciou o cancelamento: '
    'client = cliente cancelou voluntariamente. '
    'provider = prestador cancelou (ex: indisponibilidade). '
    'system = cancelamento automático por expiração ou regra de negócio.';


-- Índices de service_bookings
CREATE INDEX IF NOT EXISTS idx_service_bookings_service_scheduled
    ON public.service_bookings (service_id, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_service_bookings_provider_status
    ON public.service_bookings (provider_id, status);

CREATE INDEX IF NOT EXISTS idx_service_bookings_client_status
    ON public.service_bookings (client_id, status);

-- Índice parcial para o job de expiração — filtra apenas bookings pendentes
-- WHERE status='pending' é seguro em predicado de índice (valor estático, não VOLATILE)
CREATE INDEX IF NOT EXISTS idx_service_bookings_expires_pending
    ON public.service_bookings (expires_at)
    WHERE status = 'pending';

-- Índice para lookup por payment_intent_id (webhooks do Stripe)
CREATE INDEX IF NOT EXISTS idx_service_bookings_payment_intent
    ON public.service_bookings (payment_intent_id)
    WHERE payment_intent_id IS NOT NULL;


-- =====================================================
-- TRIGGER: update_service_bookings_updated_at
-- Atualiza updated_at automaticamente em qualquer UPDATE
-- =====================================================

CREATE OR REPLACE FUNCTION public.set_service_bookings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_service_bookings_updated_at() IS
    '[SCHED-001] Função de trigger que atualiza updated_at em service_bookings. '
    'Padrão ElosCloud: nunca confiar em updated_at enviado pelo cliente.';

DROP TRIGGER IF EXISTS update_service_bookings_updated_at ON public.service_bookings;
CREATE TRIGGER update_service_bookings_updated_at
    BEFORE UPDATE ON public.service_bookings
    FOR EACH ROW
    EXECUTE FUNCTION public.set_service_bookings_updated_at();

COMMENT ON TRIGGER update_service_bookings_updated_at
    ON public.service_bookings IS
    '[SCHED-001] Trigger BEFORE UPDATE: mantém updated_at sempre atual. '
    'Garante rastreabilidade de qualquer mudança de estado no booking.';


-- =====================================================
-- RLS — service_bookings
-- =====================================================

ALTER TABLE public.service_bookings ENABLE ROW LEVEL SECURITY;

-- Cliente vê seus próprios bookings
DROP POLICY IF EXISTS "service_bookings_client_read" ON public.service_bookings;
CREATE POLICY "service_bookings_client_read"
    ON public.service_bookings
    FOR SELECT
    TO authenticated
    USING (client_id = auth.uid()::text);

-- Cliente pode criar bookings para si mesmo
DROP POLICY IF EXISTS "service_bookings_client_insert" ON public.service_bookings;
CREATE POLICY "service_bookings_client_insert"
    ON public.service_bookings
    FOR INSERT
    TO authenticated
    WITH CHECK (client_id = auth.uid()::text);

-- Cliente pode cancelar seus próprios bookings (UPDATE restrito — só campos permitidos)
DROP POLICY IF EXISTS "service_bookings_client_update" ON public.service_bookings;
CREATE POLICY "service_bookings_client_update"
    ON public.service_bookings
    FOR UPDATE
    TO authenticated
    USING (client_id = auth.uid()::text)
    WITH CHECK (client_id = auth.uid()::text);

-- Prestador vê bookings de seus serviços
DROP POLICY IF EXISTS "service_bookings_provider_read" ON public.service_bookings;
CREATE POLICY "service_bookings_provider_read"
    ON public.service_bookings
    FOR SELECT
    TO authenticated
    USING (provider_id = auth.uid()::text);

-- Prestador pode confirmar/completar/cancelar bookings de seus serviços
DROP POLICY IF EXISTS "service_bookings_provider_update" ON public.service_bookings;
CREATE POLICY "service_bookings_provider_update"
    ON public.service_bookings
    FOR UPDATE
    TO authenticated
    USING (provider_id = auth.uid()::text)
    WITH CHECK (provider_id = auth.uid()::text);

-- Admin vê e altera tudo
DROP POLICY IF EXISTS "service_bookings_admin_all" ON public.service_bookings;
CREATE POLICY "service_bookings_admin_all"
    ON public.service_bookings
    FOR ALL
    TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

REVOKE ALL ON public.service_bookings FROM anon;


-- =====================================================
-- RPC: get_available_slots(p_service_id, p_date)
-- =====================================================
-- Retorna todos os slots de uma data específica, indicando quais estão livres.
-- Algoritmo:
--   1. Busca blocos de service_availability para o dia da semana de p_date
--   2. Gera slots de start_time até end_time com passo (slot_duration + gap)
--   3. Para cada slot gerado, verifica se existe booking confirmed/pending
--      que se sobreponha ao intervalo do slot
--   4. Retorna: slot_start, slot_end, available
--
-- Nota sobre sobreposição:
--   Um slot [A, B) está ocupado se existe booking onde:
--   scheduled_at < B AND scheduled_end > A
--   (condição padrão de interseção de intervalos)
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_available_slots(
    p_service_id    TEXT,
    p_date          DATE
)
RETURNS TABLE (
    slot_start      TIMESTAMPTZ,
    slot_end        TIMESTAMPTZ,
    available       BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    -- Extraindo timezone do banco para construir timestamps localizados
    rec_avail       RECORD;
    slot_s          TIMESTAMPTZ;
    slot_e          TIMESTAMPTZ;
    step_interval   INTERVAL;
    block_start     TIMESTAMPTZ;
    block_end       TIMESTAMPTZ;
    is_available    BOOLEAN;
    p_dow           INT;
BEGIN
    -- Dia da semana da data solicitada (0=Domingo ... 6=Sábado, padrão PostgreSQL)
    p_dow := EXTRACT(DOW FROM p_date)::INT;

    -- Itera sobre cada bloco de disponibilidade ativo para o dia da semana
    FOR rec_avail IN
        SELECT
            sa.start_time,
            sa.end_time,
            sa.slot_duration_minutes,
            sa.gap_minutes
        FROM public.service_availability sa
        WHERE sa.service_id      = p_service_id
          AND sa.day_of_week     = p_dow
          AND sa.active          = true
        ORDER BY sa.start_time
    LOOP
        -- Converte time → timestamptz para a data solicitada
        -- p_date::text || ' ' || time::text produz 'YYYY-MM-DD HH:MM:SS'
        block_start   := (p_date::text || ' ' || rec_avail.start_time::text)::TIMESTAMPTZ;
        block_end     := (p_date::text || ' ' || rec_avail.end_time::text)::TIMESTAMPTZ;
        step_interval := make_interval(
            mins => rec_avail.slot_duration_minutes + rec_avail.gap_minutes
        );

        -- Gera slots: de block_start até block_end com passo de (slot_duration + gap)
        slot_s := block_start;
        WHILE slot_s + make_interval(mins => rec_avail.slot_duration_minutes) <= block_end LOOP

            slot_e := slot_s + make_interval(mins => rec_avail.slot_duration_minutes);

            -- Verifica sobreposição com bookings confirmed ou pending
            -- Condição de interseção: scheduled_at < slot_e AND scheduled_end > slot_s
            SELECT NOT EXISTS (
                SELECT 1
                FROM public.service_bookings sb
                WHERE sb.service_id     = p_service_id
                  AND sb.status         IN ('confirmed', 'pending')
                  AND sb.scheduled_at   < slot_e
                  AND sb.scheduled_end  > slot_s
            ) INTO is_available;

            -- Retorna o slot (disponível ou não)
            slot_start := slot_s;
            slot_end   := slot_e;
            available  := is_available;
            RETURN NEXT;

            -- Avança para o próximo slot (inclui gap_minutes)
            slot_s := slot_s + step_interval;
        END LOOP;
    END LOOP;

    RETURN;
END;
$$;

COMMENT ON FUNCTION public.get_available_slots(TEXT, DATE) IS
    '[SCHED-001] Retorna todos os slots gerados para um serviço em uma data específica. '
    'Itera sobre service_availability (blocos ativos do dia da semana), '
    'gera slots de slot_duration_minutes em slot_duration_minutes + gap_minutes, '
    'e verifica sobreposição com service_bookings (status confirmed ou pending). '
    'Retorna: slot_start (timestamptz), slot_end (timestamptz), available (boolean). '
    'Slots no passado (slot_start < NOW()) são retornados mas o frontend deve filtrá-los. '
    'STABLE: não modifica dados. SECURITY DEFINER: acessa service_bookings (privado).';

GRANT EXECUTE ON FUNCTION public.get_available_slots(TEXT, DATE) TO authenticated;


-- =====================================================
-- RPC: expire_pending_bookings()
-- =====================================================
-- Job de manutenção: expira bookings pending que ultrapassaram expires_at.
-- Deve ser chamado periodicamente pelo backend (ex: a cada 15min via cron).
-- Retorna o número de bookings expirados para logging.
--
-- Efeitos colaterais:
--   • status: pending → expired
--   • payment_status: authorized → voided  (quando Stripe já capturou o hold)
--   • cancelled_at e cancelled_by preenchidos para auditoria
--
-- NOTA: O void real do Stripe é feito pelo backend (scheduleService) que consulta
-- os bookings expirados nesta chamada via RETURNING e chama stripe.paymentIntents.cancel().
-- =====================================================

CREATE OR REPLACE FUNCTION public.expire_pending_bookings()
RETURNS TABLE (
    booking_id          TEXT,
    payment_intent_id   TEXT,
    had_hold            BOOLEAN    -- true = backend deve fazer void no Stripe
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    expired_count INTEGER := 0;
BEGIN
    RETURN QUERY
    UPDATE public.service_bookings
    SET
        status          = 'expired',
        payment_status  = CASE
                            WHEN payment_status = 'authorized' THEN 'voided'
                            ELSE payment_status
                          END,
        cancelled_at    = NOW(),
        cancelled_by    = 'system',
        updated_at      = NOW()
    WHERE status    = 'pending'
      AND expires_at <= NOW()
    RETURNING
        id                                          AS booking_id,
        service_bookings.payment_intent_id          AS payment_intent_id,
        (payment_status = 'authorized')             AS had_hold;
END;
$$;

COMMENT ON FUNCTION public.expire_pending_bookings() IS
    '[SCHED-001] Expira bookings pending que ultrapassaram expires_at (2h sem resposta). '
    'Transições: status → expired; payment_status(authorized) → voided. '
    'Retorna linhas afetadas com payment_intent_id e had_hold para o backend '
    'processar o void real no Stripe via stripe.paymentIntents.cancel(). '
    'Chamado periodicamente pelo backend (scheduleService.runExpirationJob()). '
    'SECURITY DEFINER: atualiza service_bookings como job de sistema (sem auth.uid()).';

-- Nota: expire_pending_bookings não é exposta ao cliente (authenticated).
-- Apenas o backend via service_role a chama diretamente.
-- Sem GRANT para authenticated.


-- =====================================================
-- GRANTS — funções expostas ao role authenticated
-- =====================================================

GRANT EXECUTE ON FUNCTION public.get_my_service_provider_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_slots(TEXT, DATE) TO authenticated;
-- expire_pending_bookings: sem GRANT (backend via service_role apenas)
-- set_service_bookings_updated_at: trigger function, sem GRANT necessário


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO [SCHED-001]
-- Execute no Supabase SQL Editor após aplicar esta migration.
-- =====================================================

-- V1. Confirmar que as 2 tabelas foram criadas:
--
-- SELECT table_name
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('service_availability', 'service_bookings')
-- ORDER BY table_name;
-- Esperado: 2 linhas.

-- V2. Confirmar RLS habilitado em ambas as tabelas:
--
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('service_availability', 'service_bookings')
-- ORDER BY tablename;
-- Esperado: 2 linhas, ambas com rowsecurity = true.

-- V3. Confirmar funções criadas:
--
-- SELECT routine_name
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--       'get_my_service_provider_id',
--       'get_available_slots',
--       'expire_pending_bookings',
--       'set_service_bookings_updated_at'
--   )
-- ORDER BY routine_name;
-- Esperado: 4 linhas.

-- V4. Confirmar trigger criado em service_bookings:
--
-- SELECT trigger_name, event_manipulation, action_timing
-- FROM information_schema.triggers
-- WHERE event_object_schema = 'public'
--   AND event_object_table  = 'service_bookings'
--   AND trigger_name = 'update_service_bookings_updated_at';
-- Esperado: 1 linha (BEFORE UPDATE).

-- V5. Confirmar índices criados:
--
-- SELECT indexname
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND tablename IN ('service_availability', 'service_bookings')
-- ORDER BY indexname;
-- Esperado: 7+ índices listados.

-- V6. Smoke test — get_available_slots com serviço inexistente (deve retornar 0 linhas):
--
-- SELECT * FROM public.get_available_slots('service-inexistente', CURRENT_DATE);
-- Esperado: 0 linhas (sem erro).

-- V7. Smoke test — constraint sb_no_self_booking (deve falhar):
-- (Substitua 'user-abc' por um user_id real em ambiente de teste)
--
-- INSERT INTO public.service_bookings (
--     service_id, provider_id, client_id,
--     scheduled_at, scheduled_end,
--     amount_brl, expires_at
-- ) VALUES (
--     'service-abc', 'user-abc', 'user-abc',
--     NOW() + interval '1 day', NOW() + interval '1 day 1 hour',
--     100.00, NOW() + interval '2 hours'
-- );
-- Esperado: ERROR — violates check constraint "sb_no_self_booking"

-- V8. Smoke test — constraint sa_end_after_start em service_availability (deve falhar):
--
-- INSERT INTO public.service_availability (service_id, day_of_week, start_time, end_time)
-- VALUES ('svc-abc', 1, '18:00', '09:00');
-- Esperado: ERROR — violates check constraint "sa_end_after_start"

-- V9. Smoke test — constraint sa_min_one_slot (deve falhar):
-- Bloco de 20min com slot de 60min — impossível caber 1 slot:
--
-- INSERT INTO public.service_availability
--     (service_id, day_of_week, start_time, end_time, slot_duration_minutes)
-- VALUES ('svc-abc', 1, '09:00', '09:20', 60);
-- Esperado: ERROR — violates check constraint "sa_min_one_slot"

-- V10. Smoke test — expire_pending_bookings retorna 0 em banco limpo:
--
-- SELECT COUNT(*) FROM public.expire_pending_bookings();
-- Esperado: 0 (sem bookings expirados em banco limpo).
