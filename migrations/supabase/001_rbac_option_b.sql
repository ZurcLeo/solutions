-- =============================================================================
-- Migration: RBAC Option B
-- Desc: Adapta o schema para RBAC em duas camadas:
--       • user_roles  → roles globais (Admin, Client, Seller, Support)
--       • caixinha_members → roles de escopo de caixinha (Manager, Member, Moderator)
-- Data: 2026-05-13
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. user_roles — adicionar campos de ciclo de vida para roles globais
--    Seller começa como 'pending' (requer validação de dados)
--    Client, Admin, Support entram como 'validated' diretamente
-- -----------------------------------------------------------------------------

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'validated',
  ADD COLUMN IF NOT EXISTS validated_at      timestamp with time zone,
  ADD COLUMN IF NOT EXISTS expires_at        timestamp with time zone,
  ADD COLUMN IF NOT EXISTS metadata          jsonb NOT NULL DEFAULT '{}';

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_validation_status_check
    CHECK (validation_status IN ('pending', 'validated', 'rejected'));

-- Registros migrados já existentes são tratados como validados
UPDATE public.user_roles
  SET validation_status = 'validated',
      validated_at      = granted_at
  WHERE validation_status = 'validated'
    AND validated_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. caixinha_members — adicionar validation_status para o fluxo bancário
--    Novos membros entram como 'pending' até validar dados bancários
--    Membros existentes e ativos recebem 'validated' automaticamente
-- -----------------------------------------------------------------------------

ALTER TABLE public.caixinha_members
  ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS validated_at      timestamp with time zone;

ALTER TABLE public.caixinha_members
  ADD CONSTRAINT caixinha_members_validation_status_check
    CHECK (validation_status IN ('pending', 'validated', 'rejected'));

-- Constraint para garantir valores válidos no campo role
-- (pode ser substituído por FK para uma tabela caixinha_roles se necessário no futuro)
ALTER TABLE public.caixinha_members
  ADD CONSTRAINT caixinha_members_role_check
    CHECK (role IN ('membro', 'admin', 'moderador'));

-- Membros já ativos na plataforma foram validados — marcar como validated
UPDATE public.caixinha_members
  SET validation_status = 'validated',
      validated_at      = joined_at
  WHERE active = true
    AND status = 'ativo'
    AND validation_status = 'pending';

-- -----------------------------------------------------------------------------
-- 3. role_assignment_audit — adicionar FKs que estavam faltando
--    ON DELETE SET NULL: o histórico sobrevive mesmo se user/role for deletado
-- -----------------------------------------------------------------------------

ALTER TABLE public.role_assignment_audit
  ADD CONSTRAINT IF NOT EXISTS role_assignment_audit_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT IF NOT EXISTS role_assignment_audit_role_id_fkey
    FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE SET NULL,
  ADD CONSTRAINT IF NOT EXISTS role_assignment_audit_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 4. Índices — performance para as queries do middleware RBAC
-- -----------------------------------------------------------------------------

-- user_roles: lookup principal (userId + validation)
CREATE INDEX IF NOT EXISTS idx_user_roles_user_validation
  ON public.user_roles(user_id, validation_status);

-- user_roles: lookup por role + status (usado em migrações admin)
CREATE INDEX IF NOT EXISTS idx_user_roles_role_validation
  ON public.user_roles(role_id, validation_status);

-- caixinha_members: lookup principal do middleware checkBankValidation e checkRole
CREATE INDEX IF NOT EXISTS idx_caixinha_members_user_caixinha_validation
  ON public.caixinha_members(user_id, caixinha_id, validation_status);

-- caixinha_members: listar membros de uma caixinha (usado em caixinhaService)
CREATE INDEX IF NOT EXISTS idx_caixinha_members_caixinha_active
  ON public.caixinha_members(caixinha_id, active, validation_status);

-- role_assignment_audit: histórico por usuário
CREATE INDEX IF NOT EXISTS idx_role_audit_user_id
  ON public.role_assignment_audit(user_id, changed_at DESC);

-- -----------------------------------------------------------------------------
-- 5. Funções auxiliares PostgreSQL
--    Encapsulam as queries RBAC — usadas pelo middleware Node.js E por RLS policies
-- -----------------------------------------------------------------------------

-- 5a. check_global_role: usuário tem role global validada?
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
      AND r.name     = p_role_name
      AND ur.validation_status = 'validated'
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
  );
$$;

-- 5b. check_caixinha_role: usuário tem role de membro em uma caixinha específica?
--    p_role_name: 'membro' | 'admin' | 'moderador'
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
      AND cm.role        = p_role_name
      AND cm.active      = true
      AND cm.validation_status = 'validated'
  );
$$;

-- 5c. check_caixinha_access: usuário tem QUALQUER role validada em uma caixinha?
--    (usado pelo checkBankValidation middleware)
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

-- 5d. check_caixinha_pending: usuário tem role pendente em uma caixinha?
--    (usado para retornar 'requiresValidation: true')
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

-- 5e. check_permission: usuário tem permissão específica (global)?
--    Resolve: user → user_roles (validated) → role_permissions → permissions
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
     AND p.id = p_permission_name        -- permissions.id é 'resource:action'
    WHERE ur.user_id = p_user_id
      AND ur.validation_status = 'validated'
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
  );
$$;

-- -----------------------------------------------------------------------------
-- 6. Mapeamento semântico: roles RBAC do Node.js → campos caixinha_members
--    Documentado como VIEW para referência — não usada em runtime
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_caixinha_role_mapping AS
SELECT
  'CaixinhaManager'   AS rbac_role_name, 'admin'     AS members_role_value, true  AS is_admin,
  'Escopo: caixinha'  AS scope           UNION ALL
SELECT 'CaixinhaModerator', 'moderador', false, 'Escopo: caixinha' UNION ALL
SELECT 'CaixinhaMember',    'membro',    false, 'Escopo: caixinha';

COMMENT ON VIEW public.v_caixinha_role_mapping IS
  'Mapeamento entre nomes de roles RBAC do Node.js e valores do campo caixinha_members.role';
