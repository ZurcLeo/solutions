-- AUTH-PL-006: Migração de usuários existentes + deprecar senhas
-- Adiciona coluna para rastrear notificação de transição passwordless

-- Coluna de tracking: quando o user recebeu o email de transição
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS password_transition_notified_at TIMESTAMPTZ DEFAULT NULL;

-- Índice parcial para batch job: encontrar users não notificados
CREATE INDEX IF NOT EXISTS idx_users_password_transition_pending
  ON public.users (created_at)
  WHERE password_transition_notified_at IS NULL
    AND email IS NOT NULL
    AND deleted_at IS NULL;

COMMENT ON COLUMN public.users.password_transition_notified_at IS
  'Timestamp do envio do email de transição passwordless (AUTH-PL-006). NULL = não notificado.';
