-- =====================================================
-- MIGRAÇÃO: Bank Accounts (migrado de Firestore em 2026-05-19)
-- Descrição: Contas bancárias das caixinhas com dados sensíveis criptografados.
-- =====================================================

CREATE TABLE IF NOT EXISTS bank_accounts (
    id          TEXT PRIMARY KEY,
    admin_id    TEXT NOT NULL REFERENCES users(id),
    caixinha_id TEXT NOT NULL REFERENCES caixinhas(id) ON DELETE CASCADE,
    bank_name   TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT false,
    last_digits TEXT,
    encrypted   JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_admin_id    ON bank_accounts(admin_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_caixinha_id ON bank_accounts(caixinha_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_is_active   ON bank_accounts(caixinha_id, is_active);

-- Adicionar colunas ausentes caso a tabela já exista sem elas
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS encrypted   JSONB;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS last_digits TEXT;

-- Trigger
CREATE OR REPLACE FUNCTION update_bank_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_bank_accounts_updated_at ON bank_accounts;
CREATE TRIGGER trigger_bank_accounts_updated_at
    BEFORE UPDATE ON bank_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_bank_accounts_updated_at();

-- RLS
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

-- Somente o admin da caixinha pode ver/gerenciar contas bancárias
CREATE POLICY bank_accounts_admin_only ON bank_accounts
    FOR ALL USING (
        admin_id = auth.uid()::text
        OR check_global_role(auth.uid()::text, 'admin')
    );

COMMENT ON TABLE bank_accounts IS 'Contas bancárias associadas às caixinhas. Dados sensíveis (número, titular, PIX) armazenados criptografados no campo encrypted (AES-256-GCM).';
COMMENT ON COLUMN bank_accounts.encrypted IS 'Blob criptografado contendo: accountNumber, accountHolder, accountType, bankCode, pixKey, pixKeyType. Descriptografado pelo encryptionService.';
COMMENT ON COLUMN bank_accounts.last_digits IS 'Últimos 4 dígitos da conta — visível sem descriptografar, para referência.';
