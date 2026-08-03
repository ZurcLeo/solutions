-- =====================================================
-- Migration: booking_no_show_status
-- [SCHED-001] Adiciona status 'no_show' ao service_bookings
-- =====================================================
--
-- Contexto: O NotificationDispatcher define o tipo booking_no_show
-- (webhook event booking.no_show), mas o status 'no_show' não existia
-- na CHECK constraint do service_bookings. Esta migration:
--   1. Expande a CHECK constraint de status para incluir 'no_show'
--   2. Adiciona coluna no_show_at para auditoria de timestamp
--
-- Máquina de estados atualizada:
--   confirmed → no_show (prestador marca quando cliente não compareceu)
-- =====================================================

BEGIN;

-- 1. Dropar a constraint antiga e recriar com 'no_show' incluído
ALTER TABLE public.service_bookings
    DROP CONSTRAINT IF EXISTS service_bookings_status_check;

ALTER TABLE public.service_bookings
    ADD CONSTRAINT service_bookings_status_check
    CHECK (status IN (
        'pending',
        'confirmed',
        'completed',
        'cancelled',
        'expired',
        'disputed',
        'no_show'
    ));

-- 2. Adicionar coluna no_show_at para auditoria de timestamp
ALTER TABLE public.service_bookings
    ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMPTZ;

COMMENT ON COLUMN public.service_bookings.no_show_at IS
    'Timestamp de quando o prestador marcou o cliente como no-show. '
    'Preenchido apenas quando status transiciona para no_show.';

COMMIT;
