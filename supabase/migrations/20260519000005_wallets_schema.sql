-- =====================================================
-- MIGRAÇÃO: Wallets (migrado de Firestore em 2026-05-19)
-- Descrição: Carteiras de EloCoins dos usuários.
-- =====================================================

CREATE TABLE IF NOT EXISTS wallets (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance    NUMERIC NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT 'active',
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT wallets_balance_check CHECK (balance >= 0),
    CONSTRAINT wallets_status_check  CHECK (status IN ('active', 'frozen', 'suspended'))
);

-- Trigger: atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION update_wallets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_wallets_updated_at
    BEFORE UPDATE ON wallets
    FOR EACH ROW
    EXECUTE FUNCTION update_wallets_updated_at();

-- RLS
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY wallets_select_own ON wallets
    FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY wallets_update_own ON wallets
    FOR UPDATE USING (user_id = auth.uid()::text);

COMMENT ON TABLE wallets IS 'Saldo de EloCoins de cada usuário. Atualizações devem passar por RPC para garantir atomicidade.';
