-- =====================================================
-- MIGRAÇÃO: Idempotência de webhooks via payment_id em transacoes
-- [MIGR-006] Fix: ledgerService.creditMember() verificava idempotência
-- apenas via Firestore. Adiciona coluna payment_id com constraint UNIQUE
-- para garantia de não-duplicação diretamente no Supabase.
--
-- Impacto: sem reescrita de tabela — ADD COLUMN nullable + index concorrente.
-- =====================================================

ALTER TABLE public.transacoes
  ADD COLUMN IF NOT EXISTS payment_id TEXT;

COMMENT ON COLUMN public.transacoes.payment_id IS
  'ID externo do pagamento (ex: pay_ASAAS_xxx). Usado para idempotência de webhooks. '
  'NULL para transações internas (saques, estornos).';

-- Índice único parcial: só para linhas com payment_id preenchido
-- (transações internas têm payment_id NULL e não participam da constraint)
CREATE UNIQUE INDEX IF NOT EXISTS transacoes_payment_id_unique
  ON public.transacoes (payment_id)
  WHERE payment_id IS NOT NULL;
