-- Migration: Adicionar email_verified e email_verified_at na tabela users
-- Contexto: Verificação de email agora usa OTP via nosso emailService (Resend)
-- em vez do sendEmailVerification nativo do Firebase.
-- Supabase passa a ser fonte de verdade para email_verified.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Índice para queries de usuários verificados
CREATE INDEX IF NOT EXISTS idx_users_email_verified
  ON public.users (email_verified)
  WHERE email_verified = TRUE;

COMMENT ON COLUMN public.users.email_verified IS
  'Se o email do usuário foi verificado via OTP (Resend). Fonte de verdade: Supabase.';
COMMENT ON COLUMN public.users.email_verified_at IS
  'Timestamp da verificação de email via OTP.';
