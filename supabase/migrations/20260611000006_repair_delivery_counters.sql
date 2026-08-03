-- =====================================================
-- MIGRAÇÃO: Reparo de contadores de entrega + RPC defensiva
-- [DELIVERY-BUG-001] total_deliveries desincronizado com delivery_requests
--
-- Problema identificado (2026-06-11):
--   delivery_services.total_deliveries ficou em 0 para entregadores que
--   concluíram entregas. A coluna é incrementada SOMENTE via
--   confirm_delivery_step(p_step='delivered'), mas entregas criadas/
--   finalizadas via inserção direta (testes/admin) não passam por esse RPC.
--
-- Esta migration:
--   1. Atualiza get_delivery_dashboard para calcular total_deliveries
--      diretamente de delivery_requests (fonte de verdade), ignorando a
--      coluna cached. Mantém a coluna como write-through para performance
--      futura, mas o dashboard usa o valor real.
--   2. Repara todos os contadores desincronizados em delivery_services.
--   3. Adiciona trigger para manter total_deliveries sincronizado
--      automaticamente em qualquer transição para 'delivered' ou 'completed'.
--
-- Agente: marketplace-agent | Revisado por: ClaudIA
-- Data: 2026-06-11
-- =====================================================


-- =====================================================
-- 1. Reparar contadores desincronizados (run once)
-- =====================================================

UPDATE public.delivery_services ds
SET
    total_deliveries = (
        SELECT COUNT(*)
        FROM public.delivery_requests dr
        WHERE dr.service_id = ds.id
          AND dr.status IN ('delivered', 'completed')
    ),
    updated_at = NOW()
WHERE EXISTS (
    -- Só atualiza quem tem mismatch (evita writes desnecessários)
    SELECT 1
    FROM public.delivery_requests dr
    WHERE dr.service_id = ds.id
      AND dr.status IN ('delivered', 'completed')
    HAVING COUNT(*) != ds.total_deliveries
);

COMMENT ON TABLE public.delivery_services IS
    '[DELIVERY-001] Perfil da loja de entrega. '
    'total_deliveries mantido sincronizado via trigger sync_delivery_total_trigger. '
    'Nível 1→5 desbloqueado por total_deliveries + average_rating (game-agent).';


-- =====================================================
-- 2. Trigger para manter total_deliveries sincronizado
--    automaticamente após qualquer UPDATE em delivery_requests
-- =====================================================

CREATE OR REPLACE FUNCTION public.sync_delivery_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Dispara quando delivery_request vai para 'delivered' ou 'completed'
    -- (inclusive quando service_id é atribuído retroativamente)
    IF (NEW.status IN ('delivered', 'completed') AND
        (OLD.status NOT IN ('delivered', 'completed') OR OLD.service_id IS DISTINCT FROM NEW.service_id))
    THEN
        IF NEW.service_id IS NOT NULL THEN
            UPDATE public.delivery_services
            SET
                total_deliveries = (
                    SELECT COUNT(*)
                    FROM public.delivery_requests
                    WHERE service_id = NEW.service_id
                      AND status IN ('delivered', 'completed')
                ),
                updated_at = NOW()
            WHERE id = NEW.service_id;
        END IF;

        -- Se service_id mudou, recalcula o antigo também
        IF OLD.service_id IS NOT NULL AND OLD.service_id IS DISTINCT FROM NEW.service_id THEN
            UPDATE public.delivery_services
            SET
                total_deliveries = (
                    SELECT COUNT(*)
                    FROM public.delivery_requests
                    WHERE service_id = OLD.service_id
                      AND status IN ('delivered', 'completed')
                ),
                updated_at = NOW()
            WHERE id = OLD.service_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_delivery_total() IS
    '[DELIVERY-BUG-001] Mantém delivery_services.total_deliveries sincronizado '
    'com o número real de entregas em delivery_requests. '
    'Dispara em UPDATE quando status vai para delivered/completed.';

DROP TRIGGER IF EXISTS sync_delivery_total_trigger ON public.delivery_requests;
CREATE TRIGGER sync_delivery_total_trigger
    AFTER UPDATE OF status, service_id ON public.delivery_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_delivery_total();


-- =====================================================
-- 3. Atualizar get_delivery_dashboard — total real dos requests
--    (não confia no campo cached; usa COUNT direto)
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_delivery_dashboard(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    svc                  delivery_services;
    session_active       BOOLEAN;
    today_count          INTEGER;
    today_earnings       NUMERIC;
    week_count           INTEGER;
    week_earnings        NUMERIC;
    pending_count        INTEGER;
    real_total_deliveries INTEGER;
BEGIN
    SELECT * INTO svc
    FROM public.delivery_services
    WHERE user_id = p_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'no_service');
    END IF;

    -- Verifica sessão ativa
    SELECT EXISTS(
        SELECT 1 FROM public.delivery_active_sessions
        WHERE service_id = svc.id AND expires_at > NOW()
    ) INTO session_active;

    -- Total real de entregas (fonte de verdade — ignora coluna cached)
    SELECT COUNT(*) INTO real_total_deliveries
    FROM public.delivery_requests
    WHERE service_id = svc.id
      AND status IN ('delivered', 'completed');

    -- Entregas de hoje
    SELECT COUNT(*), COALESCE(SUM(accepted_fee), 0)
    INTO today_count, today_earnings
    FROM public.delivery_requests
    WHERE service_id = svc.id
      AND status IN ('delivered', 'completed')
      AND delivered_at >= CURRENT_DATE;

    -- Entregas da semana
    SELECT COUNT(*), COALESCE(SUM(accepted_fee), 0)
    INTO week_count, week_earnings
    FROM public.delivery_requests
    WHERE service_id = svc.id
      AND status IN ('delivered', 'completed')
      AND delivered_at >= date_trunc('week', NOW());

    -- Pedidos pendentes (em andamento)
    SELECT COUNT(*) INTO pending_count
    FROM public.delivery_requests
    WHERE service_id = svc.id
      AND status IN ('matched', 'accepted', 'in_transit_to_pickup', 'picked_up', 'in_transit_to_dest');

    -- Sincroniza a coluna cached se divergiu
    IF real_total_deliveries != svc.total_deliveries THEN
        UPDATE public.delivery_services
        SET total_deliveries = real_total_deliveries, updated_at = NOW()
        WHERE id = svc.id;
    END IF;

    RETURN jsonb_build_object(
        'ok',               true,
        'service_id',       svc.id,
        'is_available',     session_active,
        'delivery_level',   svc.delivery_level,
        'average_rating',   svc.average_rating,
        'total_deliveries', real_total_deliveries,   -- valor real, não cached
        'today',            jsonb_build_object(
            'count',    today_count,
            'earnings', today_earnings
        ),
        'week',             jsonb_build_object(
            'count',    week_count,
            'earnings', week_earnings
        ),
        'pending_count',    pending_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_delivery_dashboard(TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_delivery_dashboard(TEXT) IS
    '[DELIVERY-002][BUG-001-FIX] Painel do entregador com total real de entregas. '
    'total_deliveries calculado diretamente de delivery_requests (não do campo cached). '
    'Auto-sincroniza a coluna cached se houver divergência. '
    'Migração 20260611000006 corrige divergências históricas em massa.';
