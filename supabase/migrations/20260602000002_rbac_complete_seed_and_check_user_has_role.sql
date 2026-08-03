-- =============================================================================
-- Migration: RBAC — Seed Completo + Função check_user_has_role
-- Desc: Adiciona roles/permissões faltantes do 002_rbac_seed e cria a função
--       check_user_has_role (chamada por userRoleService.checkUserHasRole).
--       Idempotente — seguro reexecutar.
-- Autor: infra-agent
-- Data: 2026-06-02
-- =============================================================================

-- =============================================================================
-- 1. FUNÇÃO check_user_has_role
--    Chamada por: userRoleService.js linha 33
--    Parâmetros: p_user_id, p_role_name, p_context_type ('global'|'caixinha'),
--                p_resource_id (caixinha_id quando context_type = 'caixinha')
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_user_has_role(
  p_user_id      text,
  p_role_name    text,
  p_context_type text DEFAULT 'global',
  p_resource_id  text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    -- Contexto de caixinha: delega para check_caixinha_role
    WHEN LOWER(p_context_type) = 'caixinha' AND p_resource_id IS NOT NULL THEN
      public.check_caixinha_role(p_user_id, p_resource_id, p_role_name)

    -- Contexto global (padrão): verifica user_roles
    ELSE
      public.check_global_role(p_user_id, p_role_name)
  END;
$$;

COMMENT ON FUNCTION public.check_user_has_role IS
  'Verificação unificada de role: delega para check_global_role (contexto global) '
  'ou check_caixinha_role (contexto caixinha). Chamada por userRoleService.js.';

-- =============================================================================
-- 2. CORRIGIR is_system_role para roles existentes com valor incorreto
--    (client e support foram inseridos com is_system_role=false)
-- =============================================================================

UPDATE public.roles SET is_system_role = true  WHERE id = 'client'  AND is_system_role = false;
UPDATE public.roles SET is_system_role = true  WHERE id = 'support' AND is_system_role = false;

-- =============================================================================
-- 3. ROLES FALTANTES
--    Existentes: admin, member, moderator, client, support
--    Faltam: seller, caixinhaManager, caixinhaMember, caixinhaModerator
-- =============================================================================

INSERT INTO public.roles (id, name, description, is_system_role) VALUES
  ('seller',            'Seller',            'Vendedor com acesso ao marketplace',       true),
  ('caixinhaManager',   'CaixinhaManager',   'Administrador de uma caixinha específica', false),
  ('caixinhaMember',    'CaixinhaMember',    'Membro de uma caixinha específica',        false),
  ('caixinhaModerator', 'CaixinhaModerator', 'Moderador de uma caixinha específica',     false)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 4. PERMISSÕES FALTANTES
--    Existentes: caixinha:create, caixinha:read, caixinha:update,
--                loan:request, loan:approve
--    Inserindo as 25 faltantes do seed completo (002_rbac_seed.sql)
-- =============================================================================

INSERT INTO public.permissions (id, resource, action, description) VALUES

  -- Admin & backoffice
  ('admin:access',            'admin',      'access',         'Acesso ao painel administrativo'),

  -- Role management
  ('role:create',             'role',       'create',         'Criar roles no sistema'),
  ('role:read',               'role',       'read',           'Visualizar roles do sistema'),
  ('role:update',             'role',       'update',         'Atualizar roles do sistema'),
  ('role:delete',             'role',       'delete',         'Remover roles do sistema'),

  -- User management
  ('user:create',             'user',       'create',         'Criar usuários'),
  ('user:read',               'user',       'read',           'Visualizar informações de usuários'),
  ('user:update',             'user',       'update',         'Atualizar informações de usuários'),
  ('user:delete',             'user',       'delete',         'Remover usuários'),

  -- Permission management
  ('permission:create',       'permission', 'create',         'Criar permissões no sistema'),
  ('permission:read',         'permission', 'read',           'Visualizar permissões do sistema'),
  ('permission:update',       'permission', 'update',         'Atualizar permissões do sistema'),
  ('permission:delete',       'permission', 'delete',         'Remover permissões do sistema'),

  -- Caixinha (faltantes)
  ('caixinha:delete',         'caixinha',   'delete',         'Remover caixinha'),
  ('caixinha:manage_members', 'caixinha',   'manage_members', 'Gerenciar membros de caixinha'),
  ('caixinha:manage_loans',   'caixinha',   'manage_loans',   'Gerenciar empréstimos de caixinha'),
  ('caixinha:view_reports',   'caixinha',   'view_reports',   'Visualizar relatórios de caixinha'),

  -- Product (marketplace)
  ('product:create',          'product',    'create',         'Criar produto'),
  ('product:read',            'product',    'read',           'Visualizar produto'),
  ('product:update',          'product',    'update',         'Atualizar produto'),
  ('product:delete',          'product',    'delete',         'Remover produto'),

  -- Order (marketplace)
  ('order:create',            'order',      'create',         'Criar pedido'),
  ('order:read',              'order',      'read',           'Visualizar pedido'),
  ('order:update',            'order',      'update',         'Atualizar pedido'),
  ('order:cancel',            'order',      'cancel',         'Cancelar pedido'),

  -- Support
  ('support:access',          'support',    'access',         'Acesso ao painel de suporte'),
  ('support:manage_tickets',  'support',    'manage_tickets', 'Gerenciar tickets de suporte'),
  ('support:view_logs',       'support',    'view_logs',      'Visualizar logs do sistema')

ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 5. ROLE_PERMISSIONS — associações faltantes
--    Usa ON CONFLICT DO NOTHING para ser idempotente.
-- =============================================================================

INSERT INTO public.role_permissions (role_id, permission_id) VALUES

  -- client (6) — papel básico da plataforma
  ('client', 'user:read'),
  ('client', 'user:update'),
  ('client', 'caixinha:read'),
  ('client', 'product:read'),
  ('client', 'order:create'),
  ('client', 'order:read'),

  -- admin (9) — backoffice completo
  ('admin', 'admin:access'),
  ('admin', 'role:create'),
  ('admin', 'role:read'),
  ('admin', 'role:update'),
  ('admin', 'role:delete'),
  ('admin', 'permission:create'),
  ('admin', 'permission:read'),
  ('admin', 'permission:update'),
  ('admin', 'permission:delete'),

  -- support (7)
  ('support', 'support:access'),
  ('support', 'support:manage_tickets'),
  ('support', 'support:view_logs'),
  ('support', 'user:read'),
  ('support', 'caixinha:read'),
  ('support', 'product:read'),
  ('support', 'order:read'),

  -- seller (6) — marketplace
  ('seller', 'product:create'),
  ('seller', 'product:read'),
  ('seller', 'product:update'),
  ('seller', 'product:delete'),
  ('seller', 'order:read'),
  ('seller', 'order:update'),

  -- caixinhaManager (6) — escopo de caixinha
  ('caixinhaManager', 'caixinha:read'),
  ('caixinhaManager', 'caixinha:update'),
  ('caixinhaManager', 'caixinha:delete'),
  ('caixinhaManager', 'caixinha:manage_members'),
  ('caixinhaManager', 'caixinha:manage_loans'),
  ('caixinhaManager', 'caixinha:view_reports'),

  -- caixinhaMember (1)
  ('caixinhaMember', 'caixinha:read'),

  -- caixinhaModerator (3)
  ('caixinhaModerator', 'caixinha:read'),
  ('caixinhaModerator', 'caixinha:manage_members'),
  ('caixinhaModerator', 'caixinha:view_reports')

ON CONFLICT (role_id, permission_id) DO NOTHING;

-- =============================================================================
-- 6. VERIFICAÇÃO PÓS-MIGRATION (executar manualmente para confirmar)
-- =============================================================================
/*
SELECT 'roles'            AS tabela, count(*) AS total FROM public.roles
UNION ALL
SELECT 'permissions',               count(*)           FROM public.permissions
UNION ALL
SELECT 'role_permissions',          count(*)           FROM public.role_permissions;

-- Esperado mínimo:
--   roles            | 9   (admin, member, moderator, client, support, seller, caixinhaManager, caixinhaMember, caixinhaModerator)
--   permissions      | 32+ (5 existentes + 25 novas + 2 do seed original: loan:request, loan:approve)
--   role_permissions | 38+

-- Testar a nova função:
SELECT public.check_user_has_role('dummy-uid', 'admin');              -- false
SELECT public.check_user_has_role('dummy-uid', 'membro', 'caixinha', 'caixinha-id'); -- false
*/
