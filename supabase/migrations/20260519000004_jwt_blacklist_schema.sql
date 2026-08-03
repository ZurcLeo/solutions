-- =====================================================
-- MIGRAÇÃO: JWT Blacklist (migrado de Firestore em 2026-05-19)
-- Descrição: Tabela de tokens JWT revogados (blacklist).
-- =====================================================

CREATE TABLE IF NOT EXISTS jwt_blacklist (
    token      TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jwt_blacklist_created_at ON jwt_blacklist(created_at);

-- Sem RLS — acesso apenas via service_role key (backend)
COMMENT ON TABLE jwt_blacklist IS 'Tokens JWT revogados antes do vencimento natural. Backend usa service_role key para leitura/escrita.';
COMMENT ON COLUMN jwt_blacklist.token IS 'Token JWT completo (ou seu hash). Limpeza automática após expiração (~15 min).';
