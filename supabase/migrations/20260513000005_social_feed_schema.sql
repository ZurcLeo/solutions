-- =====================================================
-- MIGRAÇÃO: Domínio Social & Feed (ElosCloud)
-- Descrição: Tabelas para postagens, comentários, reações e conexões.
-- Autor: Léo (ElosCloud)
-- Data: 2026-05-13
-- =====================================================

-- =====================================================
-- 1. TABELA posts
-- =====================================================
CREATE TABLE posts (
    id                TEXT PRIMARY KEY,          -- ID do Firestore
    usuario_id        TEXT NOT NULL REFERENCES users(id),
    conteudo          TEXT,
    media_url         TEXT,
    tipo_media        TEXT,                      -- 'image', 'video', 'none'
    visibilidade      TEXT DEFAULT 'public',     -- 'public', 'friends', 'private'
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_posts_usuario_id ON posts(usuario_id);
CREATE INDEX idx_posts_created_at ON posts(created_at);
CREATE INDEX idx_posts_visibilidade ON posts(visibilidade);

-- =====================================================
-- 2. TABELA comments
-- =====================================================
CREATE TABLE comments (
    id                TEXT PRIMARY KEY,          -- ID do Firestore
    post_id           TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    usuario_id        TEXT NOT NULL REFERENCES users(id),
    texto             TEXT NOT NULL,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_comments_post_id ON comments(post_id);
CREATE INDEX idx_comments_usuario_id ON comments(usuario_id);

-- =====================================================
-- 3. TABELA reactions
-- =====================================================
CREATE TABLE reactions (
    id                TEXT PRIMARY KEY,          -- ID do Firestore
    post_id           TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    usuario_id        TEXT NOT NULL REFERENCES users(id),
    tipo              TEXT NOT NULL,             -- 'like', 'love', 'haha', 'wow', 'sad', 'angry'
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(post_id, usuario_id)                  -- Um usuário, uma reação por post
);

-- Índice
CREATE INDEX idx_reactions_post_id ON reactions(post_id);

-- =====================================================
-- 4. TABELA friend_invites (Convites de Amizade)
-- =====================================================
CREATE TABLE friend_invites (
    id              TEXT PRIMARY KEY,            -- ID do Firestore (doc id)
    invite_id       TEXT UNIQUE,                 -- UUID do inviteId
    sender_id       TEXT NOT NULL REFERENCES users(id),
    email           TEXT,
    friend_name     TEXT,
    status          TEXT DEFAULT 'pending',      -- 'pending', 'validated', 'used', 'canceled'
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    validated_at    TIMESTAMPTZ,
    validated_by    TEXT REFERENCES users(id),
    used_at         TIMESTAMPTZ,
    used_by         TEXT REFERENCES users(id),
    canceled_at     TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_friend_invites_sender_id ON friend_invites(sender_id);
CREATE INDEX idx_friend_invites_email ON friend_invites(email);
CREATE INDEX idx_friend_invites_status ON friend_invites(status);

-- =====================================================
-- 5. TABELA user_connections (Conexões de Amizade)
-- =====================================================
CREATE TABLE user_connections (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connected_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status            TEXT DEFAULT 'pending',    -- 'pending', 'active', 'inactive'
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, connected_user_id)
);

-- Índices
CREATE INDEX idx_user_conn_user_id ON user_connections(user_id);
CREATE INDEX idx_user_conn_connected_id ON user_connections(connected_user_id);
CREATE INDEX idx_user_conn_status ON user_connections(status);

-- =====================================================
-- 6. TRIGGERS (Updated At)
-- =====================================================

CREATE TRIGGER trigger_posts_updated_at
    BEFORE UPDATE ON posts
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();

CREATE TRIGGER trigger_friend_invites_updated_at
    BEFORE UPDATE ON friend_invites
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();

CREATE TRIGGER trigger_user_connections_updated_at
    BEFORE UPDATE ON user_connections
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();

-- =====================================================
-- 7. ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_connections ENABLE ROW LEVEL SECURITY;

-- 7.1 Políticas para posts:
-- Postagens públicas são visíveis por todos
CREATE POLICY posts_select_public ON posts
    FOR SELECT USING (visibilidade = 'public' OR usuario_id = auth.uid()::text);

-- 7.2 Políticas para comments & reactions:
-- Visíveis se o post for visível
CREATE POLICY comments_select_post_visible ON comments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM posts p
            WHERE p.id = post_id AND (p.visibilidade = 'public' OR p.usuario_id = auth.uid()::text)
        )
    );

CREATE POLICY reactions_select_post_visible ON reactions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM posts p
            WHERE p.id = post_id AND (p.visibilidade = 'public' OR p.usuario_id = auth.uid()::text)
        )
    );

-- 7.3 Políticas para connections & invites:
-- Usuário vê suas próprias conexões e convites
CREATE POLICY connections_select_self ON user_connections
    FOR SELECT USING (user_id = auth.uid()::text OR connected_user_id = auth.uid()::text);

CREATE POLICY friend_invites_select_involved ON friend_invites
    FOR SELECT USING (sender_id = auth.uid()::text OR validated_by = auth.uid()::text OR used_by = auth.uid()::text);

-- =====================================================
-- 8. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================
COMMENT ON TABLE posts IS 'Publicações do feed social';
COMMENT ON TABLE comments IS 'Comentários em publicações';
COMMENT ON TABLE reactions IS 'Reações (likes, etc.) em publicações';
COMMENT ON TABLE friend_invites IS 'Convites de amizade enviados por email ou link';
COMMENT ON TABLE user_connections IS 'Grafo de conexões sociais entre usuários';
