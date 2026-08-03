-- =====================================================
-- MIGRAÇÃO: Domínio Social — Presentes entre Usuários (ElosCloud)
-- Descrição: Tabela de presentes (gifts) enviados em posts do feed social.
--            Armazena remetente, destinatário, tipo e valor em EloCoins.
-- Data: 2026-05-19
-- =====================================================

-- =====================================================
-- 1. TABELA gifts
-- =====================================================
CREATE TABLE IF NOT EXISTS gifts (
    id              TEXT PRIMARY KEY,
    post_id         TEXT REFERENCES posts(id) ON DELETE SET NULL,
    from_user_id    TEXT NOT NULL REFERENCES users(id),
    to_user_id      TEXT NOT NULL REFERENCES users(id),
    tipo            TEXT NOT NULL,
    valor           NUMERIC NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. ÍNDICES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_gifts_post_id        ON gifts(post_id);
CREATE INDEX IF NOT EXISTS idx_gifts_from_user_id   ON gifts(from_user_id);
CREATE INDEX IF NOT EXISTS idx_gifts_to_user_id     ON gifts(to_user_id);

-- =====================================================
-- 3. ROW LEVEL SECURITY (RLS)
-- =====================================================
ALTER TABLE gifts ENABLE ROW LEVEL SECURITY;

-- Leitura: remetente ou destinatário
CREATE POLICY gifts_select_involved ON gifts
    FOR SELECT USING (
        from_user_id = auth.uid()::text
        OR to_user_id = auth.uid()::text
    );

-- Inserção: apenas como próprio remetente
CREATE POLICY gifts_insert_as_sender ON gifts
    FOR INSERT WITH CHECK (
        from_user_id = auth.uid()::text
    );

-- =====================================================
-- 4. COMENTÁRIOS
-- =====================================================
COMMENT ON TABLE gifts IS 'Presentes enviados entre usuários em posts do feed social. Valor em EloCoins debitado do remetente e creditado ao destinatário.';
COMMENT ON COLUMN gifts.post_id IS 'Post ao qual o presente está associado. SET NULL se o post for deletado — o histórico financeiro permanece.';
COMMENT ON COLUMN gifts.from_user_id IS 'Usuário que enviou o presente. EloCoins são debitados deste usuário.';
COMMENT ON COLUMN gifts.to_user_id IS 'Usuário que recebeu o presente. EloCoins são creditados a este usuário.';
COMMENT ON COLUMN gifts.tipo IS 'Tipo/categoria do presente (ex: rose, star, coin, trophy). Catálogo gerenciado pela aplicação.';
COMMENT ON COLUMN gifts.valor IS 'Valor do presente em EloCoins no momento do envio.';
