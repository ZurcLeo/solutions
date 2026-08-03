-- =====================================================
-- MIGRAÇÃO: Scheduling Intelligence — Team Member Assignment + Conflict Detection
-- [SCHED-TEAM]
--
-- Adiciona assigned_member_id a service_availability e service_bookings,
-- permitindo atribuir membros da equipe a blocos de horário específicos.
-- Inclui RPC de detecção de conflitos e atualização do get_available_slots.
--
-- Backward compatible: assigned_member_id é nullable (sellers solo sem impacto).
--
-- Data: 2026-07-23
-- =====================================================

-- 1. ALTER service_availability — coluna assigned_member_id
ALTER TABLE public.service_availability
  ADD COLUMN IF NOT EXISTS assigned_member_id TEXT
    REFERENCES public.seller_team_members(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.service_availability.assigned_member_id IS
  '[SCHED-TEAM] Membro da equipe responsável por este bloco de disponibilidade. '
  'Nullable: sellers solo ou blocos sem atribuição permanecem NULL.';

-- 2. ALTER service_bookings — coluna assigned_member_id
ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS assigned_member_id TEXT
    REFERENCES public.seller_team_members(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.service_bookings.assigned_member_id IS
  '[SCHED-TEAM] Membro da equipe que atenderá este agendamento. '
  'Copiado do service_availability no momento da criação do booking. '
  'Nullable: compatível com bookings existentes.';

-- 3. Index para conflict queries
CREATE INDEX IF NOT EXISTS idx_service_availability_member
  ON public.service_availability(assigned_member_id)
  WHERE assigned_member_id IS NOT NULL;

-- 4. RPC: check_member_availability_conflicts
--    Detecta blocos sobrepostos do mesmo membro em serviços diferentes (ou no mesmo).
--    Retorna linhas conflitantes com nome do serviço para exibição no frontend.
CREATE OR REPLACE FUNCTION public.check_member_availability_conflicts(
    p_seller_id              TEXT,
    p_member_id              TEXT,
    p_day_of_week            INT,
    p_start_time             TIME,
    p_end_time               TIME,
    p_exclude_availability_id TEXT DEFAULT NULL
)
RETURNS TABLE (
    availability_id TEXT,
    service_id      TEXT,
    service_name    TEXT,
    day_of_week     INT,
    start_time      TIME,
    end_time        TIME
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        sa.id           AS availability_id,
        sa.service_id   AS service_id,
        mp.name         AS service_name,
        sa.day_of_week  AS day_of_week,
        sa.start_time   AS start_time,
        sa.end_time     AS end_time
    FROM public.service_availability sa
    INNER JOIN public.marketplace_products mp
        ON mp.id = sa.service_id
    WHERE sa.assigned_member_id = p_member_id
      AND sa.day_of_week        = p_day_of_week
      AND sa.active             = true
      AND mp.seller_id          = p_seller_id
      -- Overlap check: [start, end) ranges overlap when start1 < end2 AND start2 < end1
      AND sa.start_time         < p_end_time
      AND p_start_time          < sa.end_time
      -- Exclude the row being edited (avoid self-conflict)
      AND (p_exclude_availability_id IS NULL OR sa.id != p_exclude_availability_id);
END;
$$;

COMMENT ON FUNCTION public.check_member_availability_conflicts IS
    '[SCHED-TEAM] Detecta conflitos de agendamento: retorna blocos de service_availability '
    'onde o mesmo membro já está alocado em horários sobrepostos no mesmo dia da semana, '
    'dentro do mesmo seller. Usado para alertar o prestador antes de salvar a grade.';

GRANT EXECUTE ON FUNCTION public.check_member_availability_conflicts(TEXT, TEXT, INT, TIME, TIME, TEXT) TO authenticated;

-- 5. Atualizar get_available_slots para incluir assigned_member_id no retorno
-- DROP necessário: PostgreSQL não permite alterar o RETURNS TABLE de uma função existente via CREATE OR REPLACE
DROP FUNCTION IF EXISTS public.get_available_slots(TEXT, DATE);

CREATE OR REPLACE FUNCTION public.get_available_slots(
    p_service_id    TEXT,
    p_date          DATE
)
RETURNS TABLE (
    slot_start           TIMESTAMPTZ,
    slot_end             TIMESTAMPTZ,
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
    is_available    BOOLEAN;
    p_dow           INT;
BEGIN
    p_dow := EXTRACT(DOW FROM p_date)::INT;

    FOR rec_avail IN
        SELECT
            sa.start_time,
            sa.end_time,
            sa.slot_duration_minutes,
            sa.gap_minutes,
            sa.assigned_member_id
        FROM public.service_availability sa
        WHERE sa.service_id  = p_service_id
          AND sa.day_of_week = p_dow
          AND sa.active      = true
        ORDER BY sa.start_time
    LOOP
        block_start := (p_date::text || ' ' || rec_avail.start_time::text)::TIMESTAMP
                           AT TIME ZONE 'America/Sao_Paulo';

        block_end   := (p_date::text || ' ' || rec_avail.end_time::text)::TIMESTAMP
                           AT TIME ZONE 'America/Sao_Paulo';

        step_interval := make_interval(
            mins => rec_avail.slot_duration_minutes + rec_avail.gap_minutes
        );

        slot_s := block_start;
        WHILE slot_s + make_interval(mins => rec_avail.slot_duration_minutes) <= block_end LOOP

            slot_e := slot_s + make_interval(mins => rec_avail.slot_duration_minutes);

            SELECT NOT EXISTS (
                SELECT 1
                FROM public.service_bookings sb
                WHERE sb.service_id    = p_service_id
                  AND sb.status        IN ('confirmed', 'pending')
                  AND sb.scheduled_at  < slot_e
                  AND sb.scheduled_end > slot_s
            ) INTO is_available;

            slot_start          := slot_s;
            slot_end            := slot_e;
            available           := is_available;
            assigned_member_id  := rec_avail.assigned_member_id;
            RETURN NEXT;

            slot_s := slot_s + step_interval;
        END LOOP;
    END LOOP;

    RETURN;
END;
$$;

COMMENT ON FUNCTION public.get_available_slots(TEXT, DATE) IS
    '[SCHED-TEAM] Retorna slots para um serviço em uma data. Inclui assigned_member_id '
    'do bloco de disponibilidade correspondente. Horários interpretados como America/Sao_Paulo.';

GRANT EXECUTE ON FUNCTION public.get_available_slots(TEXT, DATE) TO authenticated;
