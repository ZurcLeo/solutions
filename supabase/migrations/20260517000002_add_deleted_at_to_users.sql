-- =====================================================
-- MIGRAÇÃO: Campo deleted_at na tabela users
-- Descrição: Suporte ao direito ao esquecimento (LGPD Art. 18).
--            Registra o momento da anonimização dos dados pessoais.
--            O uid é mantido como referência pseudônima para registros
--            financeiros/legais (LGPD Art. 16, III).
-- Referência: [SEC-009] — auditoria 2026-05-17
-- =====================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Índice parcial: consultas de contas deletadas são raras mas precisam ser rápidas
-- (compliance, auditoria, relatórios de retenção)
CREATE INDEX IF NOT EXISTS idx_users_deleted_at
  ON public.users(deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN public.users.deleted_at IS
  'Timestamp da anonimização LGPD. NULL = conta ativa. Preenchido por eraseUserData().';
