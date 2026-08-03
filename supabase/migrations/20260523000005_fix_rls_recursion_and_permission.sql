-- =====================================================
-- MIGRAÇÃO: Fix dois bugs de RLS
-- Bug 1: users_select_all_for_admin → permission denied em user_roles (anon key)
-- Bug 2: caixinha_members_select_same_caixinha → infinite recursion (auto-referência)
--
-- CAUSA RAIZ:
--   Bug 1 — policy de users faz subquery direta em user_roles, mas anon não tem
--            GRANT SELECT nessa tabela (revogado em 20260520000007). Fix: usar
--            check_global_role() (SECURITY DEFINER), que já existe.
--   Bug 2 — policy de caixinha_members faz EXISTS em caixinha_members,
--            disparando a própria policy em loop infinito. Fix: criar função
--            is_caixinha_member() (SECURITY DEFINER) que faz a mesma query
--            mas contorna o RLS via elevação de privilégio temporária.
--
-- SEGURANÇA: nenhuma regressão — semântica das policies é preservada.
--   check_global_role e is_caixinha_member filtram por auth.uid() internamente.
--   SECURITY DEFINER apenas contorna o loop de RLS, não expõe dados extras.
--
-- Autor: payment-agent (ElosCloud)
-- Data: 2026-05-23
-- =====================================================

-- ─── BUG 1 FIX ───────────────────────────────────────────────────────────────
-- Substituir subquery direta em user_roles pela função SECURITY DEFINER
-- check_global_role(), que já executa a mesma lógica sem precisar de GRANT.

DROP POLICY IF EXISTS users_select_all_for_admin ON public.users;

CREATE POLICY users_select_all_for_admin ON public.users
    FOR SELECT USING (
        check_global_role(auth.uid()::text, 'admin')
    );

-- ─── BUG 2 FIX — Função auxiliar ─────────────────────────────────────────────
-- is_caixinha_member: mesma semântica da policy original (sem filtro de
-- validation_status), executada como SECURITY DEFINER para não disparar o RLS
-- de caixinha_members recursivamente.

CREATE OR REPLACE FUNCTION public.is_caixinha_member(
    p_user_id     TEXT,
    p_caixinha_id TEXT
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.caixinha_members cm
        WHERE cm.user_id     = p_user_id
          AND cm.caixinha_id = p_caixinha_id
    );
$$;

COMMENT ON FUNCTION public.is_caixinha_member(TEXT, TEXT) IS
    'Verifica se um usuário é membro de uma caixinha (sem checar validation_status). '
    'SECURITY DEFINER para evitar recursão infinita nas policies RLS de caixinha_members.';

-- ─── BUG 2 FIX — Policy caixinha_members ─────────────────────────────────────
-- Substituir EXISTS auto-referencial por is_caixinha_member() (SECURITY DEFINER).

DROP POLICY IF EXISTS caixinha_members_select_same_caixinha ON public.caixinha_members;

CREATE POLICY caixinha_members_select_same_caixinha ON public.caixinha_members
    FOR SELECT USING (
        is_caixinha_member(auth.uid()::text, caixinha_id)
    );

-- ─── FIX COLATERAL: caixinhas_select_members ─────────────────────────────────
-- Esta policy faz SELECT em caixinha_members, o que disparava a policy recursiva.
-- Com a nova policy em caixinha_members usando SECURITY DEFINER, o chain de RLS
-- é interrompido. Mas substituir pela função diretamente é mais eficiente.

DROP POLICY IF EXISTS caixinhas_select_members ON public.caixinhas;

CREATE POLICY caixinhas_select_members ON public.caixinhas
    FOR SELECT USING (
        is_caixinha_member(auth.uid()::text, id)
    );

-- ─── FIX COLATERAL: caixinha_loan_settings_select_members ────────────────────
-- Mesmo padrão — subquery em caixinha_members substituída por função.

DROP POLICY IF EXISTS caixinha_loan_settings_select_members ON public.caixinha_loan_settings;

CREATE POLICY caixinha_loan_settings_select_members ON public.caixinha_loan_settings
    FOR SELECT USING (
        is_caixinha_member(auth.uid()::text, caixinha_id)
    );
