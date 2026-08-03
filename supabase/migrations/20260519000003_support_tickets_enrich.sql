-- =====================================================
-- MIGRAÇÃO: Enriquecimento da tabela support_tickets
-- Adiciona colunas ausentes do modelo SupportTicket.js
-- Data: 2026-05-19
-- =====================================================

-- 1. Ampliar o CHECK constraint de status para incluir todos os valores do modelo
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_status_check;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_status_check
    CHECK (status IN ('open', 'pending', 'assigned', 'in_progress', 'resolved', 'closed'));

-- 2. Adicionar colunas ausentes
ALTER TABLE support_tickets
    ADD COLUMN IF NOT EXISTS module              TEXT,
    ADD COLUMN IF NOT EXISTS context             JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS conversation_id     TEXT,
    ADD COLUMN IF NOT EXISTS conversation_history JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS assigned_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS closed_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS notes               JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS internal_notes      JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS user_name           TEXT,
    ADD COLUMN IF NOT EXISTS user_email          TEXT,
    ADD COLUMN IF NOT EXISTS last_message_snippet TEXT,
    ADD COLUMN IF NOT EXISTS tags                TEXT[] DEFAULT '{}';

-- 3. Índices para novos campos
CREATE INDEX IF NOT EXISTS idx_support_tickets_module          ON support_tickets(module);
CREATE INDEX IF NOT EXISTS idx_support_tickets_conversation_id ON support_tickets(conversation_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned_to     ON support_tickets(assigned_to);

-- 4. Comentários
COMMENT ON COLUMN support_tickets.module              IS 'Módulo da aplicação (ex: caixinha, payments, auth).';
COMMENT ON COLUMN support_tickets.context             IS 'Dados contextuais específicos do módulo (JSONB).';
COMMENT ON COLUMN support_tickets.conversation_id     IS 'ID da conversa de suporte por IA, se houver.';
COMMENT ON COLUMN support_tickets.conversation_history IS 'Histórico da conversa com o suporte (JSONB array).';
COMMENT ON COLUMN support_tickets.notes               IS 'Notas públicas adicionadas durante o atendimento.';
COMMENT ON COLUMN support_tickets.internal_notes      IS 'Notas internas (visíveis apenas para a equipe de suporte).';
COMMENT ON COLUMN support_tickets.tags                IS 'Tags para categorização e busca.';
