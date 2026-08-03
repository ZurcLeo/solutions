-- =====================================================
-- MIGRAÇÃO: Domínio Segurança - Tickets de Validação OTP (ElosCloud)
-- Descrição: Tabela centralizada para códigos temporários de verificação
--            (login, saque, kyc, email_verify). Suporta HMAC + brute-force lock.
-- Autor: ClaudIA / auth-agent
-- Data: 2026-05-15
-- =====================================================

-- =====================================================
-- 1. TABELA security_tickets
-- =====================================================
CREATE TABLE IF NOT EXISTS security_tickets (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash      TEXT NOT NULL,        -- hmac-sha256(code, userId+expiresAt, SECURITY_OTP_SECRET)
    type           TEXT NOT NULL
                     CHECK (type IN ('login', 'saque', 'kyc', 'email_verify', 'pagamento_pix')),
    expires_at     TIMESTAMPTZ NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'used', 'expired')),
    attempts_count INT NOT NULL DEFAULT 0,
    locked_until   TIMESTAMPTZ,
    metadata       JSONB NOT NULL DEFAULT '{}',   -- contexto extra (ex: valor saque, caixinha_id)
    ip_address     TEXT,                          -- IP de quem gerou o ticket
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- 2. ÍNDICES
-- =====================================================

-- Queries de validação: buscar ticket pendente por usuário+tipo
CREATE INDEX IF NOT EXISTS idx_security_tickets_user_type_status
    ON security_tickets(user_id, type, status);

-- Cleanup periódico de tickets expirados
CREATE INDEX IF NOT EXISTS idx_security_tickets_expires_at
    ON security_tickets(expires_at)
    WHERE status = 'pending';

-- Ordenação para pegar o mais recente por usuário+tipo
CREATE INDEX IF NOT EXISTS idx_security_tickets_user_type_created
    ON security_tickets(user_id, type, created_at DESC);

-- =====================================================
-- 3. RLS — Apenas service_role escreve; usuário autenticado
--    pode apenas ler seus próprios tickets (via Firebase JWT
--    mapeado em futuras políticas de integração).
--    O backend sempre usa service_role, que bypassa RLS.
-- =====================================================
ALTER TABLE security_tickets ENABLE ROW LEVEL SECURITY;

-- Nenhuma política para anon/authenticated = acesso negado por padrão.
-- O backend usa SUPABASE_SERVICE_ROLE_KEY e bypassa RLS automaticamente.

-- =====================================================
-- 4. COMENTÁRIOS
-- =====================================================
COMMENT ON TABLE security_tickets IS 'Tickets OTP temporários para validação de operações sensíveis (login, saque, kyc, email_verify).';
COMMENT ON COLUMN security_tickets.code_hash IS 'HMAC-SHA256(code, userId+expiresAt.toISOString(), SECURITY_OTP_SECRET). Nunca armazena o código em plaintext.';
COMMENT ON COLUMN security_tickets.type IS 'Contexto da operação: login (10min), saque (5min), kyc (30min), email_verify (60min).';
COMMENT ON COLUMN security_tickets.attempts_count IS 'Contador de tentativas inválidas. Ao atingir 5, locked_until é setado para now()+15min.';
COMMENT ON COLUMN security_tickets.locked_until IS 'Timestamp de desbloqueio após brute-force. NULL = não bloqueado.';
COMMENT ON COLUMN security_tickets.metadata IS 'Dados de contexto da operação, ex: {valor: 500, caixinhaId: "abc"} para saques.';
COMMENT ON COLUMN security_tickets.ip_address IS 'IP do cliente no momento da geração do ticket (auditoria).';
