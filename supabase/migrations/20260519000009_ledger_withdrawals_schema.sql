-- Migration: saldo_virtual em caixinha_members + tabela caixinha_withdrawals
-- Substitui: caixinhas/{id}/ledger/{userId} e caixinhas/{id}/saques/

-- =====================================================
-- 1. Adicionar saldo_virtual em caixinha_members
-- =====================================================
ALTER TABLE caixinha_members
  ADD COLUMN IF NOT EXISTS saldo_virtual NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saldo_virtual_updated_at TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN caixinha_members.saldo_virtual IS 'Saldo virtual do membro nesta caixinha (ledger desnormalizado)';

-- =====================================================
-- 2. TABELA caixinha_withdrawals (saques)
-- =====================================================
CREATE TABLE caixinha_withdrawals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caixinha_id     TEXT NOT NULL REFERENCES caixinhas(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id),
    amount          NUMERIC NOT NULL,
    pix_key         TEXT NOT NULL,
    pix_key_type    TEXT DEFAULT 'CPF',
    status          TEXT DEFAULT 'pending_approval',  -- 'pending_approval','completed','failed','cancelled'
    approved_at     TIMESTAMPTZ,
    approved_by     TEXT REFERENCES users(id),
    transfer_id     TEXT,
    transfer_status TEXT,
    requested_at    TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_caixinha_withdrawals_caixinha_id ON caixinha_withdrawals(caixinha_id);
CREATE INDEX idx_caixinha_withdrawals_user_id ON caixinha_withdrawals(user_id);
CREATE INDEX idx_caixinha_withdrawals_status ON caixinha_withdrawals(status);

COMMENT ON TABLE caixinha_withdrawals IS 'Solicitações de saque dos membros (aprovação admin + PIX via Asaas)';

-- =====================================================
-- 3. RLS
-- =====================================================
ALTER TABLE caixinha_withdrawals ENABLE ROW LEVEL SECURITY;

-- Membros veem seus próprios saques; admins da caixinha veem todos
CREATE POLICY withdrawals_select ON caixinha_withdrawals
    FOR SELECT USING (
        user_id = auth.uid()::text OR
        EXISTS (
            SELECT 1 FROM caixinha_members cm
            WHERE cm.caixinha_id = caixinha_id
              AND cm.user_id = auth.uid()::text
              AND cm.role = 'admin'
        )
    );
