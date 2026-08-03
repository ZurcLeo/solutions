-- =====================================================
-- MIGRAÇÃO: Fase 1B — audit_log + used_at em security_tickets
-- Descrição: Tabela de auditoria para ações sensíveis verificadas por OTP/Passkey.
--            Adiciona used_at a security_tickets para janela de verificação precisa.
-- Autor: ClaudIA / auth-agent
-- Data: 2026-05-15
-- =====================================================

-- =====================================================
-- 0. PATCH em security_tickets: coluna used_at
--    (necessária para o middleware requireVerifiedAction
--     calcular a janela de verificação a partir do instante
--     em que o código foi validado, não de quando foi criado)
-- =====================================================
ALTER TABLE security_tickets
    ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

COMMENT ON COLUMN security_tickets.used_at IS
    'Timestamp em que o ticket foi validado com sucesso (status -> used). '
    'Usado pelo middleware requireVerifiedAction para calcular a janela SCA.';

-- Índice para queries do middleware (busca ticket usado recentemente)
CREATE INDEX IF NOT EXISTS idx_security_tickets_user_type_used
    ON security_tickets(user_id, type, used_at DESC)
    WHERE status = 'used';

-- =====================================================
-- 1. TABELA audit_log
-- =====================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action       TEXT        NOT NULL,   -- ex: 'otp_validated', 'saque_autorizado', 'kyc_verificado'
    entity_type  TEXT,                   -- ex: 'caixinha', 'transaction', 'user', 'security_ticket'
    entity_id    TEXT,                   -- ID da entidade alvo da ação
    ticket_id    UUID        REFERENCES security_tickets(id) ON DELETE SET NULL,
    ip_address   TEXT,
    user_agent   TEXT,
    metadata     JSONB       NOT NULL DEFAULT '{}',
    verified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- 2. ÍNDICES
-- =====================================================

-- Histórico de ações por usuário (principal query de auditoria)
CREATE INDEX IF NOT EXISTS idx_audit_log_user_action_date
    ON audit_log(user_id, action, verified_at DESC);

-- Rastreabilidade: qual ticket autorizou qual ação
CREATE INDEX IF NOT EXISTS idx_audit_log_ticket_id
    ON audit_log(ticket_id)
    WHERE ticket_id IS NOT NULL;

-- Rastreabilidade: ações sobre uma entidade específica
CREATE INDEX IF NOT EXISTS idx_audit_log_entity
    ON audit_log(entity_type, entity_id)
    WHERE entity_type IS NOT NULL;

-- Filtro temporal global (relatórios de compliance)
CREATE INDEX IF NOT EXISTS idx_audit_log_verified_at
    ON audit_log(verified_at DESC);

-- =====================================================
-- 3. RLS — service_role only (backend bypassa automaticamente)
-- =====================================================
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
-- Sem policies = deny-by-default para anon/authenticated.

-- =====================================================
-- 4. COMENTÁRIOS
-- =====================================================
COMMENT ON TABLE audit_log IS
    'Registro imutável de auditoria para ações sensíveis verificadas via OTP ou Passkey. '
    'Pilar: Transparência + Responsabilidade (LGPD art. 37).';
COMMENT ON COLUMN audit_log.action      IS 'Ação realizada: otp_validated, saque_autorizado, kyc_verificado, email_verified, etc.';
COMMENT ON COLUMN audit_log.ticket_id   IS 'Referência ao security_ticket que autorizou a operação (rastreabilidade).';
COMMENT ON COLUMN audit_log.entity_type IS 'Tipo do objeto alvo: caixinha, transaction, user, security_ticket, etc.';
COMMENT ON COLUMN audit_log.entity_id   IS 'ID do objeto alvo da ação auditada.';
COMMENT ON COLUMN audit_log.metadata    IS 'Dados contextuais da operação (sem PII sensível).';
