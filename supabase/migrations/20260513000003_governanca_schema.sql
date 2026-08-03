-- =====================================================
-- MIGRAÇÃO: Domínio Governança (ElosCloud)
-- Descrição: Tabelas para disputas, votações e convites de caixinha.
-- Autor: Léo (ElosCloud)
-- Data: 2026-05-13
-- =====================================================

-- =====================================================
-- 1. TABELA disputes
-- =====================================================
CREATE TABLE disputes (
    id                TEXT PRIMARY KEY,          -- ID do Firestore
    caixinha_id       TEXT NOT NULL REFERENCES caixinhas(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    description       TEXT,
    type              TEXT NOT NULL,             -- 'RULE_CHANGE', 'LOAN_APPROVAL', 'MEMBER_REMOVAL'
    proposed_by       TEXT NOT NULL REFERENCES users(id),
    proposed_changes  JSONB DEFAULT '{}',
    status            TEXT DEFAULT 'OPEN',       -- 'OPEN', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    expires_at        TIMESTAMPTZ,
    resolved_at       TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_disputes_caixinha_id ON disputes(caixinha_id);
CREATE INDEX idx_disputes_status ON disputes(status);
CREATE INDEX idx_disputes_expires_at ON disputes(expires_at);

-- =====================================================
-- 2. TABELA dispute_votes
-- =====================================================
CREATE TABLE dispute_votes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_id      TEXT NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id),
    vote_type       TEXT NOT NULL,               -- 'YES', 'NO', 'ABSTAIN'
    voted_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(dispute_id, user_id)                  -- Um usuário, um voto por disputa
);

-- Índice
CREATE INDEX idx_dispute_votes_dispute_id ON dispute_votes(dispute_id);

-- =====================================================
-- 3. TABELA caixinha_invites (Consolidação de pendingRequests + historic)
-- =====================================================
CREATE TABLE caixinha_invites (
    id              TEXT PRIMARY KEY,            -- ID do Firestore
    caixinha_id     TEXT NOT NULL REFERENCES caixinhas(id) ON DELETE CASCADE,
    sender_id       TEXT NOT NULL REFERENCES users(id),
    target_id       TEXT REFERENCES users(id),   -- Opcional (se usuário já existe)
    email           TEXT,                        -- Opcional (se convite por email)
    type            TEXT DEFAULT 'caixinha_invite',
    status          TEXT DEFAULT 'pending',      -- 'pending', 'accepted', 'rejected', 'canceled', 'expired'
    message         TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    responded_at    TIMESTAMPTZ,
    response_reason TEXT,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_caixinha_invites_caixinha_id ON caixinha_invites(caixinha_id);
CREATE INDEX idx_caixinha_invites_target_id ON caixinha_invites(target_id);
CREATE INDEX idx_caixinha_invites_email ON caixinha_invites(email);
CREATE INDEX idx_caixinha_invites_status ON caixinha_invites(status);

-- =====================================================
-- 4. TRIGGERS (Updated At)
-- =====================================================

CREATE TRIGGER trigger_disputes_updated_at
    BEFORE UPDATE ON disputes
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();

CREATE TRIGGER trigger_caixinha_invites_updated_at
    BEFORE UPDATE ON caixinha_invites
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();

-- =====================================================
-- 5. ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE caixinha_invites ENABLE ROW LEVEL SECURITY;

-- 5.1 Políticas para disputes:
-- Membros da caixinha podem ver as disputas
CREATE POLICY disputes_select_members ON disputes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM caixinha_members cm
            WHERE cm.caixinha_id = caixinha_id AND cm.user_id = auth.uid()::text
        )
    );

-- 5.2 Políticas para dispute_votes:
-- Membros podem ver os votos das disputas (transparência)
CREATE POLICY dispute_votes_select_members ON dispute_votes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM caixinha_members cm
            JOIN disputes d ON d.caixinha_id = cm.caixinha_id
            WHERE d.id = dispute_id AND cm.user_id = auth.uid()::text
        )
    );

-- 5.3 Políticas para caixinha_invites:
-- Sender ou Target podem ver o convite
CREATE POLICY caixinha_invites_select_involved ON caixinha_invites
    FOR SELECT USING (
        sender_id = auth.uid()::text OR 
        target_id = auth.uid()::text OR
        EXISTS (
            SELECT 1 FROM caixinha_members cm
            WHERE cm.caixinha_id = caixinha_id AND cm.user_id = auth.uid()::text AND cm.role = 'admin'
        )
    );

-- =====================================================
-- 6. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================
COMMENT ON TABLE disputes IS 'Processos de decisão coletiva e governança';
COMMENT ON TABLE dispute_votes IS 'Votos individuais em processos de disputa';
COMMENT ON TABLE caixinha_invites IS 'Gestão de convites para participação em caixinhas';
