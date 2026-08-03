-- =====================================================
-- MIGRAÇÃO: Domínio Comunicação - Logs de E-mail (ElosCloud)
-- Descrição: Tabela para registro e auditoria de e-mails enviados.
-- Autor: ClaudIA
-- Data: 2026-05-15
-- =====================================================

-- =====================================================
-- 1. TABELA email_logs
-- =====================================================
CREATE TABLE IF NOT EXISTS email_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_to    TEXT NOT NULL,
    subject         TEXT NOT NULL,
    template_type   TEXT NOT NULL,
    template_data   JSONB DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'sent', 'error', 'resent', 'canceled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at         TIMESTAMPTZ,
    user_id         TEXT,                        -- Firebase UID do remetente/destinatário se cadastrado
    reference_id    TEXT,                        -- ID de entidade relacionada (ex: invite_id)
    reference_type  TEXT,                        -- Tipo da entidade (ex: 'invite')
    message_id      TEXT,                        -- ID do provedor (Resend/SMTP)
    error_message   TEXT,
    retry_count     INTEGER NOT NULL DEFAULT 0,
    metadata        JSONB DEFAULT '{}'
);

-- =====================================================
-- 2. ÍNDICES
-- =====================================================

-- Busca por destinatário
CREATE INDEX IF NOT EXISTS idx_email_logs_to
    ON email_logs(recipient_to);

-- Busca por usuário vinculado
CREATE INDEX IF NOT EXISTS idx_email_logs_user_id
    ON email_logs(user_id);

-- Busca por referência externa
CREATE INDEX IF NOT EXISTS idx_email_logs_reference
    ON email_logs(reference_type, reference_id);

-- Filtro por status e data
CREATE INDEX IF NOT EXISTS idx_email_logs_status_date
    ON email_logs(status, created_at DESC);

-- Ordenação temporal
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at
    ON email_logs(created_at DESC);

-- =====================================================
-- 3. RLS
-- =====================================================
ALTER TABLE email_logs DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- 4. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================
COMMENT ON TABLE email_logs IS 'Registro histórico e auditoria de todos os e-mails disparados pelo sistema.';
COMMENT ON COLUMN email_logs.user_id IS 'UID do Firebase associado ao contexto do e-mail.';
COMMENT ON COLUMN email_logs.reference_id IS 'ID da entidade de negócio que originou o e-mail.';
COMMENT ON COLUMN email_logs.message_id IS 'Identificador único retornado pelo serviço de entrega (Resend API ou Message-ID do SMTP).';
