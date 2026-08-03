-- 20260801000001_webhook_subscriptions_franchise_pending.sql
-- Adds franchise_pending flag to webhook_subscriptions for tracking provisioning
-- without billing enforcement (fail-open bug fix).
-- When true, adminConfirm must retry franchise.renew before activating.

ALTER TABLE public.webhook_subscriptions
  ADD COLUMN IF NOT EXISTS franchise_pending BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.webhook_subscriptions.franchise_pending IS
  'True when seller was provisioned but franchise setup failed. adminConfirm will retry.';

-- Index for reconciliation queries (find all pending)
CREATE INDEX IF NOT EXISTS idx_ws_franchise_pending
  ON public.webhook_subscriptions (franchise_pending)
  WHERE franchise_pending = true;
