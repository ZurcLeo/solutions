-- =====================================================
-- MIGRAÇÃO: Fiscal — Cron Jobs
-- [FISCAL-004] Marca pendências vencidas + helper para deadline notifications
--
-- Autor: infra-agent (ElosCloud)
-- Data: 2026-06-22
-- =====================================================

-- Função: marca pendências vencidas (prazo_legal < now())
CREATE OR REPLACE FUNCTION public.fiscal_check_expired_pendencias()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Setar user como 'system' para o trigger de auditoria
    PERFORM set_config('app.current_user_id', 'system', true);

    UPDATE public.seller_client_pendencias
    SET status = 'vencida'
    WHERE status IN ('aberta', 'em_andamento')
      AND prazo_legal < NOW();
END;
$$;

-- Função: retorna pendências vencendo nos próximos N dias
CREATE OR REPLACE FUNCTION public.get_pendencias_vencendo_em(p_days INT)
RETURNS TABLE (
    id TEXT,
    seller_id TEXT,
    seller_client_id TEXT,
    titulo TEXT,
    prazo_legal TIMESTAMPTZ,
    responsavel_user_id TEXT,
    status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        p.id, p.seller_id, p.seller_client_id, p.titulo,
        p.prazo_legal, p.responsavel_user_id, p.status
    FROM public.seller_client_pendencias p
    WHERE p.status IN ('aberta', 'em_andamento')
      AND p.prazo_legal > NOW()
      AND p.prazo_legal <= NOW() + (p_days || ' days')::interval
    ORDER BY p.prazo_legal ASC;
$$;

-- Cron job: roda às 06:00 UTC diariamente
-- NOTA: pg_cron precisa estar habilitado na instância Supabase
SELECT cron.schedule(
    'fiscal-check-expired-pendencias',
    '0 6 * * *',
    $$SELECT public.fiscal_check_expired_pendencias()$$
);

-- Security
REVOKE EXECUTE ON FUNCTION public.fiscal_check_expired_pendencias() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_pendencias_vencendo_em(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pendencias_vencendo_em(INT) TO authenticated;
