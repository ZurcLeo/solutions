-- Migration: 20260530000002_payment_method_validation
-- Adds validation_payment_id to user_payment_methods for audit trail.
-- The column stores the Asaas payment ID that triggered the auto-validation.

ALTER TABLE public.user_payment_methods
  ADD COLUMN IF NOT EXISTS validation_payment_id TEXT;

COMMENT ON COLUMN public.user_payment_methods.validation_payment_id
  IS 'Asaas payment ID that confirmed account ownership via micro-deposit PIX (R$ 0,01).';
