-- =====================================================
-- MIGRAÇÃO: Domínio Interesses (ElosCloud)
-- Descrição: Estrutura relacional para categorias de interesses,
--            catálogo de interesses e vínculos com usuários.
-- Autor: ClaudIA
-- Data: 2026-05-15
-- =====================================================

-- =====================================================
-- 1. TABELA interest_categories
-- =====================================================
CREATE TABLE IF NOT EXISTS interest_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT UNIQUE NOT NULL,
    description TEXT,
    icon        TEXT,                        -- Nome do ícone ou URL
    sort_order  INTEGER NOT NULL DEFAULT 0,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_interest_categories_order ON interest_categories(sort_order);
CREATE INDEX IF NOT EXISTS idx_interest_categories_active ON interest_categories(active);

-- =====================================================
-- 2. TABELA interests
-- =====================================================
CREATE TABLE IF NOT EXISTS interests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id     UUID NOT NULL REFERENCES interest_categories(id) ON DELETE CASCADE,
    label           TEXT NOT NULL,
    description     TEXT,
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(category_id, label)              -- Evita duplicidade na mesma categoria
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_interests_category_id ON interests(category_id);
CREATE INDEX IF NOT EXISTS idx_interests_active ON interests(active);
CREATE INDEX IF NOT EXISTS idx_interests_label ON interests(label);

-- =====================================================
-- 3. TABELA user_interests (M:N)
-- =====================================================
CREATE TABLE IF NOT EXISTS user_interests (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    interest_id UUID NOT NULL REFERENCES interests(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, interest_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_user_interests_user_id ON user_interests(user_id);
CREATE INDEX IF NOT EXISTS idx_user_interests_interest_id ON user_interests(interest_id);

-- =====================================================
-- 4. ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE interest_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_interests ENABLE ROW LEVEL SECURITY;

-- 4.1 Políticas para interest_categories (Leitura pública, Escrita Admin)
CREATE POLICY interest_categories_select_all ON interest_categories
    FOR SELECT USING (active = true);

-- 4.2 Políticas para interests (Leitura pública, Escrita Admin)
CREATE POLICY interests_select_all ON interests
    FOR SELECT USING (active = true);

-- 4.3 Políticas para user_interests (Cada usuário gerencia o seu)
CREATE POLICY user_interests_select_self ON user_interests
    FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY user_interests_insert_self ON user_interests
    FOR INSERT WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY user_interests_delete_self ON user_interests
    FOR DELETE USING (auth.uid()::text = user_id);

-- =====================================================
-- 5. TRIGGERS (Updated At)
-- =====================================================

CREATE TRIGGER trigger_interest_categories_updated_at
    BEFORE UPDATE ON interest_categories
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();

CREATE TRIGGER trigger_interests_updated_at
    BEFORE UPDATE ON interests
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();

-- =====================================================
-- 6. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================
COMMENT ON TABLE interest_categories IS 'Catálogo de categorias de interesses (ex: Lazer, Tecnologia).';
COMMENT ON TABLE interests IS 'Catálogo detalhado de interesses disponíveis para seleção.';
COMMENT ON TABLE user_interests IS 'Tabela de junção mapeando as preferências dos usuários.';
