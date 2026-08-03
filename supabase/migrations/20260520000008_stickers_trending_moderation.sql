-- =====================================================
-- MIGRAÇÃO: Stickers, Trending Feed & Moderação (ElosCloud)
-- Descrição: Catálogo de stickers, mural de stickers do usuário,
--            colunas de trending/moderação em posts/users,
--            e extensão da tabela gifts para suportar stickers.
-- Data: 2026-05-20
-- Sprint: 1 — Épicos 1 e 3
-- =====================================================

-- =====================================================
-- 1. ENUM TYPES
-- =====================================================
DO $$ BEGIN
  CREATE TYPE edition_type AS ENUM ('open', 'time_limited', 'quantity_limited', 'exclusive');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE sticker_rarity AS ENUM ('common', 'rare', 'epic', 'legendary');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================
-- 2. TABELA sticker_catalog
-- =====================================================
CREATE TABLE IF NOT EXISTS sticker_catalog (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    image_url           TEXT NOT NULL,
    eloscoin_price      INTEGER NOT NULL CHECK (eloscoin_price >= 0),
    edition_type        edition_type NOT NULL DEFAULT 'open',
    max_quantity        INTEGER,                -- null = sem limite global
    per_user_limit      INTEGER,                -- null = sem limite por usuário
    available_until     TIMESTAMPTZ,            -- null = sem expiração
    campaign_name       TEXT,
    rarity              sticker_rarity NOT NULL DEFAULT 'common',
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_by_admin_id TEXT,                   -- Firebase UID do admin
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sticker_catalog_active
    ON sticker_catalog(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_sticker_catalog_edition
    ON sticker_catalog(edition_type);

COMMENT ON TABLE sticker_catalog IS 'Catálogo de stickers disponíveis para gifting. Suporta edições limitadas, por tempo e exclusivas.';
COMMENT ON COLUMN sticker_catalog.max_quantity IS 'Quantidade máxima global emitida. NULL = sem limite.';
COMMENT ON COLUMN sticker_catalog.per_user_limit IS 'Quantos exemplares o mesmo usuário pode receber. NULL = sem limite.';
COMMENT ON COLUMN sticker_catalog.available_until IS 'Data de expiração da edição. NULL = sem expiração.';

-- =====================================================
-- 3. TABELA user_stickers (mural do usuário)
-- =====================================================
CREATE TABLE IF NOT EXISTS user_stickers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id   TEXT NOT NULL,          -- Firebase UID do dono
    sticker_id      UUID NOT NULL REFERENCES sticker_catalog(id) ON DELETE RESTRICT,
    from_user_id    TEXT,                   -- quem enviou (null = compra própria)
    post_id         TEXT,                   -- post associado (Firestore ID)
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_stickers_owner
    ON user_stickers(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_user_stickers_sticker
    ON user_stickers(sticker_id);

COMMENT ON TABLE user_stickers IS 'Mural de stickers recebidos por cada usuário. Um sticker pode ser recebido via gift ou compra direta.';

-- =====================================================
-- 4. ALTER TABLE gifts — adicionar suporte a sticker_catalog
--    (tabela já existe com schema legado: id, post_id,
--     from_user_id, to_user_id, tipo, valor)
-- =====================================================

-- 4a. FK para catálogo de stickers (nullable: gifts legados não têm sticker)
ALTER TABLE gifts
    ADD COLUMN IF NOT EXISTS sticker_id UUID REFERENCES sticker_catalog(id) ON DELETE SET NULL;

-- 4b. Chave de idempotência (nullable: rows legadas ficam com NULL)
ALTER TABLE gifts
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Índice UNIQUE parcial: apenas quando idempotency_key não é null
CREATE UNIQUE INDEX IF NOT EXISTS idx_gifts_idempotency_key
    ON gifts(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 4c. Status do gift
ALTER TABLE gifts
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed'
        CHECK (status IN ('completed', 'failed', 'refunded'));

-- Índices de suporte ao fluxo de gift
CREATE INDEX IF NOT EXISTS idx_gifts_sender     ON gifts(from_user_id);
CREATE INDEX IF NOT EXISTS idx_gifts_receiver   ON gifts(to_user_id);
CREATE INDEX IF NOT EXISTS idx_gifts_sticker_id ON gifts(sticker_id) WHERE sticker_id IS NOT NULL;

COMMENT ON COLUMN gifts.sticker_id IS 'Sticker enviado (do catálogo). NULL para gifts do tipo legado (campo tipo/valor).';
COMMENT ON COLUMN gifts.idempotency_key IS 'Chave única por tentativa de gift para garantir atomicidade. NULL em gifts legados.';
COMMENT ON COLUMN gifts.status IS 'Estado final do gift: completed, failed (rollback) ou refunded.';

-- =====================================================
-- 5. ALTER TABLE posts — colunas de trending e moderação
-- =====================================================
ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS trending_score   FLOAT   NOT NULL DEFAULT 0;

ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS reports_count    INTEGER NOT NULL DEFAULT 0;

ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS reactions_count  INTEGER NOT NULL DEFAULT 0;

ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS comments_count   INTEGER NOT NULL DEFAULT 0;

-- Índice parcial para queries de trending (só posts com score > 0)
CREATE INDEX IF NOT EXISTS idx_posts_trending_score
    ON posts(trending_score DESC) WHERE trending_score > 0;

COMMENT ON COLUMN posts.trending_score IS 'Score calculado no Node.js: (reactions*2 + comments) * EXP(-0.05 * horas_desde_criacao). Atualizado a cada reação/comentário.';
COMMENT ON COLUMN posts.reports_count IS 'Número de denúncias recebidas. Incrementado pelo fluxo de suporte.';
COMMENT ON COLUMN posts.reactions_count IS 'Contador desnormalizado de reações (tipo heart). Atualizado a cada reação.';
COMMENT ON COLUMN posts.comments_count IS 'Contador desnormalizado de comentários. Atualizado a cada comentário.';

-- =====================================================
-- 6. ALTER TABLE users — visibilidade e flags de moderação
-- =====================================================
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS visibility_multiplier FLOAT NOT NULL DEFAULT 1.0
        CHECK (visibility_multiplier >= 0.0 AND visibility_multiplier <= 1.0);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS moderation_flags JSONB NOT NULL
        DEFAULT '{"fake_news": false, "hate_speech": false}'::jsonb;

COMMENT ON COLUMN users.visibility_multiplier IS 'Multiplicador aplicado ao trending_score do usuário. 1.0=normal, 0.7=1ª infração, 0.4=histórico, 0.1=banido. Posts ainda aparecem para seguidores, mas saem do discover/trending.';
COMMENT ON COLUMN users.moderation_flags IS 'Flags de moderação: {fake_news: bool, hate_speech: bool}. Gerenciado pelo moderador humano pós-revisão de IA.';

-- =====================================================
-- 7. RLS para novas tabelas
-- =====================================================
ALTER TABLE sticker_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stickers   ENABLE ROW LEVEL SECURITY;

-- Catálogo: qualquer usuário autenticado pode ler stickers ativos
CREATE POLICY sticker_catalog_select_active ON sticker_catalog
    FOR SELECT USING (is_active = true);

-- Catálogo: apenas service_role pode inserir/atualizar (admin panel usa backend com service_role)
-- (sem política explícita de INSERT/UPDATE = negado para usuários JWT)

-- Mural: usuário vê apenas seus próprios stickers
CREATE POLICY user_stickers_select_owner ON user_stickers
    FOR SELECT USING (owner_user_id = auth.uid()::text);

-- Mural: inserção via backend (service_role bypassa RLS); sem política de INSERT para client JWT
