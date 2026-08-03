-- =====================================================
-- MIGRAÇÃO: Coluna fee_delta gerada em delivery_requests
-- [DELIVERY-FEE-001] Auditoria do delta entre cotação e aceite
--
-- Adiciona coluna GENERATED ALWAYS AS (accepted_fee - quoted_fee) STORED
-- para rastrear a divergência entre fee calculado e fee aceito.
--
-- Non-destructive: coluna nova, sem alteração de dados existentes.
-- Rows com quoted_fee=NULL ou accepted_fee=NULL terão fee_delta=NULL.
--
-- Depende de:
--   20260610000001_delivery_schema.sql (delivery_requests)
--
-- Agente: marketplace-agent | Revisado por: ClaudIA
-- Data: 2026-06-19
-- =====================================================

ALTER TABLE public.delivery_requests
  ADD COLUMN IF NOT EXISTS fee_delta NUMERIC(8, 2)
    GENERATED ALWAYS AS (accepted_fee - quoted_fee) STORED;

COMMENT ON COLUMN public.delivery_requests.fee_delta IS
  '[DELIVERY-FEE-001] Delta entre accepted_fee e quoted_fee (gerado automaticamente). '
  'Positivo = entregador aceitou por mais que a cotacao do sistema. '
  'Negativo = entregador aceitou por menos. NULL = dados incompletos. '
  'Util para auditorias, dashboards de precificacao e deteccao de anomalias.';

-- Indice parcial para queries de anomalia (deltas grandes)
CREATE INDEX IF NOT EXISTS idx_delivery_requests_fee_delta_anomaly
  ON public.delivery_requests (fee_delta)
  WHERE fee_delta IS NOT NULL
    AND abs(fee_delta) > 5.00;
