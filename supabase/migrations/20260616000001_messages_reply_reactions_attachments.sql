-- =====================================================
-- MIGRAÇÃO: Reply, Reactions e Attachments para mensagens
-- Épico: MSG-REPLY-001, MSG-REACT-001, MSG-ATTACH-001
-- Padrão: NOT VALID + VALIDATE (zero-downtime)
-- =====================================================

-- =====================================================
-- 1. Coluna reply_to (referência à mensagem original)
-- =====================================================
ALTER TABLE messages ADD COLUMN reply_to TEXT REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX idx_messages_reply_to ON messages(reply_to) WHERE reply_to IS NOT NULL;

-- =====================================================
-- 2. Coluna attachments (JSONB array de metadados)
-- Formato: [{ "url": "...", "name": "...", "type": "...", "size": 12345 }]
-- =====================================================
ALTER TABLE messages ADD COLUMN attachments JSONB DEFAULT '[]'::jsonb;

-- =====================================================
-- 3. Tabela message_reactions (toggle por usuário+emoji)
-- =====================================================
CREATE TABLE message_reactions (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX idx_message_reactions_message_id ON message_reactions(message_id);

-- RLS
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

-- Participantes da conversa podem ver reações
CREATE POLICY "message_reactions_select" ON message_reactions FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM messages m
        JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
        WHERE m.id = message_reactions.message_id
          AND cp.user_id = auth.uid()::text
    )
);

-- Usuário pode inserir reação própria
CREATE POLICY "message_reactions_insert" ON message_reactions FOR INSERT
WITH CHECK (user_id = auth.uid()::text);

-- Usuário pode remover reação própria
CREATE POLICY "message_reactions_delete" ON message_reactions FOR DELETE
USING (user_id = auth.uid()::text);

-- =====================================================
-- 4. RPC: toggle_message_reaction (upsert ou delete)
-- =====================================================
CREATE OR REPLACE FUNCTION toggle_message_reaction(
    p_message_id TEXT,
    p_user_id    TEXT,
    p_emoji      TEXT
)
RETURNS TABLE(action TEXT, reaction_id TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_existing_id TEXT;
BEGIN
    -- Validar que a mensagem existe e o usuário é participante
    IF NOT EXISTS (
        SELECT 1 FROM messages m
        JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
        WHERE m.id = p_message_id AND cp.user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'Mensagem não encontrada ou acesso negado';
    END IF;

    SELECT mr.id INTO v_existing_id
    FROM message_reactions mr
    WHERE mr.message_id = p_message_id
      AND mr.user_id = p_user_id
      AND mr.emoji = p_emoji;

    IF v_existing_id IS NOT NULL THEN
        DELETE FROM message_reactions WHERE id = v_existing_id;
        RETURN QUERY SELECT 'removed'::TEXT, v_existing_id;
    ELSE
        INSERT INTO message_reactions (id, message_id, user_id, emoji)
        VALUES (gen_random_uuid()::text, p_message_id, p_user_id, p_emoji)
        RETURNING 'added'::TEXT, message_reactions.id;
    END IF;
END;
$$;

-- =====================================================
-- 5. RPC: get_message_reactions_summary
-- Retorna contagem e lista de user_ids por emoji por mensagem
-- =====================================================
CREATE OR REPLACE FUNCTION get_message_reactions_summary(p_message_ids TEXT[])
RETURNS TABLE(message_id TEXT, emoji TEXT, count BIGINT, user_ids TEXT[])
LANGUAGE sql STABLE AS $$
    SELECT mr.message_id, mr.emoji, COUNT(*)::BIGINT, array_agg(mr.user_id)
    FROM message_reactions mr
    WHERE mr.message_id = ANY(p_message_ids)
    GROUP BY mr.message_id, mr.emoji;
$$;

-- =====================================================
-- 6. Storage bucket: message-attachments
-- =====================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'message-attachments',
    'message-attachments',
    false,
    10485760,  -- 10 MB
    ARRAY[
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'video/mp4',
        'audio/mpeg', 'audio/ogg',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
)
ON CONFLICT (id) DO NOTHING;

-- Upload: usuário autenticado, path = {sender_id}/{conversation_id}/{filename}
CREATE POLICY "msg_attachments_upload" ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'message-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Download: participante da conversa (folder[2] = conversation_id)
-- Backend usa service_role, esta policy é defense-in-depth
CREATE POLICY "msg_attachments_download" ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'message-attachments'
    AND EXISTS (
        SELECT 1 FROM conversation_participants cp
        WHERE cp.conversation_id = (storage.foldername(name))[2]
          AND cp.user_id = auth.uid()::text
    )
);

-- Delete: apenas o dono do arquivo
CREATE POLICY "msg_attachments_delete" ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'message-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
);
