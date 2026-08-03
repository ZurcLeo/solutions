-- =====================================================
-- MIGRAÇÃO: Domínio Identidade (ElosCloud)
-- Descrição: Tabelas de usuários, papéis (roles), permissões
--            e seus relacionamentos.
-- Autor: Léo (ElosCloud)
-- Data: 2026-05-13
-- =====================================================

-- Habilita extensões úteis (se necessário)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 1. TABELA users (espelha o uid do Firebase Auth)
-- =====================================================
CREATE TABLE users (
    id                TEXT PRIMARY KEY,          -- mesmo uid do Firebase Auth
    email             TEXT UNIQUE NOT NULL,
    full_name         TEXT,
    avatar_url        TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    last_sign_in_at   TIMESTAMPTZ,
    is_active         BOOLEAN DEFAULT TRUE,
    metadata          JSONB                      -- dados extras anonimizados
);

-- Índices
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_created_at ON users(created_at);

-- =====================================================
-- 2. TABELA roles (papéis do sistema)
-- =====================================================
CREATE TABLE roles (
    id              TEXT PRIMARY KEY,            -- ex: 'admin', 'member', 'moderator'
    name            TEXT UNIQUE NOT NULL,
    description     TEXT,
    is_system_role  BOOLEAN DEFAULT FALSE,       -- roles de sistema não podem ser deletadas
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 3. TABELA permissions (ações + recursos)
-- =====================================================
CREATE TABLE permissions (
    id              TEXT PRIMARY KEY,            -- ex: 'caixinha:create'
    resource        TEXT NOT NULL,               -- ex: 'caixinha', 'loan', 'user'
    action          TEXT NOT NULL,               -- ex: 'create', 'read', 'update', 'delete'
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(resource, action)
);

-- =====================================================
-- 4. TABELAS DE JUNÇÃO (M:N)
-- =====================================================

-- Usuário <-> Papéis
CREATE TABLE user_roles (
    user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
    role_id         TEXT REFERENCES roles(id) ON DELETE CASCADE,
    granted_at      TIMESTAMPTZ DEFAULT NOW(),
    granted_by      TEXT,                        -- uid do admin que concedeu (opcional)
    PRIMARY KEY (user_id, role_id)
);

-- Papel <-> Permissões
CREATE TABLE role_permissions (
    role_id         TEXT REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   TEXT REFERENCES permissions(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (role_id, permission_id)
);

-- =====================================================
-- 5. TRIGGERS E CONSTRAINTS (Imutabilidade, Auditoria)
-- =====================================================

-- 5.1 Impedir deleção de roles de sistema
CREATE OR REPLACE FUNCTION prevent_system_role_deletion()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_system_role = TRUE THEN
        RAISE EXCEPTION 'Cannot delete a system role (%)', OLD.id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_prevent_system_role_deletion
    BEFORE DELETE ON roles
    FOR EACH ROW
    EXECUTE FUNCTION prevent_system_role_deletion();

-- 5.2 Trigger para atualizar `updated_at` na tabela users
CREATE OR REPLACE FUNCTION update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();

-- 5.3 (Opcional) Tabela de auditoria para mudanças de papel/permissão
CREATE TABLE role_assignment_audit (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT,
    role_id         TEXT,
    action          TEXT,               -- 'GRANT' ou 'REVOKE'
    changed_by      TEXT,               -- uid do admin
    changed_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 6. ROW LEVEL SECURITY (RLS) – Políticas Básicas
-- =====================================================

-- Ativar RLS nas tabelas
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- Políticas: cada usuário só pode ver/editar seus próprios dados (users)
-- Nota Técnica: auth.uid() retorna UUID. Se users.id for TEXT (Firebase UID), 
-- pode ser necessário cast: auth.uid()::text = id
CREATE POLICY users_select_self ON users
    FOR SELECT USING (auth.uid()::text = id);

CREATE POLICY users_update_self ON users
    FOR UPDATE USING (auth.uid()::text = id);

-- Usuários com papel 'admin' podem ver todos (exemplo simplificado)
CREATE POLICY users_select_all_for_admin ON users
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()::text AND r.id = 'admin'
        )
    );

-- =====================================================
-- 7. DADOS INICIAIS (SEED) – Roles e Permissões básicas
-- =====================================================

-- Inserir roles de sistema
INSERT INTO roles (id, name, description, is_system_role) VALUES
    ('admin', 'Administrador', 'Acesso total ao sistema', true),
    ('member', 'Membro', 'Acesso padrão a caixinhas e finanças', true),
    ('moderator', 'Moderador', 'Gerencia conteúdo social e disputas', true)
ON CONFLICT (id) DO NOTHING;

-- Inserir permissões básicas (exemplos)
INSERT INTO permissions (id, resource, action, description) VALUES
    ('caixinha:create', 'caixinha', 'create', 'Criar nova caixinha'),
    ('caixinha:read', 'caixinha', 'read', 'Visualizar caixinhas que participa'),
    ('caixinha:update', 'caixinha', 'update', 'Editar configurações da caixinha'),
    ('loan:request', 'loan', 'request', 'Solicitar empréstimo'),
    ('loan:approve', 'loan', 'approve', 'Aprovar empréstimo (admin/moderador)')
ON CONFLICT (id) DO NOTHING;

-- Associar permissões ao papel admin (todas)
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'admin', id FROM permissions
ON CONFLICT DO NOTHING;

-- Associar permissões ao papel member (apenas algumas)
INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('member', 'caixinha:read'),
    ('member', 'loan:request')
ON CONFLICT DO NOTHING;

-- =====================================================
-- 8. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================
COMMENT ON TABLE users IS 'Usuários da plataforma (ID sincronizado com Firebase Auth)';
COMMENT ON TABLE roles IS 'Papéis de usuário (sistema ou customizáveis)';
COMMENT ON TABLE permissions IS 'Permissões atômicas (recurso + ação)';
COMMENT ON TRIGGER trigger_prevent_system_role_deletion ON roles IS 'Impede deleção de roles marcadas como is_system_role';
