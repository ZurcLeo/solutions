-- =====================================================
-- MIGRAÇÃO: Backfill owner como team member
-- [EQP-BUG-001] Corrige sellers cujo seedOwner() falhou
-- silenciosamente durante a criação do perfil.
--
-- Idempotente: ON CONFLICT DO NOTHING na UNIQUE (seller_id, user_id)
-- Seguro: rode quantas vezes precisar sem efeito colateral.
--
-- Depende de: 20260622000001_seller_team_members.sql
-- Autor: marketplace-agent (ElosCloud)
-- Data: 2026-08-09
-- =====================================================

INSERT INTO public.seller_team_members (
    id,
    seller_id,
    user_id,
    role,
    status,
    active,
    invited_by,
    validation_status,
    validated_at,
    joined_at,
    permissions
)
SELECT
    gen_random_uuid()::text,
    sp.id,
    sp.user_id,
    'owner',
    'active',
    true,
    sp.user_id,
    'validated',
    sp.created_at,
    sp.created_at,
    '{"can_manage_clients": true, "can_manage_pendencias": true, "can_view_financials": true, "can_manage_team": true, "can_manage_catalog": true, "can_manage_orders": true, "can_manage_settings": true, "can_manage_billing": true}'::jsonb
FROM public.seller_profiles sp
WHERE NOT EXISTS (
    SELECT 1
    FROM public.seller_team_members stm
    WHERE stm.seller_id = sp.id
      AND stm.role = 'owner'
)
ON CONFLICT (seller_id, user_id) DO NOTHING;


-- =====================================================
-- RPC: seed_owner_team_member
-- [EQP-BUG-001] Chamado pelo marketplaceService.createSellerProfile()
-- para garantir atomicidade: se o INSERT falhar, o Postgres propaga o erro
-- dentro da mesma transação da RPC.
-- Idempotente: ON CONFLICT DO NOTHING.
-- =====================================================

CREATE OR REPLACE FUNCTION public.seed_owner_team_member(
    p_seller_id TEXT,
    p_user_id   TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.seller_team_members (
        id, seller_id, user_id, role, status, active,
        invited_by, validation_status, validated_at, joined_at,
        permissions
    )
    VALUES (
        gen_random_uuid()::text,
        p_seller_id,
        p_user_id,
        'owner',
        'active',
        true,
        p_user_id,
        'validated',
        NOW(),
        NOW(),
        '{"can_manage_clients": true, "can_manage_pendencias": true, "can_view_financials": true, "can_manage_team": true, "can_manage_catalog": true, "can_manage_orders": true, "can_manage_settings": true, "can_manage_billing": true}'::jsonb
    )
    ON CONFLICT (seller_id, user_id) DO NOTHING;
END;
$$;

-- Restrict execution to authenticated users only
REVOKE EXECUTE ON FUNCTION public.seed_owner_team_member(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_owner_team_member(TEXT, TEXT) TO authenticated, service_role;
