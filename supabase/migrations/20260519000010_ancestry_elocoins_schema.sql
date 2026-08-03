-- =====================================================
-- MIGRAÇÃO: user_ancestry + elo_coin_transactions
-- Substitui subcoleções Firestore:
--   usuario/{id}/ancestralidade  → user_ancestry (perspective: novo usuário)
--   usuario/{id}/descendentes    → user_ancestry (perspective: remetente do convite)
--   usuario/{id}/compras         → elo_coin_transactions
--   transactions (root)          → elo_coin_transactions
-- =====================================================

-- =====================================================
-- 1. Tabela user_ancestry
-- =====================================================
CREATE TABLE IF NOT EXISTS user_ancestry (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- quem foi convidado (novo usuário)
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- quem enviou o convite (ancestral direto)
    ancestor_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_id       TEXT,
    ancestor_name   TEXT,
    ancestor_photo  TEXT,
    accepted_at     TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, ancestor_id)
);

CREATE INDEX idx_user_ancestry_user_id     ON user_ancestry(user_id);
CREATE INDEX idx_user_ancestry_ancestor_id ON user_ancestry(ancestor_id);

ALTER TABLE user_ancestry ENABLE ROW LEVEL SECURITY;

-- Usuário vê sua própria ancestralidade; ancestral vê seus descendentes
CREATE POLICY ancestry_select ON user_ancestry
    FOR SELECT USING (
        user_id     = auth.uid()::text OR
        ancestor_id = auth.uid()::text
    );

COMMENT ON TABLE user_ancestry IS
    'Árvore genealógica de convites: quem convidou quem. Substitui subcoleções ancestralidade/descendentes do Firestore.';

-- =====================================================
-- 2. Tabela elo_coin_transactions
-- =====================================================
CREATE TABLE IF NOT EXISTS elo_coin_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Positivo = crédito; Negativo = débito
    amount          NUMERIC NOT NULL,
    type            TEXT NOT NULL DEFAULT 'credit',  -- 'credit' | 'debit' | 'purchase' | 'refund' | 'bonus'
    description     TEXT,
    payment_method  TEXT,          -- 'stripe','pix','oferta-boas-vindas', etc.
    external_ref    TEXT,          -- stripe payment_intent_id, etc.
    status          TEXT NOT NULL DEFAULT 'completed',  -- 'pending' | 'completed' | 'failed' | 'refunded'
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_elo_coin_tx_user_id    ON elo_coin_transactions(user_id);
CREATE INDEX idx_elo_coin_tx_type       ON elo_coin_transactions(type);
CREATE INDEX idx_elo_coin_tx_status     ON elo_coin_transactions(status);
CREATE INDEX idx_elo_coin_tx_created_at ON elo_coin_transactions(created_at DESC);

ALTER TABLE elo_coin_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY elo_coin_tx_select_own ON elo_coin_transactions
    FOR SELECT USING (user_id = auth.uid()::text);

COMMENT ON TABLE elo_coin_transactions IS
    'Histórico de transações de EloCoins. Substitui subcoleção compras e coleção transactions do Firestore.';

-- =====================================================
-- 3. RPC: atomic wallet credit/debit
-- =====================================================
CREATE OR REPLACE FUNCTION credit_wallet(p_user_id TEXT, p_amount NUMERIC)
RETURNS NUMERIC AS $$
DECLARE
    new_balance NUMERIC;
BEGIN
    INSERT INTO wallets(user_id, balance)
    VALUES (p_user_id, p_amount)
    ON CONFLICT (user_id) DO UPDATE
        SET balance    = wallets.balance + p_amount,
            updated_at = NOW()
    RETURNING balance INTO new_balance;

    RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION debit_wallet(p_user_id TEXT, p_amount NUMERIC)
RETURNS NUMERIC AS $$
DECLARE
    cur_balance NUMERIC;
    new_balance NUMERIC;
BEGIN
    SELECT balance INTO cur_balance FROM wallets WHERE user_id = p_user_id FOR UPDATE;

    IF cur_balance IS NULL THEN
        RAISE EXCEPTION 'Wallet not found for user %', p_user_id;
    END IF;

    IF cur_balance < p_amount THEN
        RAISE EXCEPTION 'Insufficient balance: % < %', cur_balance, p_amount;
    END IF;

    UPDATE wallets
    SET balance    = balance - p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id
    RETURNING balance INTO new_balance;

    RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
