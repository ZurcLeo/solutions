-- =====================================================
-- MIGRAÇÃO: Funções de Sincronização RBAC (Dual-Write)
-- Descrição: Funções RPC para sincronizar dados do Firestore.
-- Autor: Gemini CLI
-- Data: 2026-05-14
-- =====================================================

-- =====================================================
-- 1. sync_user_role
-- Sincroniza papéis globais ou contextuais.
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
BEGIN
    -- 1. Garantir que o usuário existe na tabela users (auto-provisionamento básico se necessário)
    -- Nota: O ideal é que o usuário já tenha sido criado via authService.createUserProfile
    INSERT INTO public.users (id, email, created_at)
    VALUES (p_user_id, 'pending_sync_' || p_user_id || '@eloscloud.com', NOW())
    ON CONFLICT (id) DO NOTHING;

    -- 2. Normalizar e buscar o role_id
    -- Tentamos encontrar pelo ID ou pelo NAME (case-insensitive)
    SELECT id INTO v_role_id 
    FROM public.roles 
    WHERE id = LOWER(p_role_name) OR LOWER(name) = LOWER(p_role_name)
    LIMIT 1;

    -- Se a role não existir, criamos uma role de sistema básica
    IF v_role_id IS NULL THEN
        v_role_id := LOWER(p_role_name);
        INSERT INTO public.roles (id, name, description, is_system_role)
        VALUES (v_role_id, p_role_name, 'Role sincronizada via Firestore', false)
        ON CONFLICT (id) DO NOTHING;
    END IF;

    -- 3. Inserir ou atualizar na user_roles
    -- O esquema atual suporta user_id e role_id como PK
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
-- 2. sync_caixinha_member
-- Sincroniza membros e suas roles dentro de caixinhas.
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
BEGIN
    -- 1. Garantir que o usuário existe
    INSERT INTO public.users (id, email, created_at)
    VALUES (p_user_id, 'pending_sync_member_' || p_user_id || '@eloscloud.com', NOW())
    ON CONFLICT (id) DO NOTHING;

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
        p_caixinha_id || '_' || p_user_id, -- Gerar ID composto se não houver do Firestore
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
