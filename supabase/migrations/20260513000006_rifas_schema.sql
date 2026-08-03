-- =====================================================
-- MIGRAÇÃO: Domínio Rifas (ElosCloud)
-- Descrição: Tabelas para gestão de rifas e venda de bilhetes.
-- Autor: Léo (ElosCloud)
-- Data: 2026-05-13
-- =====================================================

-- =====================================================
-- 1. TABELA rifas
-- =====================================================
CREATE TABLE rifas (
    id                TEXT PRIMARY KEY,          -- ID do Firestore
    caixinha_id       TEXT NOT NULL REFERENCES caixinhas(id) ON DELETE CASCADE,
    nome              TEXT NOT NULL,
    descricao         TEXT,
    valor_bilhete     NUMERIC NOT NULL,
    quantidade_bilhetes INTEGER NOT NULL,
    data_inicio       TIMESTAMPTZ DEFAULT NOW(),
    data_fim          TIMESTAMPTZ,
    status            TEXT DEFAULT 'ABERTA',     -- 'ABERTA', 'FINALIZADA', 'CANCELADA'
    premio            TEXT,
    sorteio_data      TIMESTAMPTZ,
    sorteio_metodo    TEXT DEFAULT 'RANDOM_ORG',
    sorteio_referencia TEXT,
    sorteio_resultado  JSONB,                    -- {numeroSorteado, vencedor_id, hash, data}
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_rifas_caixinha_id ON rifas(caixinha_id);
CREATE INDEX idx_rifas_status ON rifas(status);

-- =====================================================
-- 2. TABELA rifa_bilhetes
-- =====================================================
CREATE TABLE rifa_bilhetes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rifa_id         TEXT NOT NULL REFERENCES rifas(id) ON DELETE CASCADE,
    numero          INTEGER NOT NULL,
    user_id         TEXT NOT NULL REFERENCES users(id),
    data_compra     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(rifa_id, numero)                      -- Garante que um bilhete não seja vendido duas vezes
);

-- Índices
CREATE INDEX idx_rifa_bilhetes_rifa_id ON rifa_bilhetes(rifa_id);
CREATE INDEX idx_rifa_bilhetes_user_id ON rifa_bilhetes(user_id);

-- =====================================================
-- 3. TRIGGERS (Updated At)
-- =====================================================

CREATE TRIGGER trigger_rifas_updated_at
    BEFORE UPDATE ON rifas
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();

-- =====================================================
-- 4. ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE rifas ENABLE ROW LEVEL SECURITY;
ALTER TABLE rifa_bilhetes ENABLE ROW LEVEL SECURITY;

-- 4.1 Políticas para rifas:
-- Membros da caixinha podem ver as rifas
CREATE POLICY rifas_select_members ON rifas
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM caixinha_members cm
            WHERE cm.caixinha_id = caixinha_id AND cm.user_id = auth.uid()::text
        )
    );

-- 4.2 Políticas para rifa_bilhetes:
-- Membros podem ver quem comprou os bilhetes (transparência)
CREATE POLICY rifa_bilhetes_select_members ON rifa_bilhetes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM caixinha_members cm
            JOIN rifas r ON r.caixinha_id = cm.caixinha_id
            WHERE r.id = rifa_id AND cm.user_id = auth.uid()::text
        )
    );

-- =====================================================
-- 5. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================
COMMENT ON TABLE rifas IS 'Sorteios e rifas realizados dentro das caixinhas';
COMMENT ON TABLE rifa_bilhetes IS 'Registro de venda de bilhetes individuais para as rifas';
