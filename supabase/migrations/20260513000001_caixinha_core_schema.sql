-- =====================================================
-- MIGRAÇÃO: Domínio Caixinha Core (ElosCloud)
-- Descrição: Tabelas principais para gestão de caixinhas,
--            membros e configurações de empréstimo.
-- Autor: Léo (ElosCloud)
-- Data: 2026-05-13
-- =====================================================

-- =====================================================
-- 1. TABELA caixinhas
-- =====================================================
CREATE TABLE caixinhas (
    id                    TEXT PRIMARY KEY,          -- ID do Firestore ou gerado
    name                  TEXT NOT NULL,
    description           TEXT,
    admin_id              TEXT NOT NULL REFERENCES users(id),
    contribuicao_mensal   NUMERIC DEFAULT 0,
    saldo_total           NUMERIC DEFAULT 0,
    permite_emprestimos   BOOLEAN DEFAULT FALSE,
    dia_vencimento        INTEGER DEFAULT 1,
    valor_multa           NUMERIC DEFAULT 0,
    valor_juros           NUMERIC DEFAULT 0,
    distribuicao_tipo     TEXT DEFAULT 'padrão',
    duracao_meses         INTEGER DEFAULT 12,
    bank_account_active   BOOLEAN DEFAULT FALSE,
    governance_model      JSONB DEFAULT '{
        "type": "GROUP_DISPUTE",
        "quorumType": "PERCENTAGE",
        "quorumValue": 51,
        "adminHasTiebreaker": true,
        "canChangeAfterMembers": false
    }',
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_caixinhas_admin_id ON caixinhas(admin_id);
CREATE INDEX idx_caixinhas_created_at ON caixinhas(created_at);

-- =====================================================
-- 2. TABELA caixinha_members (Junction Table M:N)
-- =====================================================
CREATE TABLE caixinha_members (
    id              TEXT PRIMARY KEY,            -- ID do Firestore (memberId)
    caixinha_id     TEXT NOT NULL REFERENCES caixinhas(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT DEFAULT 'membro',       -- 'admin', 'membro'
    status          TEXT DEFAULT 'ativo',        -- 'ativo', 'inativo', 'pendente'
    active          BOOLEAN DEFAULT TRUE,
    is_admin        BOOLEAN DEFAULT FALSE,
    joined_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(caixinha_id, user_id)                 -- Um usuário só pode ser membro uma vez por caixinha
);

-- Índices
CREATE INDEX idx_caixinha_members_caixinha_id ON caixinha_members(caixinha_id);
CREATE INDEX idx_caixinha_members_user_id ON caixinha_members(user_id);

-- =====================================================
-- 3. TABELA caixinha_loan_settings
-- =====================================================
CREATE TABLE caixinha_loan_settings (
    caixinha_id             TEXT PRIMARY KEY REFERENCES caixinhas(id) ON DELETE CASCADE,
    valor_multa             NUMERIC DEFAULT 0,
    valor_juros             NUMERIC DEFAULT 0,
    limite_emprestimo       NUMERIC DEFAULT 0,
    prazo_maximo_emprestimo INTEGER DEFAULT 12,
    taxa_juros              NUMERIC DEFAULT 0,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 4. TRIGGERS (Auditoria e Updated At)
-- =====================================================

-- Trigger para atualizar `updated_at` na tabela caixinhas
CREATE TRIGGER trigger_caixinhas_updated_at
    BEFORE UPDATE ON caixinhas
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at(); -- Reutilizando a função da migração de identidade

-- Trigger para atualizar `updated_at` na tabela caixinha_loan_settings
CREATE TRIGGER trigger_caixinha_loan_settings_updated_at
    BEFORE UPDATE ON caixinha_loan_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();

-- 4.1 Garantir que o admin_id seja um membro com role 'admin'
CREATE OR REPLACE FUNCTION ensure_admin_is_member()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM caixinha_members 
        WHERE caixinha_id = NEW.id AND user_id = NEW.admin_id AND role = 'admin'
    ) THEN
        -- Nota: Durante a migração inicial, pode ser necessário desativar este trigger
        -- ou garantir que os membros sejam inseridos ANTES ou na mesma transação.
        -- Como o PostgreSQL verifica FKs no final da transação se forem DEFERRABLE,
        -- mas triggers rodam imediatamente.
        RAISE WARNING 'Admin % is not a member of caixinha % with role admin. Ensure member record exists.', NEW.admin_id, NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_ensure_admin_is_member
    AFTER INSERT OR UPDATE OF admin_id ON caixinhas
    FOR EACH ROW
    EXECUTE FUNCTION ensure_admin_is_member();

-- =====================================================
-- 5. ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE caixinhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE caixinha_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE caixinha_loan_settings ENABLE ROW LEVEL SECURITY;

-- 5.1 Políticas para caixinhas:
-- Qualquer membro da caixinha pode visualizá-la
CREATE POLICY caixinhas_select_members ON caixinhas
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM caixinha_members cm
            WHERE cm.caixinha_id = id AND cm.user_id = auth.uid()::text
        )
    );

-- Somente o admin pode atualizar a caixinha
CREATE POLICY caixinhas_update_admin ON caixinhas
    FOR UPDATE USING (admin_id = auth.uid()::text);

-- 5.2 Políticas para caixinha_members:
-- Membros podem ver outros membros da mesma caixinha
CREATE POLICY caixinha_members_select_same_caixinha ON caixinha_members
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM caixinha_members cm
            WHERE cm.caixinha_id = caixinha_id AND cm.user_id = auth.uid()::text
        )
    );

-- 5.3 Políticas para caixinha_loan_settings:
-- Membros podem ver as configurações de empréstimo
CREATE POLICY caixinha_loan_settings_select_members ON caixinha_loan_settings
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM caixinha_members cm
            WHERE cm.caixinha_id = caixinha_id AND cm.user_id = auth.uid()::text
        )
    );

-- =====================================================
-- 6. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================
COMMENT ON TABLE caixinhas IS 'Entidade principal de grupos financeiros (Caixinhas)';
COMMENT ON TABLE caixinha_members IS 'Relacionamento entre usuários e caixinhas (Membros)';
COMMENT ON TABLE caixinha_loan_settings IS 'Configurações de empréstimo específicas de cada caixinha';
