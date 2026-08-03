-- =====================================================
-- MIGRAÇÃO: Domínio Contas Bancárias (ElosCloud)
-- Descrição: Tabelas para armazenamento seguro de dados bancários.
-- Autor: Léo (ElosCloud)
-- Data: 2026-05-13
-- =====================================================

-- =====================================================
-- 1. TABELA bank_accounts
-- =====================================================
CREATE TABLE bank_accounts (
    id                TEXT PRIMARY KEY,          -- ID do Firestore
    admin_id          TEXT NOT NULL REFERENCES users(id),
    caixinha_id       TEXT NOT NULL REFERENCES caixinhas(id) ON DELETE CASCADE,
    bank_name         TEXT NOT NULL,
    is_active         BOOLEAN DEFAULT FALSE,
    encrypted_data    TEXT,                      -- Dados sensíveis criptografados (accountNumber, holder, etc.)
    last_digits       TEXT,                      -- Últimos 4 dígitos para referência rápida
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_bank_accounts_admin_id ON bank_accounts(admin_id);
CREATE INDEX idx_bank_accounts_caixinha_id ON bank_accounts(caixinha_id);
CREATE INDEX idx_bank_accounts_is_active ON bank_accounts(is_active);

-- =====================================================
-- 2. TRIGGERS (Updated At)
-- =====================================================

CREATE TRIGGER trigger_bank_accounts_updated_at
    BEFORE UPDATE ON bank_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();

-- =====================================================
-- 3. ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

-- 3.1 Políticas para bank_accounts:
-- Apenas o administrador da conta ou o admin da caixinha pode ver
CREATE POLICY bank_accounts_select_admin ON bank_accounts
    FOR SELECT USING (
        admin_id = auth.uid()::text OR
        EXISTS (
            SELECT 1 FROM caixinha_members cm
            WHERE cm.caixinha_id = caixinha_id AND cm.user_id = auth.uid()::text AND cm.role = 'admin'
        )
    );

-- Apenas o dono pode atualizar/deletar
CREATE POLICY bank_accounts_modify_owner ON bank_accounts
    FOR ALL USING (admin_id = auth.uid()::text);

-- =====================================================
-- 4. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================
COMMENT ON TABLE bank_accounts IS 'Informações bancárias das caixinhas para processamento de pagamentos';
COMMENT ON COLUMN bank_accounts.encrypted_data IS 'JSON criptografado contendo dados sensíveis do banco';
