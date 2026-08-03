-- =============================================================================
-- SELLER EXTERNAL ACCOUNTS — OAuth tokens para plataformas externas (ML, etc.)
-- Ticket: ML-001
-- Zero-downtime: CREATE TABLE + INDEX
-- =============================================================================

CREATE TABLE IF NOT EXISTS seller_external_accounts (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    seller_id TEXT NOT NULL REFERENCES seller_profiles(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,  -- 'mercadolivre', futuro: 'shopee', 'amazon', etc.

    -- Dados da conta externa
    external_user_id TEXT NOT NULL,  -- ML user_id
    external_username TEXT,          -- ML nickname (display)

    -- OAuth tokens (criptografados via AES-256-GCM no backend)
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    token_expires_at TIMESTAMPTZ,

    -- Metadata
    scopes TEXT[],                   -- scopes autorizados
    account_status TEXT NOT NULL DEFAULT 'active'
        CHECK (account_status IN ('active', 'disconnected', 'expired', 'error')),
    last_sync_at TIMESTAMPTZ,
    sync_error TEXT,

    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Um seller pode ter apenas uma conta por plataforma
    CONSTRAINT uq_seller_platform UNIQUE (seller_id, platform)
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_external_accounts_platform
    ON seller_external_accounts (platform, account_status);

CREATE INDEX IF NOT EXISTS idx_external_accounts_seller
    ON seller_external_accounts (seller_id);

-- Trigger updated_at (funcao ja existe em 20260531000007_platform_modules.sql)
CREATE OR REPLACE TRIGGER trg_external_accounts_updated_at
    BEFORE UPDATE ON seller_external_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE seller_external_accounts ENABLE ROW LEVEL SECURITY;

-- Seller pode ver/editar apenas suas proprias contas
CREATE POLICY sel_own_external_accounts ON seller_external_accounts
    FOR ALL
    USING (seller_id IN (SELECT id FROM seller_profiles WHERE user_id = auth.uid()::TEXT))
    WITH CHECK (seller_id IN (SELECT id FROM seller_profiles WHERE user_id = auth.uid()::TEXT));

COMMENT ON TABLE seller_external_accounts IS 'Contas de plataformas externas vinculadas a sellers. Tokens criptografados AES-256-GCM.';
