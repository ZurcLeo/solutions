-- =====================================================
-- Migration: FK service_bookings.service_id → marketplace_products.id
-- Corrige erro PostgREST:
--   "Could not find a relationship between
--    'service_bookings' and 'marketplace_products'"
-- Necessario para nested select em:
--   - bookingService.runGroupConfirmationJob() (linha 1088)
--   - bookingService.runGroupDeadlineJob() (linha 1341)
-- =====================================================

-- Verificar dados orfaos antes de adicionar FK
-- (bookings com service_id que nao existe em marketplace_products)
DO $$
DECLARE
    v_orphan_count INT;
BEGIN
    SELECT COUNT(*) INTO v_orphan_count
    FROM public.service_bookings sb
    LEFT JOIN public.marketplace_products mp ON mp.id = sb.service_id
    WHERE mp.id IS NULL;

    IF v_orphan_count > 0 THEN
        RAISE WARNING 'Found % orphan service_bookings (service_id sem produto correspondente). Limpando...', v_orphan_count;

        -- Marcar orfaos como cancelled em vez de deletar (preserva auditoria)
        UPDATE public.service_bookings
        SET status = 'cancelled',
            notes = COALESCE(notes, '') || ' [auto-cancelled: orphan service_id, migration 20260812000002]'
        WHERE service_id NOT IN (SELECT id FROM public.marketplace_products)
          AND status NOT IN ('cancelled', 'expired');
    END IF;
END $$;

-- Adicionar FK constraint
ALTER TABLE public.service_bookings
    ADD CONSTRAINT fk_service_bookings_marketplace_products
    FOREIGN KEY (service_id)
    REFERENCES public.marketplace_products(id)
    ON DELETE CASCADE;

COMMENT ON CONSTRAINT fk_service_bookings_marketplace_products
    ON public.service_bookings IS
    'FK para marketplace_products.id. '
    'Habilita PostgREST nested select (marketplace_products!inner). '
    'ON DELETE CASCADE: booking removido quando produto e deletado.';
