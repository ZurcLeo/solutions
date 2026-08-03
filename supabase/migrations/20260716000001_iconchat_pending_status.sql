-- 20260716000001_iconchat_pending_status.sql
-- Adiciona admin_confirmed_at para distinguir "pendente admin" de "ativo"
-- Após self-provisioning, is_active=false até admin confirmar no IconChat.

ALTER TABLE public.webhook_subscriptions
  ADD COLUMN IF NOT EXISTS admin_confirmed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.webhook_subscriptions.admin_confirmed_at IS
  'Timestamp de quando o admin confirmou a configuração no lado IconChat. NULL = pendente.';

-- Backfill: subscriptions existentes já foram confirmadas pelo admin (criadas manualmente)
UPDATE public.webhook_subscriptions
SET admin_confirmed_at = created_at
WHERE admin_confirmed_at IS NULL AND is_active = true;
