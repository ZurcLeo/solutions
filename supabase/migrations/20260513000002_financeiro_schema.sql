-- =====================================================
-- MIGRAÇÃO: Domínio Financeiro (ElosCloud)
-- Descrição: Tabelas para contribuições, transações e empréstimos.
-- Autor: Léo (ElosCloud)
-- Data: 2026-05-13
-- =====================================================

-- =====================================================
-- 1. TABELA contribuicoes
-- =====================================================
CREATE TABLE contribuicoes (
    id                TEXT PRIMARY KEY,          -- ID do Firestore
    caixinha_id       TEXT NOT NULL REFERENCES caixinhas(id),
    user_id           TEXT NOT NULL REFERENCES users(id),
    valor             NUMERIC NOT NULL,
    status            TEXT DEFAULT 'confirmada',  -- 'confirmada', 'estornada', 'pendente'
    data_contribuicao TIMESTAMPTZ DEFAULT NOW(),
    estornado_em      TIMESTAMPTZ,
    estornado_por     TEXT REFERENCES users(id),
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_contribuicoes_caixinha_id ON contribuicoes(caixinha_id);
CREATE INDEX idx_contribuicoes_user_id ON contribuicoes(user_id);
CREATE INDEX idx_contribuicoes_status ON contribuicoes(status);

-- =====================================================
-- 2. TABELA emprestimos
-- =====================================================
CREATE TABLE emprestimos (
    id                    TEXT PRIMARY KEY,          -- ID do Firestore
    caixinha_id           TEXT NOT NULL REFERENCES caixinhas(id),
    user_id               TEXT NOT NULL REFERENCES users(id),
    valor_solicitado      NUMERIC NOT NULL,
    valor_total           NUMERIC NOT NULL,          -- valor solicitado + juros
    valor_pago            NUMERIC DEFAULT 0,
    prazo_meses           INTEGER DEFAULT 12,
    status                TEXT DEFAULT 'pendente',   -- 'pendente', 'aprovado', 'rejeitado', 'parcial', 'quitado'
    taxa_juros_aplicada   NUMERIC DEFAULT 0,
    valor_multa_aplicada  NUMERIC DEFAULT 0,
    data_solicitacao      TIMESTAMPTZ DEFAULT NOW(),
    data_aprovacao        TIMESTAMPTZ,
    admin_aprovador       TEXT REFERENCES users(id),
    data_rejeitacao       TIMESTAMPTZ,
    admin_rejeitador      TEXT REFERENCES users(id),
    motivo_rejeitacao     TEXT,
    data_quitacao         TIMESTAMPTZ,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_emprestimos_caixinha_id ON emprestimos(caixinha_id);
CREATE INDEX idx_emprestimos_user_id ON emprestimos(user_id);
CREATE INDEX idx_emprestimos_status ON emprestimos(status);

-- =====================================================
-- 3. TABELA emprestimo_pagamentos (Normalização de parcelas)
-- =====================================================
CREATE TABLE emprestimo_pagamentos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    emprestimo_id   TEXT NOT NULL REFERENCES emprestimos(id) ON DELETE CASCADE,
    valor           NUMERIC NOT NULL,
    data            TIMESTAMPTZ DEFAULT NOW(),
    observacao      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índice
CREATE INDEX idx_emprestimo_pagamentos_emprestimo_id ON emprestimo_pagamentos(emprestimo_id);

-- =====================================================
-- 4. TABELA transacoes (Auditoria Financeira)
-- =====================================================
CREATE TABLE transacoes (
    id                TEXT PRIMARY KEY,          -- ID do Firestore ou gerado
    caixinha_id       TEXT NOT NULL REFERENCES caixinhas(id),
    user_id           TEXT NOT NULL REFERENCES users(id),
    tipo              TEXT NOT NULL,             -- 'contribuicao', 'emprestimo', 'bonus', 'estorno', 'pagamento_emprestimo'
    valor             NUMERIC NOT NULL,          -- valores positivos para entrada, negativos para saída
    data              TIMESTAMPTZ DEFAULT NOW(),
    contribuicao_id   TEXT REFERENCES contribuicoes(id),
    emprestimo_id     TEXT REFERENCES emprestimos(id),
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_transacoes_caixinha_id ON transacoes(caixinha_id);
CREATE INDEX idx_transacoes_user_id ON transacoes(user_id);
CREATE INDEX idx_transacoes_tipo ON transacoes(tipo);

-- =====================================================
-- 5. TRIGGERS (Imutabilidade e Integridade)
-- =====================================================

-- 5.1 Bloquear alteração em transações (Audit Trail)
CREATE OR REPLACE FUNCTION block_transaction_updates()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Transactions are immutable and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_block_transacoes_update
    BEFORE UPDATE OR DELETE ON transacoes
    FOR EACH ROW
    EXECUTE FUNCTION block_transaction_updates();

-- 5.2 Bloquear alteração em contribuições pagas (exceto estorno)
CREATE OR REPLACE FUNCTION block_paid_contribuicao_updates()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'confirmada' AND NEW.status NOT IN ('estornada') THEN
        RAISE EXCEPTION 'Confirmed contributions can only be changed to "estornada".';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_block_contribuicoes_update
    BEFORE UPDATE ON contribuicoes
    FOR EACH ROW
    EXECUTE FUNCTION block_paid_contribuicao_updates();

-- 5.3 Trigger para atualizar `updated_at` na tabela emprestimos
CREATE TRIGGER trigger_emprestimos_updated_at
    BEFORE UPDATE ON emprestimos
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();

-- =====================================================
-- 6. ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE contribuicoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE emprestimos ENABLE ROW LEVEL SECURITY;
ALTER TABLE emprestimo_pagamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE transacoes ENABLE ROW LEVEL SECURITY;

-- 6.1 Políticas para contribuicoes:
-- Membros podem ver suas próprias contribuições ou todas as contribuições da caixinha (se admin)
CREATE POLICY contribuicoes_select_members ON contribuicoes
    FOR SELECT USING (
        user_id = auth.uid()::text OR 
        EXISTS (
            SELECT 1 FROM caixinha_members cm
            WHERE cm.caixinha_id = caixinha_id AND cm.user_id = auth.uid()::text AND cm.role = 'admin'
        )
    );

-- 6.2 Políticas para emprestimos:
-- Membros podem ver seus próprios empréstimos ou todos da caixinha
CREATE POLICY emprestimos_select_members ON emprestimos
    FOR SELECT USING (
        user_id = auth.uid()::text OR 
        EXISTS (
            SELECT 1 FROM caixinha_members cm
            WHERE cm.caixinha_id = caixinha_id AND cm.user_id = auth.uid()::text
        )
    );

-- 6.3 Políticas para transacoes:
-- Transparência: qualquer membro pode ver as transações da caixinha
CREATE POLICY transacoes_select_members ON transacoes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM caixinha_members cm
            WHERE cm.caixinha_id = caixinha_id AND cm.user_id = auth.uid()::text
        )
    );

-- =====================================================
-- 7. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================
COMMENT ON TABLE contribuicoes IS 'Registros de depósitos mensais dos membros';
COMMENT ON TABLE emprestimos IS 'Registros de solicitações e gestão de empréstimos';
COMMENT ON TABLE transacoes IS 'Ledger financeiro auditável de todas as movimentações das caixinhas';
