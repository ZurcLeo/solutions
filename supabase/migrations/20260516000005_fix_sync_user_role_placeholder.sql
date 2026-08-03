-- =====================================================
-- MIGRAÇÃO: Corrige sync_user_role e sync_caixinha_member
-- Problema: RPCs inseriam placeholder pending_sync_*@eloscloud.com
--           quando o usuário ainda não existia em public.users,
--           contaminando 31+ perfis com email e full_name falsos.
-- Fix: Verifica existência do usuário antes de qualquer operação.
--      Se não existe, retorna aviso sem criar placeholder.
--      O usuário será sincronizado quando completar o registro via User.create().
-- Data: 2026-05-16
-- =====================================================

-- =====================================================
-- 1. sync_user_role (corrigida)
-- =====================================================
CREATE OR REPLACE FUNCTION public.sync_user_role(
    p_user_id TEXT,
    p_role_name TEXT,
    p_context_type TEXT DEFAULT 'global',
    p_resource_id TEXT DEFAULT NULL,
    p_validation_status TEXT DEFAULT 'validated'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_role_id TEXT;
    v_result JSONB;
    v_user_exists BOOLEAN;
BEGIN
    -- 1. Verificar se o usuário existe — NÃO criar placeholder
    SELECT EXISTS(SELECT 1 FROM public.users WHERE id = p_user_id) INTO v_user_exists;

    IF NOT v_user_exists THEN
        RETURN jsonb_build_object(
            'success', false,
            'user_id', p_user_id,
            'warning', 'user_not_found_in_users_table',
            'message', 'Usuário não encontrado em public.users. Role não sincronizada. Será re-tentada quando o usuário completar o registro.'
        );
    END IF;

    -- 2. Normalizar e buscar o role_id
    SELECT id INTO v_role_id
    FROM public.roles
    WHERE id = LOWER(p_role_name) OR LOWER(name) = LOWER(p_role_name)
    LIMIT 1;

    IF v_role_id IS NULL THEN
        v_role_id := LOWER(p_role_name);
        INSERT INTO public.roles (id, name, description, is_system_role)
        VALUES (v_role_id, p_role_name, 'Role sincronizada via Firestore', false)
        ON CONFLICT (id) DO NOTHING;
    END IF;

    -- 3. Inserir ou atualizar na user_roles
    INSERT INTO public.user_roles (user_id, role_id, granted_at)
    VALUES (p_user_id, v_role_id, NOW())
    ON CONFLICT (user_id, role_id) DO UPDATE
    SET granted_at = NOW();

    v_result := jsonb_build_object(
        'success', true,
        'user_id', p_user_id,
        'role_id', v_role_id,
        'context_type', p_context_type,
        'resource_id', p_resource_id,
        'status', p_validation_status
    );

    RETURN v_result;
END;
$$;

-- =====================================================
-- 2. sync_caixinha_member (corrigida)
-- =====================================================
CREATE OR REPLACE FUNCTION public.sync_caixinha_member(
    p_user_id TEXT,
    p_caixinha_id TEXT,
    p_role_name TEXT,
    p_validation_status TEXT DEFAULT 'pending'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSONB;
    v_user_exists BOOLEAN;
BEGIN
    -- 1. Verificar se o usuário existe — NÃO criar placeholder
    SELECT EXISTS(SELECT 1 FROM public.users WHERE id = p_user_id) INTO v_user_exists;

    IF NOT v_user_exists THEN
        RETURN jsonb_build_object(
            'success', false,
            'user_id', p_user_id,
            'caixinha_id', p_caixinha_id,
            'warning', 'user_not_found_in_users_table',
            'message', 'Usuário não encontrado em public.users. Membro não sincronizado. Será re-tentado quando o usuário completar o registro.'
        );
    END IF;

    -- 2. Garantir que a caixinha existe
    INSERT INTO public.caixinhas (id, name, admin_id, created_at)
    VALUES (p_caixinha_id, 'Sincronizando...', p_user_id, NOW())
    ON CONFLICT (id) DO NOTHING;

    -- 3. Inserir ou atualizar membro
    INSERT INTO public.caixinha_members (
        id,
        caixinha_id,
        user_id,
        role,
        status,
        active,
        is_admin,
        joined_at
    )
    VALUES (
        p_caixinha_id || '_' || p_user_id,
        p_caixinha_id,
        p_user_id,
        LOWER(p_role_name),
        CASE WHEN p_validation_status = 'validated' THEN 'ativo' ELSE 'pendente' END,
        TRUE,
        (LOWER(p_role_name) = 'admin' OR LOWER(p_role_name) = 'caixinhamanager'),
        NOW()
    )
    ON CONFLICT (caixinha_id, user_id) DO UPDATE SET
        role = EXCLUDED.role,
        status = EXCLUDED.status,
        is_admin = EXCLUDED.is_admin,
        active = TRUE;

    v_result := jsonb_build_object(
        'success', true,
        'user_id', p_user_id,
        'caixinha_id', p_caixinha_id,
        'role', p_role_name,
        'status', p_validation_status
    );

    RETURN v_result;
END;
$$;
