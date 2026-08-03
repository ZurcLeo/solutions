-- ============================================================================
-- Validação Inteligente de Comprovantes + Pagamento em Dinheiro
-- Adiciona colunas de validação IA e modo 'cash' ao payment_mode
-- ============================================================================

-- 1. Colunas de validação IA
ALTER TABLE public.contribution_receipts
  ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS ai_extracted_data JSONB,
  ADD COLUMN IF NOT EXISTS ai_validation_status TEXT DEFAULT NULL;

-- CHECK separado para ai_validation_status (se não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contribution_receipts_ai_validation_status_check'
  ) THEN
    ALTER TABLE public.contribution_receipts
      ADD CONSTRAINT contribution_receipts_ai_validation_status_check
      CHECK (ai_validation_status IN ('match', 'mismatch', 'uncertain', 'failed'));
  END IF;
END $$;

-- 2. Expandir payment_mode para incluir 'cash'
ALTER TABLE public.contribution_receipts
  DROP CONSTRAINT IF EXISTS contribution_receipts_payment_mode_check;

ALTER TABLE public.contribution_receipts
  ADD CONSTRAINT contribution_receipts_payment_mode_check
  CHECK (payment_mode IN ('pix_direto', 'pix_asaas', 'cash'));

-- 3. Comentários
COMMENT ON COLUMN public.contribution_receipts.ai_confidence IS
  'Score 0.00-1.00 de confiança da validação por IA';
COMMENT ON COLUMN public.contribution_receipts.ai_extracted_data IS
  'Dados extraídos pela IA: { amount, date, payeeName, transactionId }';
COMMENT ON COLUMN public.contribution_receipts.ai_validation_status IS
  'Resultado da validação IA: match | mismatch | uncertain | failed';
