-- =============================================================================
-- Migration: RBAC Check Functions & Schema Updates
-- Desc: Adiciona campos de ciclo de vida e funções RPC para verificação de permissões.
-- Autor: Gemini CLI (Baseado na RBAC Option B)
-- Data: 2026-05-14
-- =============================================================================

-- 1. user_roles — adicionar campos de ciclo de vida
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'validated',
  ADD COLUMN IF NOT EXISTS validated_at      timestamp with time zone,
  ADD COLUMN IF NOT EXISTS expires_at        timestamp with time zone,
  ADD COLUMN IF NOT EXISTS metadata          jsonb NOT NULL DEFAULT '{}';

-- 2. caixinha_members — adicionar validation_status
ALTER TABLE public.caixinha_members
  ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS validated_at      timestamp with time zone;

-- 3. Índices para performance
CREATE INDEX IF NOT EXISTS idx_user_roles_user_validation
  ON public.user_roles(user_id, validation_status);

CREATE INDEX IF NOT EXISTS idx_caixinha_members_user_caixinha_validation
  ON public.caixinha_members(user_id, caixinha_id, validation_status);

-- 4. Funções auxiliares PostgreSQL (RPC)

-- 4a. check_global_role
CREATE OR REPLACE FUNCTION public.check_global_role(
  p_user_id text,
  p_role_name text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND (LOWER(r.name) = LOWER(p_role_name) OR LOWER(r.id) = LOWER(p_role_name))
      AND ur.validation_status = 'validated'
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
  );
$$;

-- 4b. check_caixinha_role
CREATE OR REPLACE FUNCTION public.check_caixinha_role(
  p_user_id    text,
  p_caixinha_id text,
  p_role_name  text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.caixinha_members cm
    WHERE cm.user_id    = p_user_id
      AND cm.caixinha_id = p_caixinha_id
      AND LOWER(cm.role) = LOWER(p_role_name)
      AND cm.active      = true
      AND cm.validation_status = 'validated'
  );
$$;

-- 4c. check_caixinha_access
CREATE OR REPLACE FUNCTION public.check_caixinha_access(
  p_user_id     text,
  p_caixinha_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.caixinha_members cm
    WHERE cm.user_id    = p_user_id
      AND cm.caixinha_id = p_caixinha_id
      AND cm.active      = true
      AND cm.validation_status = 'validated'
  );
$$;

-- 4d. check_caixinha_pending
CREATE OR REPLACE FUNCTION public.check_caixinha_pending(
  p_user_id     text,
  p_caixinha_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.caixinha_members cm
    WHERE cm.user_id    = p_user_id
      AND cm.caixinha_id = p_caixinha_id
      AND cm.active      = true
      AND cm.validation_status = 'pending'
  );
$$;

-- 4e. check_permission
CREATE OR REPLACE FUNCTION public.check_permission(
  p_user_id        text,
  p_permission_name text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p
      ON p.id = rp.permission_id
     AND LOWER(p.id) = LOWER(p_permission_name)
    WHERE ur.user_id = p_user_id
      AND ur.validation_status = 'validated'
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
  );
$$;
