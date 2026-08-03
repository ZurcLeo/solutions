-- =====================================================
-- MIGRAÇÃO: Domínio Suporte — Tickets de Atendimento (ElosCloud)
-- Descrição: Tabela de tickets de suporte ao usuário.
--            Espelha o modelo SupportTicket.js do Firestore.
-- Data: 2026-05-19
-- =====================================================

-- =====================================================
-- 1. TABELA support_tickets
-- =====================================================
CREATE TABLE IF NOT EXISTS support_tickets (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category        TEXT,
    issue_type      TEXT,
    subject         TEXT NOT NULL,
    description     TEXT,
    priority        TEXT NOT NULL DEFAULT 'medium',
    status          TEXT NOT NULL DEFAULT 'open',
    attachments     JSONB NOT NULL DEFAULT '[]',
    assigned_to     TEXT,
    resolution      TEXT,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT support_tickets_priority_check  CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    CONSTRAINT support_tickets_status_check    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed'))
);

-- =====================================================
-- 2. ÍNDICES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id  ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status   ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON support_tickets(priority);

-- =====================================================
-- 3. TRIGGER: updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_support_tickets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_support_tickets_updated_at
    BEFORE UPDATE ON support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION update_support_tickets_updated_at();

-- =====================================================
-- 4. ROW LEVEL SECURITY (RLS)
-- =====================================================
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Leitura: próprio usuário ou admin
CREATE POLICY support_tickets_select ON support_tickets
    FOR SELECT USING (
        user_id = auth.uid()::text
        OR check_global_role(auth.uid()::text, 'admin')
    );

-- Inserção: apenas para si mesmo
CREATE POLICY support_tickets_insert_self ON support_tickets
    FOR INSERT WITH CHECK (
        user_id = auth.uid()::text
    );

-- =====================================================
-- 5. COMENTÁRIOS
-- =====================================================
COMMENT ON TABLE support_tickets IS 'Tickets de suporte ao usuário. Espelha o modelo SupportTicket.js do Firestore.';
COMMENT ON COLUMN support_tickets.priority IS 'Prioridade do atendimento: low, medium, high, urgent.';
COMMENT ON COLUMN support_tickets.status IS 'Ciclo de vida: open → in_progress → resolved → closed.';
COMMENT ON COLUMN support_tickets.attachments IS 'Array JSON de URLs de arquivos anexados ao ticket.';
COMMENT ON COLUMN support_tickets.assigned_to IS 'userId do atendente humano ou agente de IA responsável.';
COMMENT ON COLUMN support_tickets.resolution IS 'Texto da resolução, preenchido ao fechar o ticket.';
