-- ============================================================
-- SCHED-CAP-001: Capacidade por Slot (Tickets por Slot)
-- Adiciona suporte a servicos coletivos (N bookings por slot)
--
-- Alteracoes:
--   1. service_availability  + max_capacity (INT, default 1)
--   2. marketplace_products  + service_mode, min_capacity, booking_deadline_hours
--   3. service_bookings      + booking_type (confirmed | pre_reserved)
--   4. get_available_slots() reescrita com contagem de vagas
--
-- Backward compatible: defaults preservam comportamento individual (1 vaga).
-- Depende de:
--   20260610000011_service_scheduling.sql
--   20260723000001_team_member_availability.sql
--
-- Agente: infra-agent
-- Data: 2026-08-02
-- ============================================================


-- ============================================================
-- 1. ALTER service_availability — max_capacity
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'service_availability'
          AND column_name  = 'max_capacity'
    ) THEN
        ALTER TABLE public.service_availability
            ADD COLUMN max_capacity INT NOT NULL DEFAULT 1;
    END IF;
END $$;

-- Dropar constraint auto-gerado (legado) + sanitizar
ALTER TABLE public.service_availability
    DROP CONSTRAINT IF EXISTS service_availability_max_capacity_check;

UPDATE public.service_availability
    SET max_capacity = 1
    WHERE max_capacity IS NULL OR max_capacity < 1 OR max_capacity > 500;

ALTER TABLE public.service_availability
    DROP CONSTRAINT IF EXISTS chk_sa_max_capacity;

ALTER TABLE public.service_availability
    ADD CONSTRAINT chk_sa_max_capacity
    CHECK (max_capacity >= 1 AND max_capacity <= 500);

COMMENT ON COLUMN public.service_availability.max_capacity IS
    '[SCHED-CAP-001] Capacidade maxima de bookings simultaneos neste slot. '
    'Default 1 = servico individual (backward compatible). '
    'Valores > 1 = servico coletivo (aula em grupo, evento, etc). '
    'Limite superior: 500 (suficiente para eventos grandes).';


-- ============================================================
-- 2. ALTER marketplace_products — service_mode, min_capacity, booking_deadline_hours
-- ============================================================

-- 2a. service_mode
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'marketplace_products'
          AND column_name  = 'service_mode'
    ) THEN
        ALTER TABLE public.marketplace_products
            ADD COLUMN service_mode TEXT NOT NULL DEFAULT 'individual';
    END IF;
END $$;

-- Dropar constraints pré-existentes (auto-gerados ou legado) antes de sanitizar
ALTER TABLE public.marketplace_products
    DROP CONSTRAINT IF EXISTS marketplace_products_service_mode_check;

-- Sanitizar linhas existentes antes do constraint
UPDATE public.marketplace_products
    SET service_mode = 'individual'
    WHERE service_mode IS NULL OR service_mode NOT IN ('individual', 'group');

ALTER TABLE public.marketplace_products
    DROP CONSTRAINT IF EXISTS chk_mp_service_mode;

ALTER TABLE public.marketplace_products
    ADD CONSTRAINT chk_mp_service_mode
    CHECK (service_mode IN ('individual', 'group'));

COMMENT ON COLUMN public.marketplace_products.service_mode IS
    '[SCHED-CAP-001] Modo de atendimento do servico. '
    'individual = 1 cliente por slot (padrao, backward compatible). '
    'group = multiplos clientes por slot (aula em grupo, oficina, evento).';

-- 2b. min_capacity
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'marketplace_products'
          AND column_name  = 'min_capacity'
    ) THEN
        ALTER TABLE public.marketplace_products
            ADD COLUMN min_capacity INT NOT NULL DEFAULT 1;
    END IF;
END $$;

ALTER TABLE public.marketplace_products
    DROP CONSTRAINT IF EXISTS marketplace_products_min_capacity_check;

UPDATE public.marketplace_products
    SET min_capacity = 1
    WHERE min_capacity IS NULL OR min_capacity < 1;

ALTER TABLE public.marketplace_products
    DROP CONSTRAINT IF EXISTS chk_mp_min_capacity;

ALTER TABLE public.marketplace_products
    ADD CONSTRAINT chk_mp_min_capacity
    CHECK (min_capacity >= 1);

COMMENT ON COLUMN public.marketplace_products.min_capacity IS
    '[SCHED-CAP-001] Numero minimo de participantes para o servico acontecer. '
    'Default 1 = sem minimo (sempre ocorre). '
    'Usado em servicos coletivos: se nao atingir min_capacity ate o deadline, '
    'o prestador pode cancelar ou o sistema pode notificar pre-reservados.';

-- 2c. booking_deadline_hours
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'marketplace_products'
          AND column_name  = 'booking_deadline_hours'
    ) THEN
        ALTER TABLE public.marketplace_products
            ADD COLUMN booking_deadline_hours INT NOT NULL DEFAULT 24;
    END IF;
END $$;

ALTER TABLE public.marketplace_products
    DROP CONSTRAINT IF EXISTS marketplace_products_booking_deadline_hours_check;

UPDATE public.marketplace_products
    SET booking_deadline_hours = 24
    WHERE booking_deadline_hours IS NULL OR booking_deadline_hours < 1 OR booking_deadline_hours > 168;

ALTER TABLE public.marketplace_products
    DROP CONSTRAINT IF EXISTS chk_mp_deadline;

ALTER TABLE public.marketplace_products
    ADD CONSTRAINT chk_mp_deadline
    CHECK (booking_deadline_hours >= 1 AND booking_deadline_hours <= 168);

COMMENT ON COLUMN public.marketplace_products.booking_deadline_hours IS
    '[SCHED-CAP-001] Horas antes do slot em que a reserva fecha. '
    'Default 24 = reservas fecham 24h antes do horario. '
    'Maximo 168h (7 dias). Usado para determinar o momento de corte: '
    'pre_reserved que nao atingiram min_capacity sao avaliados neste prazo.';


-- ============================================================
-- 3. ALTER service_bookings — booking_type
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'service_bookings'
          AND column_name  = 'booking_type'
    ) THEN
        ALTER TABLE public.service_bookings
            ADD COLUMN booking_type TEXT NOT NULL DEFAULT 'confirmed';
    END IF;
END $$;

ALTER TABLE public.service_bookings
    DROP CONSTRAINT IF EXISTS service_bookings_booking_type_check;

UPDATE public.service_bookings
    SET booking_type = 'confirmed'
    WHERE booking_type IS NULL OR booking_type NOT IN ('confirmed', 'pre_reserved');

ALTER TABLE public.service_bookings
    DROP CONSTRAINT IF EXISTS chk_sb_booking_type;

ALTER TABLE public.service_bookings
    ADD CONSTRAINT chk_sb_booking_type
    CHECK (booking_type IN ('confirmed', 'pre_reserved'));

COMMENT ON COLUMN public.service_bookings.booking_type IS
    '[SCHED-CAP-001] Tipo de reserva. '
    'confirmed = reserva firme (servico individual ou grupo ja confirmado). '
    'pre_reserved = pre-reserva aguardando min_capacity ser atingida. '
    'Default confirmed: backward compatible com bookings individuais existentes.';

-- Index parcial para queries de pre-reserva por servico
CREATE INDEX IF NOT EXISTS idx_service_bookings_prereserved
    ON public.service_bookings (service_id, scheduled_at)
    WHERE booking_type = 'pre_reserved';


-- ============================================================
-- 4. REPLACE RPC get_available_slots — contagem de vagas
-- ============================================================
-- DROP necessario: PostgreSQL nao permite alterar RETURNS TABLE via CREATE OR REPLACE
-- A assinatura anterior retornava (slot_start, slot_end, available, assigned_member_id).
-- A nova retorna (slot_start, slot_end, max_capacity, booked_count, available_seats, available, assigned_member_id).
-- ============================================================

DROP FUNCTION IF EXISTS public.get_available_slots(TEXT, DATE);

CREATE OR REPLACE FUNCTION public.get_available_slots(
    p_service_id    TEXT,
    p_date          DATE
)
RETURNS TABLE (
    slot_start           TIMESTAMPTZ,
    slot_end             TIMESTAMPTZ,
    max_capacity         INT,
    booked_count         INT,
    available_seats      INT,
    available            BOOLEAN,
    assigned_member_id   TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    rec_avail       RECORD;
    slot_s          TIMESTAMPTZ;
    slot_e          TIMESTAMPTZ;
    step_interval   INTERVAL;
    block_start     TIMESTAMPTZ;
    block_end       TIMESTAMPTZ;
    v_booked        INT;
    v_max_cap       INT;
    p_dow           INT;
BEGIN
    -- Dia da semana da data solicitada (0=Domingo ... 6=Sabado, padrao PostgreSQL)
    p_dow := EXTRACT(DOW FROM p_date)::INT;

    -- Itera sobre cada bloco de disponibilidade ativo para o dia da semana
    FOR rec_avail IN
        SELECT
            sa.start_time,
            sa.end_time,
            sa.slot_duration_minutes,
            sa.gap_minutes,
            sa.max_capacity       AS sa_max_capacity,
            sa.assigned_member_id AS sa_assigned_member_id
        FROM public.service_availability sa
        WHERE sa.service_id  = p_service_id
          AND sa.day_of_week = p_dow
          AND sa.active      = true
        ORDER BY sa.start_time
    LOOP
        -- Converte time -> timestamptz interpretando como America/Sao_Paulo
        block_start := (p_date::text || ' ' || rec_avail.start_time::text)::TIMESTAMP
                           AT TIME ZONE 'America/Sao_Paulo';

        block_end   := (p_date::text || ' ' || rec_avail.end_time::text)::TIMESTAMP
                           AT TIME ZONE 'America/Sao_Paulo';

        step_interval := make_interval(
            mins => rec_avail.slot_duration_minutes + rec_avail.gap_minutes
        );

        v_max_cap := rec_avail.sa_max_capacity;

        -- Gera slots: de block_start ate block_end com passo de (slot_duration + gap)
        slot_s := block_start;
        WHILE slot_s + make_interval(mins => rec_avail.slot_duration_minutes) <= block_end LOOP

            slot_e := slot_s + make_interval(mins => rec_avail.slot_duration_minutes);

            -- Conta bookings ativos (pending, confirmed, pre_reserved) para este slot
            SELECT COUNT(*)::INT INTO v_booked
            FROM public.service_bookings sb
            WHERE sb.service_id    = p_service_id
              AND sb.scheduled_at  = slot_s
              AND sb.status        IN ('pending', 'confirmed', 'pre_reserved');

            -- Monta retorno
            slot_start          := slot_s;
            slot_end            := slot_e;
            max_capacity        := v_max_cap;
            booked_count        := v_booked;
            available_seats     := v_max_cap - v_booked;
            available           := (v_max_cap - v_booked) > 0;
            assigned_member_id  := rec_avail.sa_assigned_member_id;
            RETURN NEXT;

            -- Avanca para o proximo slot (inclui gap_minutes)
            slot_s := slot_s + step_interval;
        END LOOP;
    END LOOP;

    RETURN;
END;
$$;

COMMENT ON FUNCTION public.get_available_slots(TEXT, DATE) IS
    '[SCHED-CAP-001] Retorna slots com contagem de vagas para um servico em uma data. '
    'max_capacity vem de service_availability (default 1 = individual). '
    'booked_count = bookings com status pending/confirmed/pre_reserved no slot. '
    'available_seats = max_capacity - booked_count. '
    'available = true quando available_seats > 0. '
    'Horarios interpretados como America/Sao_Paulo. '
    'Inclui assigned_member_id do bloco de disponibilidade (SCHED-TEAM). '
    'STABLE: nao modifica dados. SECURITY DEFINER: acessa service_bookings (privado).';

GRANT EXECUTE ON FUNCTION public.get_available_slots(TEXT, DATE) TO authenticated;


-- ============================================================
-- BLOCO DE VERIFICACAO POS-MIGRACAO [SCHED-CAP-001]
-- Execute no Supabase SQL Editor apos aplicar esta migration.
-- ============================================================

-- V1. Confirmar coluna max_capacity em service_availability:
--
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name   = 'service_availability'
--   AND column_name  = 'max_capacity';
-- Esperado: 1 linha, integer, default 1, NOT NULL.

-- V2. Confirmar colunas em marketplace_products:
--
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name   = 'marketplace_products'
--   AND column_name  IN ('service_mode', 'min_capacity', 'booking_deadline_hours')
-- ORDER BY column_name;
-- Esperado: 3 linhas.

-- V3. Confirmar coluna booking_type em service_bookings:
--
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name   = 'service_bookings'
--   AND column_name  = 'booking_type';
-- Esperado: 1 linha, text, default 'confirmed'.

-- V4. Confirmar constraint chk_sa_max_capacity (deve falhar com 0):
--
-- INSERT INTO public.service_availability
--     (service_id, day_of_week, start_time, end_time, max_capacity)
-- VALUES ('svc-test', 1, '09:00', '18:00', 0);
-- Esperado: ERROR — violates check constraint "chk_sa_max_capacity"

-- V5. Confirmar constraint chk_mp_service_mode (deve falhar com valor invalido):
--
-- UPDATE public.marketplace_products
--   SET service_mode = 'hybrid'
-- WHERE id = (SELECT id FROM public.marketplace_products LIMIT 1);
-- Esperado: ERROR — violates check constraint "chk_mp_service_mode"

-- V6. Confirmar constraint chk_sb_booking_type (deve falhar com valor invalido):
--
-- UPDATE public.service_bookings
--   SET booking_type = 'tentative'
-- WHERE id = (SELECT id FROM public.service_bookings LIMIT 1);
-- Esperado: ERROR — violates check constraint "chk_sb_booking_type"

-- V7. Smoke test — get_available_slots retorna colunas novas:
--
-- SELECT slot_start, slot_end, max_capacity, booked_count, available_seats, available, assigned_member_id
-- FROM public.get_available_slots('service-inexistente', CURRENT_DATE);
-- Esperado: 0 linhas (sem erro, confirma assinatura correta).

-- V8. Smoke test — slot com max_capacity > 1 tem vagas corretas:
--   (Requer service_availability com max_capacity = 5 para testar.)
--   Criar availability, criar 2 bookings, verificar available_seats = 3.
