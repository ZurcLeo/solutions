-- =====================================================
-- MIGRAÇÃO: Seller Team Members — Sub-usuários por loja
-- [TEAM-001] Pré-requisito do módulo fiscal
--
-- Tabela:
--   seller_team_members — membros da equipe de uma loja
--
-- Funções RBAC (SECURITY DEFINER):
--   is_seller_team_member(seller_id)
--   check_seller_team_role_level(seller_id, user_id, min_role)
--   get_my_seller_team_permission(seller_id, permission)
--
-- BREAKING CHANGE:
--   get_my_seller_id() — agora retorna seller_id para owners E team members
--
-- Depende de: seller_profiles(id), users(id)
-- Autor: marketplace-agent (ElosCloud)
-- Data: 2026-06-22
-- =====================================================


-- =====================================================
-- 1. seller_team_members
-- =====================================================

CREATE TABLE IF NOT EXISTS public.seller_team_members (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    seller_id         TEXT NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
    user_id           TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role              TEXT NOT NULL DEFAULT 'employee'
                      CHECK (role IN ('owner', 'manager', 'employee', 'removed')),
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('active', 'pending', 'inactive', 'removed')),
    active            BOOLEAN NOT NULL DEFAULT false,
    invited_by        TEXT REFERENCES public.users(id),
    validation_status TEXT DEFAULT 'pending'
                      CHECK (validation_status IN ('pending', 'validated', 'rejected')),
    validated_at      TIMESTAMPTZ,
    joined_at         TIMESTAMPTZ,
    permissions       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT seller_team_members_unique UNIQUE (seller_id, user_id)
);

COMMENT ON TABLE public.seller_team_members IS
    '[TEAM-001] Membros da equipe de uma loja no Mercado Local. '
    'Padrão similar a caixinha_members. Roles: owner(3) > manager(2) > employee(1). '
    'Permissions é JSONB granular: can_manage_clients, can_manage_pendencias, can_view_financials, can_manage_team.';

COMMENT ON COLUMN public.seller_team_members.permissions IS
    'JSONB de permissões granulares. Chaves: '
    'can_manage_clients, can_manage_pendencias, can_view_financials, can_manage_team. '
    'Owner tem todas implicitamente.';

-- Indexes para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_seller_team_active_members
    ON public.seller_team_members (seller_id, status)
    WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_seller_team_user_active
    ON public.seller_team_members (user_id, active)
    WHERE status = 'active';

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.fn_seller_team_members_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seller_team_members_updated_at ON public.seller_team_members;
CREATE TRIGGER trg_seller_team_members_updated_at
    BEFORE UPDATE ON public.seller_team_members
    FOR EACH ROW EXECUTE FUNCTION public.fn_seller_team_members_updated_at();


-- =====================================================
-- 2. Funções RBAC (SECURITY DEFINER STABLE)
-- =====================================================

-- Mapeamento de role → nível numérico
-- owner=3, manager=2, employee=1, removed=0
CREATE OR REPLACE FUNCTION public.seller_team_role_level(p_role TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_role
        WHEN 'owner'    THEN 3
        WHEN 'manager'  THEN 2
        WHEN 'employee' THEN 1
        ELSE 0
    END;
$$;

-- Verifica se auth.uid() é membro ativo de um seller
CREATE OR REPLACE FUNCTION public.is_seller_team_member(p_seller_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.seller_team_members
        WHERE seller_id = p_seller_id
          AND user_id = auth.uid()::text
          AND status = 'active'
          AND active = true
    );
$$;

-- Verifica se user tem role >= min_role no seller
CREATE OR REPLACE FUNCTION public.check_seller_team_role_level(
    p_seller_id TEXT,
    p_user_id   TEXT,
    p_min_role  TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.seller_team_members
        WHERE seller_id = p_seller_id
          AND user_id = p_user_id
          AND status = 'active'
          AND active = true
          AND seller_team_role_level(role) >= seller_team_role_level(p_min_role)
    );
$$;

-- Verifica permissão JSONB específica de um membro
CREATE OR REPLACE FUNCTION public.get_my_seller_team_permission(
    p_seller_id  TEXT,
    p_permission TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (
            SELECT
                -- Owner tem todas as permissões implicitamente
                CASE WHEN stm.role = 'owner' THEN true
                     ELSE COALESCE((stm.permissions ->> p_permission)::boolean, false)
                END
            FROM public.seller_team_members stm
            WHERE stm.seller_id = p_seller_id
              AND stm.user_id = auth.uid()::text
              AND stm.status = 'active'
              AND stm.active = true
            LIMIT 1
        ),
        false
    );
$$;


-- =====================================================
-- 3. BREAKING CHANGE — get_my_seller_id() team-aware
-- =====================================================
-- Agora retorna seller_id para:
--   1) Owner direto (via seller_profiles.user_id) — prioridade
--   2) Membro ativo da equipe (via seller_team_members)
--
-- Policies existentes que usam esta função passam a ser team-aware.
--
-- AUDITORIA (Risco 1):
--   marketplace_products (seller_write, seller_read_own) → ACEITÁVEL: equipe gerencia catálogo
--   marketplace_orders (seller_update) → ACEITÁVEL: equipe processa pedidos
--   delivery_requests (seller policies) → ACEITÁVEL: equipe gerencia entregas
--   store_management policies → ACEITÁVEL: equipe gerencia loja
--   marketplace_reviews (seller_reply) → ACEITÁVEL: equipe responde avaliações
--
-- NOTA: seller_profiles dados financeiros NÃO usam get_my_seller_id()
--       (acessados via user_id = auth.uid() diretamente), sem exposição.
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_my_seller_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- Owner direto tem prioridade via UNION ALL + LIMIT 1
    SELECT seller_id FROM (
        -- 1) Owner direto
        SELECT id AS seller_id, 1 AS priority
        FROM public.seller_profiles
        WHERE user_id = auth.uid()::text

        UNION ALL

        -- 2) Membro ativo da equipe
        SELECT stm.seller_id, 2 AS priority
        FROM public.seller_team_members stm
        WHERE stm.user_id = auth.uid()::text
          AND stm.status = 'active'
          AND stm.active = true
    ) sub
    ORDER BY priority
    LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_my_seller_id() IS
    '[TEAM-001] Retorna seller_profiles.id do usuário autenticado. '
    'Team-aware: retorna para owner direto (prioridade) OU membro ativo da equipe. '
    'SECURITY DEFINER: usado em policies de marketplace_products, marketplace_orders, delivery, reviews.';


-- =====================================================
-- 4. RLS — seller_team_members
-- =====================================================

ALTER TABLE public.seller_team_members ENABLE ROW LEVEL SECURITY;

-- Owner (via seller_profiles.user_id) → CRUD completo
DROP POLICY IF EXISTS "seller_team_members_owner_all" ON public.seller_team_members;
CREATE POLICY "seller_team_members_owner_all"
    ON public.seller_team_members
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.seller_profiles sp
            WHERE sp.id = seller_team_members.seller_id
              AND sp.user_id = auth.uid()::text
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.seller_profiles sp
            WHERE sp.id = seller_team_members.seller_id
              AND sp.user_id = auth.uid()::text
        )
    );

-- Manager → SELECT apenas (leitura dos membros)
DROP POLICY IF EXISTS "seller_team_members_manager_read" ON public.seller_team_members;
CREATE POLICY "seller_team_members_manager_read"
    ON public.seller_team_members
    FOR SELECT
    TO authenticated
    USING (
        public.check_seller_team_role_level(seller_id, auth.uid()::text, 'manager')
    );

-- Self → SELECT do próprio registro
DROP POLICY IF EXISTS "seller_team_members_self_read" ON public.seller_team_members;
CREATE POLICY "seller_team_members_self_read"
    ON public.seller_team_members
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid()::text);


-- =====================================================
-- 5. Backfill — INSERT owners existentes como membros
-- =====================================================

INSERT INTO public.seller_team_members (
    id, seller_id, user_id, role, status, active,
    invited_by, validation_status, validated_at, joined_at,
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
    '{"can_manage_clients": true, "can_manage_pendencias": true, "can_view_financials": true, "can_manage_team": true}'::jsonb
FROM public.seller_profiles sp
WHERE NOT EXISTS (
    SELECT 1 FROM public.seller_team_members stm
    WHERE stm.seller_id = sp.id AND stm.user_id = sp.user_id
)
ON CONFLICT (seller_id, user_id) DO NOTHING;


-- =====================================================
-- 6. Security: restrict function execution
-- =====================================================

REVOKE EXECUTE ON FUNCTION public.is_seller_team_member(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_seller_team_member(TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.check_seller_team_role_level(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_seller_team_role_level(TEXT, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_seller_team_permission(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_seller_team_permission(TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.seller_team_role_level(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_team_role_level(TEXT) TO authenticated;
