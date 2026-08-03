-- Migration: billing_balance_payment_cols
-- Adds pending_payment_id and last_paid_at to seller_billing_balance
-- for tracking active PIX charges and payment history.

ALTER TABLE public.seller_billing_balance
  ADD COLUMN IF NOT EXISTS pending_payment_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_paid_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.seller_billing_balance.pending_payment_id IS 'Asaas payment ID for the current pending PIX charge (null if none)';
COMMENT ON COLUMN public.seller_billing_balance.last_paid_at IS 'Timestamp of the last successful commission payment';
