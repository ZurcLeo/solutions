-- =====================================================
-- MIGRAÇÃO: Campos de agendamento em marketplace_products
-- [SCHED-6A]
--
-- Colunas adicionadas:
--   duration_minutes    — duração de cada sessão de serviço presencial (minutos)
--   cancellation_policy — política de cancelamento snapshot para service_bookings
--
-- Ambas são opcionais e só relevantes para produtos com
-- fulfillment_types contendo 'in_person_service'.
--
-- Depende de:
--   20260525000013_hyper001_postgis_fulfillment.sql (marketplace_products)
--
-- Agente: marketplace-agent | Sprint: SCHED-6A
-- Data: 2026-06-10
-- =====================================================


-- ── duration_minutes ─────────────────────────────────────────────────────────
-- Duração padrão de cada sessão do serviço presencial, em minutos.
-- Valores permitidos: 15, 30, 45, 60, 90, 120, 180, 240, 480.
-- Usado pela RPC get_available_slots e pelo frontend BookingCalendar
-- para gerar os slots corretos.
-- null = produto não é serviço presencial (sem agendamento).
ALTER TABLE public.marketplace_products
    ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT NULL
        CONSTRAINT mp_duration_minutes_valid
        CHECK (
            duration_minutes IS NULL OR
            duration_minutes IN (15, 30, 45, 60, 90, 120, 180, 240, 480)
        );

COMMENT ON COLUMN public.marketplace_products.duration_minutes IS
    '[SCHED-6A] Duração de cada sessão do serviço presencial em minutos. '
    'null = produto não é serviço presencial. '
    'Valores permitidos: 15, 30, 45, 60, 90, 120, 180, 240, 480. '
    'Usado pelo AvailabilityEditor e BookingCalendar no frontend, '
    'e pelo bookingService para verificar a duração do slot reservado. '
    'O ProductForm (SellerDashboard) expõe este campo apenas quando '
    'fulfillment_types contém in_person_service.';


-- ── cancellation_policy ───────────────────────────────────────────────────────
-- Política de cancelamento do prestador para serviços presenciais.
-- Formato: { "advance_hours": 24, "fee_pct": 0 }
--   advance_hours: horas mínimas de antecedência para cancelar sem taxa (padrão: 24h)
--   fee_pct:       percentual da taxa cobrado fora do prazo (0 = sem taxa, 1.0 = 100%)
--
-- Ao criar um service_booking, o bookingService copia este valor para
-- service_bookings.cancellation_policy (snapshot imutável).
ALTER TABLE public.marketplace_products
    ADD COLUMN IF NOT EXISTS cancellation_policy JSONB DEFAULT '{"advance_hours": 24, "fee_pct": 0}'::jsonb;

COMMENT ON COLUMN public.marketplace_products.cancellation_policy IS
    '[SCHED-6A] Política de cancelamento do prestador para serviços presenciais. '
    'Formato: {"advance_hours": 24, "fee_pct": 0}. '
    'advance_hours: horas de antecedência para cancelar sem taxa. '
    'fee_pct: percentual da taxa fora do prazo (0 = sem taxa, 1.0 = 100%). '
    'Valor padrão: 24h de antecedência, sem taxa (política mais permissiva). '
    'Ao criar um service_booking, este valor é copiado como snapshot imutável '
    'para service_bookings.cancellation_policy.';


-- ── Índice parcial para busca eficiente de serviços agendáveis ───────────────
-- Filtra produtos que são serviços presenciais com duração definida.
CREATE INDEX IF NOT EXISTS idx_marketplace_products_in_person_service
    ON public.marketplace_products (id)
    WHERE
        duration_minutes IS NOT NULL
        AND active = true;

COMMENT ON INDEX public.idx_marketplace_products_in_person_service IS
    '[SCHED-6A] Índice parcial para produtos agendáveis (duration_minutes IS NOT NULL AND active). '
    'Usado na busca de serviços presenciais no marketplace.';


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO [SCHED-6A]
-- Execute no Supabase SQL Editor após aplicar.
-- =====================================================

-- V1. Confirmar colunas adicionadas:
--
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name   = 'marketplace_products'
--   AND column_name IN ('duration_minutes', 'cancellation_policy')
-- ORDER BY column_name;
-- Esperado: 2 linhas.

-- V2. Confirmar constraint de duration_minutes (deve falhar com valor inválido):
--
-- UPDATE public.marketplace_products
--   SET duration_minutes = 99
-- WHERE id = (SELECT id FROM public.marketplace_products LIMIT 1);
-- Esperado: ERROR — violates check constraint "mp_duration_minutes_valid"

-- V3. Confirmar valor padrão de cancellation_policy:
--
-- SELECT cancellation_policy
-- FROM public.marketplace_products
-- WHERE cancellation_policy IS NOT NULL
-- LIMIT 1;
-- Esperado: {"advance_hours": 24, "fee_pct": 0}

-- V4. Confirmar índice criado:
--
-- SELECT indexname
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND tablename  = 'marketplace_products'
--   AND indexname  = 'idx_marketplace_products_in_person_service';
-- Esperado: 1 linha.
