-- =============================================================================
-- Seed: RBAC — Roles, Permissions, Role-Permissions
-- Fonte: backend/eloscloudapp/config/data/initialData.js
-- Estratégia: ON CONFLICT DO NOTHING — idempotente, safe para reexecutar
-- Data: 2026-05-13
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ROLES (7 roles do sistema)
-- -----------------------------------------------------------------------------

INSERT INTO public.roles (id, name, description, is_system_role) VALUES
  ('client',             'Client',             'Usuário básico da plataforma',                          true),
  ('admin',              'Admin',              'Administrador do sistema com acesso completo',           true),
  ('support',            'Support',            'Equipe de suporte com acesso limitado a funções admin', true),
  ('seller',             'Seller',             'Vendedor com acesso ao marketplace',                    true),
  ('caixinhaManager',    'CaixinhaManager',    'Administrador de uma caixinha específica',              false),
  ('caixinhaMember',     'CaixinhaMember',     'Membro de uma caixinha específica',                     false),
  ('caixinhaModerator',  'CaixinhaModerator',  'Moderador de uma caixinha específica',                  false)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. PERMISSIONS (30 permissões)
-- Formato: id = 'resource:action' (igual ao permissions.id no código Node.js)
-- -----------------------------------------------------------------------------

INSERT INTO public.permissions (id, resource, action, description) VALUES
  -- Admin
  ('admin:access',              'admin',      'access',         'Acesso ao painel administrativo'),

  -- Role management
  ('role:create',               'role',       'create',         'Criar roles no sistema'),
  ('role:read',                 'role',       'read',           'Visualizar roles do sistema'),
  ('role:update',               'role',       'update',         'Atualizar roles do sistema'),
  ('role:delete',               'role',       'delete',         'Remover roles do sistema'),

  -- User management
  ('user:create',               'user',       'create',         'Criar usuários'),
  ('user:read',                 'user',       'read',           'Visualizar informações de usuários'),
  ('user:update',               'user',       'update',         'Atualizar informações de usuários'),
  ('user:delete',               'user',       'delete',         'Remover usuários'),

  -- Permission management
  ('permission:create',         'permission', 'create',         'Criar permissões no sistema'),
  ('permission:read',           'permission', 'read',           'Visualizar permissões do sistema'),
  ('permission:update',         'permission', 'update',         'Atualizar permissões do sistema'),
  ('permission:delete',         'permission', 'delete',         'Remover permissões do sistema'),

  -- Caixinha
  ('caixinha:create',           'caixinha',   'create',         'Criar caixinha'),
  ('caixinha:read',             'caixinha',   'read',           'Visualizar caixinha'),
  ('caixinha:update',           'caixinha',   'update',         'Atualizar caixinha'),
  ('caixinha:delete',           'caixinha',   'delete',         'Remover caixinha'),
  ('caixinha:manage_members',   'caixinha',   'manage_members', 'Gerenciar membros de caixinha'),
  ('caixinha:manage_loans',     'caixinha',   'manage_loans',   'Gerenciar empréstimos de caixinha'),
  ('caixinha:view_reports',     'caixinha',   'view_reports',   'Visualizar relatórios de caixinha'),

  -- Product (marketplace)
  ('product:create',            'product',    'create',         'Criar produto'),
  ('product:read',              'product',    'read',           'Visualizar produto'),
  ('product:update',            'product',    'update',         'Atualizar produto'),
  ('product:delete',            'product',    'delete',         'Remover produto'),

  -- Order (marketplace)
  ('order:create',              'order',      'create',         'Criar pedido'),
  ('order:read',                'order',      'read',           'Visualizar pedido'),
  ('order:update',              'order',      'update',         'Atualizar pedido'),
  ('order:cancel',              'order',      'cancel',         'Cancelar pedido'),

  -- Support
  ('support:access',            'support',    'access',         'Acesso ao painel de suporte'),
  ('support:manage_tickets',    'support',    'manage_tickets', 'Gerenciar tickets de suporte'),
  ('support:view_logs',         'support',    'view_logs',      'Visualizar logs do sistema')

ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. ROLE_PERMISSIONS (38 associações)
-- Nota: roles de caixinha (Manager/Member/Moderator) têm permissões aqui,
--       mas o enforcement no escopo de caixinha é feito via caixinha_members.
--       Essas entradas documentam as capacidades semânticas de cada role.
-- -----------------------------------------------------------------------------

INSERT INTO public.role_permissions (role_id, permission_id) VALUES

  -- Client (6)
  ('client', 'user:read'),
  ('client', 'user:update'),
  ('client', 'caixinha:read'),
  ('client', 'product:read'),
  ('client', 'order:create'),
  ('client', 'order:read'),

  -- Admin (9) — acesso total ao backoffice
  ('admin', 'admin:access'),
  ('admin', 'role:create'),
  ('admin', 'role:read'),
  ('admin', 'role:update'),
  ('admin', 'role:delete'),
  ('admin', 'permission:create'),
  ('admin', 'permission:read'),
  ('admin', 'permission:update'),
  ('admin', 'permission:delete'),

  -- Support (7)
  ('support', 'support:access'),
  ('support', 'support:manage_tickets'),
  ('support', 'support:view_logs'),
  ('support', 'user:read'),
  ('support', 'caixinha:read'),
  ('support', 'product:read'),
  ('support', 'order:read'),

  -- Seller (6)
  ('seller', 'product:create'),
  ('seller', 'product:read'),
  ('seller', 'product:update'),
  ('seller', 'product:delete'),
  ('seller', 'order:read'),
  ('seller', 'order:update'),

  -- CaixinhaManager (6) — escopo de caixinha, enforced via caixinha_members.role='admin'
  ('caixinhaManager', 'caixinha:read'),
  ('caixinhaManager', 'caixinha:update'),
  ('caixinhaManager', 'caixinha:delete'),
  ('caixinhaManager', 'caixinha:manage_members'),
  ('caixinhaManager', 'caixinha:manage_loans'),
  ('caixinhaManager', 'caixinha:view_reports'),

  -- CaixinhaMember (1) — escopo de caixinha, enforced via caixinha_members.role='membro'
  ('caixinhaMember', 'caixinha:read'),

  -- CaixinhaModerator (3) — escopo de caixinha, enforced via caixinha_members.role='moderador'
  ('caixinhaModerator', 'caixinha:read'),
  ('caixinhaModerator', 'caixinha:manage_members'),
  ('caixinhaModerator', 'caixinha:view_reports')

ON CONFLICT (role_id, permission_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. Verificação pós-seed (executar manualmente para confirmar)
-- -----------------------------------------------------------------------------

/*
SELECT 'roles' AS tabela, count(*) AS total FROM public.roles
UNION ALL
SELECT 'permissions', count(*) FROM public.permissions
UNION ALL
SELECT 'role_permissions', count(*) FROM public.role_permissions;

-- Esperado:
--   roles            | 7
--   permissions      | 30
--   role_permissions | 38
*/
