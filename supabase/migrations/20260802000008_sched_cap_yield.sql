-- ============================================================
-- SCHED-CAP-012: Yield Management — Preco variavel por slot
--
-- Alteracoes:
--   1. service_availability + price_override_brl (NUMERIC, nullable)
--   2. get_available_slots() reescrita com campo price_brl no retorno
--
-- Logica de preco:
--   Se service_availability.price_override_brl IS NOT NULL -> usa override
--   Senao -> busca marketplace_products.price_brl como fallback
--
-- Backward compatible: price_override_brl NULL = usa price_brl do produto.
-- Depende de:
--   20260802000006_sched_cap_capacity.sql
--
-- Agente: marketplace-agent + frontend-core-agent
-- Data: 2026-08-02
-- ============================================================


-- ============================================================
-- 1. ALTER service_availability — price_override_brl
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'service_availability'
          AND column_name  = 'price_override_brl'
    ) THEN
        ALTER TABLE public.service_availability
            ADD COLUMN price_override_brl NUMERIC(10,2);
    END IF;
END $$;

COMMENT ON COLUMN public.service_availability.price_override_brl IS
    '[SCHED-CAP-012] Preco especifico para este bloco. NULL = usa price_brl do produto. '
    'Permite tarifa dinamica: pico (sabado manha) mais caro, vale (terca tarde) mais barato.';


-- ============================================================
-- 2. REPLACE RPC get_available_slots — adicionar price_brl
-- ============================================================
-- DROP necessario: PostgreSQL nao permite alterar RETURNS TABLE via CREATE OR REPLACE
-- A assinatura anterior retornava (slot_start, slot_end, max_capacity, booked_count, available_seats, available, assigned_member_id).
-- A nova retorna todos os campos anteriores + price_brl.
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
    assigned_member_id   TEXT,
    price_brl            NUMERIC(10,2)
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
    v_product_price NUMERIC(10,2);
    p_dow           INT;
BEGIN
    -- Buscar preco base do produto (fallback quando nao ha price_override)
    SELECT mp.price_brl INTO v_product_price
    FROM public.marketplace_products mp
    WHERE mp.id = p_service_id;

    -- Dia da semana da data solicitada (0=Domingo ... 6=Sabado, padrao PostgreSQL)
    p_dow := EXTRACT(DOW FROM p_date)::INT;

    -- Itera sobre cada bloco de disponibilidade ativo para o dia da semana
    FOR rec_avail IN
        SELECT
            sa.start_time,
            sa.end_time,
            sa.slot_duration_minutes,
            sa.gap_minutes,
            sa.max_capacity         AS sa_max_capacity,
            sa.assigned_member_id   AS sa_assigned_member_id,
            sa.price_override_brl   AS sa_price_override
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
            price_brl           := COALESCE(rec_avail.sa_price_override, v_product_price);
            RETURN NEXT;

            -- Avanca para o proximo slot (inclui gap_minutes)
            slot_s := slot_s + step_interval;
        END LOOP;
    END LOOP;

    RETURN;
END;
$$;

COMMENT ON FUNCTION public.get_available_slots(TEXT, DATE) IS
    '[SCHED-CAP-012] Retorna slots com contagem de vagas e preco para um servico em uma data. '
    'price_brl = COALESCE(service_availability.price_override_brl, marketplace_products.price_brl). '
    'max_capacity vem de service_availability (default 1 = individual). '
    'booked_count = bookings com status pending/confirmed/pre_reserved no slot. '
    'available_seats = max_capacity - booked_count. '
    'available = true quando available_seats > 0. '
    'Horarios interpretados como America/Sao_Paulo. '
    'Inclui assigned_member_id do bloco de disponibilidade (SCHED-TEAM). '
    'STABLE: nao modifica dados. SECURITY DEFINER: acessa service_bookings (privado).';

GRANT EXECUTE ON FUNCTION public.get_available_slots(TEXT, DATE) TO authenticated;


-- ============================================================
-- BLOCO DE VERIFICACAO POS-MIGRACAO [SCHED-CAP-012]
-- Execute no Supabase SQL Editor apos aplicar esta migration.
-- ============================================================

-- V1. Confirmar coluna price_override_brl em service_availability:
--
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name   = 'service_availability'
--   AND column_name  = 'price_override_brl';
-- Esperado: 1 linha, numeric, YES (nullable).

-- V2. Smoke test — get_available_slots retorna campo price_brl:
--
-- SELECT slot_start, slot_end, max_capacity, booked_count, available_seats,
--        available, assigned_member_id, price_brl
-- FROM public.get_available_slots('service-inexistente', CURRENT_DATE);
-- Esperado: 0 linhas (sem erro, confirma assinatura correta com price_brl).

-- V3. Smoke test — price_brl usa fallback do produto quando override = NULL:
--   (Requer um servico real com price_brl no marketplace_products.)
--   INSERT INTO service_availability (service_id, day_of_week, start_time, end_time, max_capacity)
--     VALUES ('svc-test', 1, '09:00', '10:00', 1);
--   SELECT price_brl FROM get_available_slots('svc-test', '2026-08-04'); -- segunda
--   Esperado: price_brl = marketplace_products.price_brl do produto 'svc-test'.

-- V4. Smoke test — price_brl usa override quando definido:
--   UPDATE service_availability SET price_override_brl = 120.00
--     WHERE service_id = 'svc-test' AND day_of_week = 1;
--   SELECT price_brl FROM get_available_slots('svc-test', '2026-08-04');
--   Esperado: price_brl = 120.00.
