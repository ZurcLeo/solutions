-- =====================================================
-- MIGRAÇÃO: Fix get_delivery_dashboard — STABLE → VOLATILE
-- [DELIVERY-BUG-002] RPC falhava com:
--   "UPDATE is not allowed in a non-volatile function"
--
-- Causa: migration 20260611000006 declarou a função como STABLE,
--   mas linhas 179-183 fazem UPDATE para sincronizar a coluna cached
--   total_deliveries. PostgreSQL bloqueia writes em funções STABLE.
--
-- Fix: trocar STABLE por VOLATILE.
--
-- Agente: marketplace-agent
-- Data: 2026-06-19
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_delivery_dashboard(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
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
        'total_deliveries', real_total_deliveries,
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
    '[DELIVERY-002][BUG-002-FIX] Painel do entregador. '
    'VOLATILE (não STABLE) pois auto-sincroniza total_deliveries cached. '
    'total_deliveries calculado diretamente de delivery_requests.';
