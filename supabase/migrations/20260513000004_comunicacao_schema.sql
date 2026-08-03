-- =====================================================
-- MIGRAÇÃO: Domínio Comunicação (ElosCloud)
-- Descrição: Tabelas para mensagens, conversas e notificações.
-- Autor: Léo (ElosCloud)
-- Data: 2026-05-13
-- =====================================================

-- =====================================================
-- 1. TABELA conversations
-- =====================================================
CREATE TABLE conversations (
    id                    TEXT PRIMARY KEY,          -- ID composto (uid1_uid2) ou gerado
    type                  TEXT DEFAULT 'private',    -- 'private', 'group'
    last_message_text     TEXT,
    last_message_timestamp TIMESTAMPTZ,
    last_message_sender_id TEXT REFERENCES users(id),
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_conversations_updated_at ON conversations(updated_at);

-- =====================================================
-- 2. TABELA conversation_participants (M:N)
-- =====================================================
CREATE TABLE conversation_participants (
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
    unread_count    INTEGER DEFAULT 0,
    last_access     TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

-- Índices
CREATE INDEX idx_conv_participants_user_id ON conversation_participants(user_id);

-- =====================================================
-- 3. TABELA messages
-- =====================================================
CREATE TABLE messages (
    id              TEXT PRIMARY KEY,            -- ID do Firestore
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       TEXT NOT NULL REFERENCES users(id),
    content         TEXT NOT NULL,
    type            TEXT DEFAULT 'text',         -- 'text', 'image', 'system'
    timestamp       TIMESTAMPTZ DEFAULT NOW(),
    read            BOOLEAN DEFAULT FALSE,
    read_at         TIMESTAMPTZ,
    delivered       BOOLEAN DEFAULT FALSE,
    deleted         BOOLEAN DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);

-- =====================================================
-- 4. TABELA notifications
-- =====================================================
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,               -- 'caixinha_invite', 'loan_update', etc.
    content         TEXT NOT NULL,
    entity_type     TEXT,                        -- 'caixinha', 'dispute', 'loan'
    entity_id       TEXT,                        -- ID da entidade relacionada
    read            BOOLEAN DEFAULT FALSE,
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);
CREATE INDEX idx_notifications_read ON notifications(read);

-- =====================================================
-- 5. TRIGGERS (Updated At)
-- =====================================================

CREATE TRIGGER trigger_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();

-- =====================================================
-- 6. ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- 6.1 Políticas para conversations & participants:
-- Apenas participantes podem ver a conversa
CREATE POLICY conversations_select_participants ON conversations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM conversation_participants cp
            WHERE cp.conversation_id = id AND cp.user_id = auth.uid()::text
        )
    );

CREATE POLICY conv_participants_select_self ON conversation_participants
    FOR SELECT USING (user_id = auth.uid()::text);

-- 6.2 Políticas para messages:
-- Apenas participantes da conversa podem ver as mensagens
CREATE POLICY messages_select_participants ON messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM conversation_participants cp
            WHERE cp.conversation_id = conversation_id AND cp.user_id = auth.uid()::text
        )
    );

-- 6.3 Políticas para notifications:
-- Apenas o próprio usuário pode ver suas notificações
CREATE POLICY notifications_select_self ON notifications
    FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY notifications_update_self ON notifications
    FOR UPDATE USING (user_id = auth.uid()::text);

-- =====================================================
-- 7. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================
COMMENT ON TABLE conversations IS 'Agrupamento de mensagens entre dois ou mais usuários';
COMMENT ON TABLE conversation_participants IS 'Controle de acesso e estado de leitura por usuário na conversa';
COMMENT ON TABLE messages IS 'Conteúdo individual de comunicação';
COMMENT ON TABLE notifications IS 'Alertas e eventos direcionados ao usuário (Push e In-app)';
