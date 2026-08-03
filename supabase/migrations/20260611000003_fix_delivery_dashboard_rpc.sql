-- =====================================================
-- MIGRAÇÃO: Ajuste no Painel de Delivery
-- Inclui status 'completed' nas estatísticas e histórico.
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_delivery_dashboard(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    svc              delivery_services;
    session_active   BOOLEAN;
    today_count      INTEGER;
    today_earnings   NUMERIC;
    week_count       INTEGER;
    week_earnings    NUMERIC;
    pending_count    INTEGER;
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

    -- Entregas de hoje (delivered ou completed)
    SELECT COUNT(*), COALESCE(SUM(accepted_fee), 0)
    INTO today_count, today_earnings
    FROM public.delivery_requests
    WHERE service_id = svc.id
      AND status IN ('delivered', 'completed')
      AND delivered_at >= CURRENT_DATE;

    -- Entregas da semana (delivered ou completed)
    SELECT COUNT(*), COALESCE(SUM(accepted_fee), 0)
    INTO week_count, week_earnings
    FROM public.delivery_requests
    WHERE service_id = svc.id
      AND status IN ('delivered', 'completed')
      AND delivered_at >= date_trunc('week', NOW());

    -- Pedidos pendentes (aceitos mas não concluídos)
    SELECT COUNT(*) INTO pending_count
    FROM public.delivery_requests
    WHERE service_id = svc.id
      AND status IN ('matched', 'accepted', 'in_transit_to_pickup', 'picked_up', 'in_transit_to_dest');

    RETURN jsonb_build_object(
        'ok',               true,
        'service_id',       svc.id,
        'is_available',     session_active,
        'delivery_level',   svc.delivery_level,
        'average_rating',   svc.average_rating,
        'total_deliveries', svc.total_deliveries,
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
