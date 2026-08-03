-- =====================================================
-- MIGRAÇÃO: Corrige timezone dos slots de agendamento
-- [SCHED-TZ-FIX]
--
-- Problema:
--   A RPC get_available_slots() construía os TIMESTAMPTZ dos slots
--   concatenando data + hora e fazendo cast direto:
--     (p_date::text || ' ' || start_time::text)::TIMESTAMPTZ
--   O PostgreSQL/Supabase interpreta esse cast sem timezone como UTC.
--   Resultado: um prestador que configura slots das 08:00 às 18:00
--   (horário de Brasília) gerava slots das 05:00 às 15:00 BRT (-3h).
--
-- Solução:
--   Usar ::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo' para que o
--   horário digitado pelo prestador seja interpretado como BRT/BRST,
--   convertendo corretamente para UTC (TIMESTAMPTZ) antes de armazenar.
--
-- Impacto:
--   • Bookings já criados NÃO são afetados (scheduled_at e scheduled_end
--     são TIMESTAMPTZ imutáveis, certos do momento em que foram inseridos).
--   • Novos slots passam a ser gerados corretamente em horário de Brasília.
--   • A comparação de sobreposição com service_bookings segue correta
--     porque ambos os lados são TIMESTAMPTZ.
--
-- Data: 2026-06-10
-- Agente: marketplace-agent | Revisado por: ClaudIA
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
    rec_avail       RECORD;
    slot_s          TIMESTAMPTZ;
    slot_e          TIMESTAMPTZ;
    step_interval   INTERVAL;
    block_start     TIMESTAMPTZ;
    block_end       TIMESTAMPTZ;
    is_available    BOOLEAN;
    p_dow           INT;
BEGIN
    -- Dia da semana da data solicitada (0=Domingo ... 6=Sábado, padrão PostgreSQL).
    -- DATE é timezone-agnostic: o DOW correto independe do fuso horário.
    p_dow := EXTRACT(DOW FROM p_date)::INT;

    -- Itera sobre cada bloco de disponibilidade ativo para o dia da semana
    FOR rec_avail IN
        SELECT
            sa.start_time,
            sa.end_time,
            sa.slot_duration_minutes,
            sa.gap_minutes
        FROM public.service_availability sa
        WHERE sa.service_id  = p_service_id
          AND sa.day_of_week = p_dow
          AND sa.active      = true
        ORDER BY sa.start_time
    LOOP
        -- Converte time → timestamptz interpretando o horário como Brasília (BRT/BRST).
        --
        -- Sintaxe: ::TIMESTAMP AT TIME ZONE 'zona'
        --   Quando aplicada a um TIMESTAMP WITHOUT TIME ZONE, converte
        --   o valor DA zona informada PARA UTC, retornando um TIMESTAMPTZ.
        --
        -- Exemplo (horário de verão desligado, BRT = UTC-3):
        --   '2026-06-10 08:00:00'::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo'
        --   → 2026-06-10 11:00:00+00  (08:00 BRT = 11:00 UTC)
        --
        -- Isso garante que um prestador que digita "08:00" como início do bloco
        -- receba slots a partir das 08:00 de Brasília, não das 08:00 UTC (= 05:00 BRT).
        block_start := (p_date::text || ' ' || rec_avail.start_time::text)::TIMESTAMP
                           AT TIME ZONE 'America/Sao_Paulo';

        block_end   := (p_date::text || ' ' || rec_avail.end_time::text)::TIMESTAMP
                           AT TIME ZONE 'America/Sao_Paulo';

        step_interval := make_interval(
            mins => rec_avail.slot_duration_minutes + rec_avail.gap_minutes
        );

        -- Gera slots: de block_start até block_end com passo de (slot_duration + gap)
        slot_s := block_start;
        WHILE slot_s + make_interval(mins => rec_avail.slot_duration_minutes) <= block_end LOOP

            slot_e := slot_s + make_interval(mins => rec_avail.slot_duration_minutes);

            -- Verifica sobreposição com bookings confirmed ou pending.
            -- Condição de interseção: scheduled_at < slot_e AND scheduled_end > slot_s
            -- (ambos os lados são TIMESTAMPTZ — comparação correta)
            SELECT NOT EXISTS (
                SELECT 1
                FROM public.service_bookings sb
                WHERE sb.service_id    = p_service_id
                  AND sb.status        IN ('confirmed', 'pending')
                  AND sb.scheduled_at  < slot_e
                  AND sb.scheduled_end > slot_s
            ) INTO is_available;

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
    '[SCHED-TZ-FIX] Retorna todos os slots gerados para um serviço em uma data específica. '
    'Os horários de start_time/end_time de service_availability são interpretados como '
    'horário de Brasília (America/Sao_Paulo) via AT TIME ZONE, evitando que slots '
    'cadastrados como "08:00 BRT" sejam gerados como "05:00 BRT" (bug de timezone UTC). '
    'Itera sobre service_availability (blocos ativos do dia da semana), '
    'gera slots de slot_duration_minutes em slot_duration_minutes + gap_minutes, '
    'e verifica sobreposição com service_bookings (status confirmed ou pending). '
    'Retorna: slot_start (timestamptz), slot_end (timestamptz), available (boolean). '
    'STABLE: não modifica dados. SECURITY DEFINER: acessa service_bookings (privado).';

GRANT EXECUTE ON FUNCTION public.get_available_slots(TEXT, DATE) TO authenticated;


-- =====================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO [SCHED-TZ-FIX]
-- Execute no Supabase SQL Editor após aplicar esta migration.
-- =====================================================

-- V1. Confirmar que a função foi atualizada (verificar "AT TIME ZONE" no body):
--
-- SELECT routine_definition
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name   = 'get_available_slots';
-- Esperado: definição contém 'America/Sao_Paulo'.

-- V2. Smoke test de timezone:
--   Insira uma disponibilidade manual e verifique se slot_start é 11:00 UTC
--   (= 08:00 BRT) para um serviço com start_time = '08:00' em uma data de junho.
--
-- SELECT
--   slot_start,
--   slot_start AT TIME ZONE 'America/Sao_Paulo' AS slot_start_brt
-- FROM public.get_available_slots('<service_id>', '2026-06-11');
-- Esperado: slot_start_brt mostra '08:00:00' (horário de Brasília).
