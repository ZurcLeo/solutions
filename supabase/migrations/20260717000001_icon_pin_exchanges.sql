-- ICON-PIN-001: Tabela para troca segura de credenciais IconChat via PIN efemero
-- O HMAC secret nunca sai do backend; IconChat resgata server-to-server via PIN.

CREATE TABLE icon_pin_exchanges (
    id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    pin_hash              TEXT NOT NULL,           -- SHA-256 do PIN (nunca armazena plaintext)
    seller_id             TEXT NOT NULL REFERENCES seller_profiles(id) ON DELETE CASCADE,
    subscription_id       TEXT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
    encrypted_credentials JSONB NOT NULL,          -- output do encryptionService.encrypt()
    status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','redeemed','expired')),
    attempts              INTEGER NOT NULL DEFAULT 0,
    max_attempts          INTEGER NOT NULL DEFAULT 3,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at            TIMESTAMPTZ NOT NULL,
    redeemed_at           TIMESTAMPTZ,
    redeemed_by_ip        TEXT,
    expired_at            TIMESTAMPTZ
);

-- Indices parciais para performance
CREATE INDEX idx_icon_pin_hash ON icon_pin_exchanges(pin_hash) WHERE status = 'pending';
CREATE INDEX idx_icon_pin_expires ON icon_pin_exchanges(expires_at) WHERE status = 'pending';
CREATE INDEX idx_icon_pin_seller ON icon_pin_exchanges(seller_id, created_at DESC);

-- RLS: service_role only (backend acessa via service key)
ALTER TABLE icon_pin_exchanges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "icon_pin_service_role" ON icon_pin_exchanges
    FOR ALL USING (true) WITH CHECK (true);
