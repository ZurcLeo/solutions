-- =====================================================
-- PAY-H0-004: Dead Letter Queue para webhooks PIX Asaas
-- Tabela: pending_webhook_events
-- Adiciona: caixinhas.last_transaction_at
-- =====================================================

-- 1. Coluna last_transaction_at em caixinhas
--    Usada para escopar o scan periódico de reconciliação:
--    apenas caixinhas com atividade recente são verificadas.
ALTER TABLE caixinhas
  ADD COLUMN IF NOT EXISTS last_transaction_at TIMESTAMPTZ;

COMMENT ON COLUMN caixinhas.last_transaction_at IS
  'Timestamp do último crédito PIX confirmado. '
  'Usado pelo job de reconciliação periódica para limitar o escopo do scan.';

-- 2. Tabela DLQ: armazena webhooks PIX que falharam no processamento imediato.
--    O reconciliationJob processa os eventos pendentes a cada 1h.
CREATE TABLE IF NOT EXISTS pending_webhook_events (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_type    TEXT NOT NULL,
  -- STATUS:
  --   pending    → aguardando retry
  --   processing → sendo processado pelo job agora
  --   done       → processado com sucesso
  --   failed     → falhou na última tentativa (ainda tentará se attempts < MAX)
  --   abandoned  → esgotou tentativas (5) → requer intervenção manual
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','done','failed','abandoned')),
  payload       JSONB NOT NULL,          -- corpo completo do webhook Asaas
  attempts      INT NOT NULL DEFAULT 0,
  max_attempts  INT NOT NULL DEFAULT 5,
  last_error    TEXT,
  payment_id    TEXT,                    -- Asaas payment.id (lookup rápido)
  caixinha_id   TEXT,                    -- extraído de externalReference
  user_id       TEXT,                    -- extraído de externalReference
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ
);

COMMENT ON TABLE pending_webhook_events IS
  'DLQ para webhooks Asaas PIX com falha de processamento. '
  'Processado pelo reconciliationJob a cada 1h. '
  'Registros done/abandoned são apagados após 30 dias.';

-- 3. Índices
-- Job DLQ: busca eventos para retry na ordem certa
CREATE INDEX IF NOT EXISTS idx_pwe_status_retry
  ON pending_webhook_events (status, next_retry_at)
  WHERE status IN ('pending', 'failed');

-- Dedup: evita salvar o mesmo webhook duas vezes
CREATE UNIQUE INDEX IF NOT EXISTS idx_pwe_payment_id_unique
  ON pending_webhook_events (payment_id)
  WHERE payment_id IS NOT NULL;

-- Cleanup: encontrar registros antigos por data
CREATE INDEX IF NOT EXISTS idx_pwe_created_at
  ON pending_webhook_events (created_at);

-- 4. RLS: somente service_role (dados financeiros sensíveis)
ALTER TABLE pending_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pwe_service_role_only" ON pending_webhook_events
  USING (auth.role() = 'service_role');

-- 5. Função de cleanup (chamada pelo reconciliationJob periodicamente)
CREATE OR REPLACE FUNCTION cleanup_pending_webhook_events()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM pending_webhook_events
  WHERE created_at < NOW() - INTERVAL '30 days'
    AND status IN ('done', 'abandoned');
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION cleanup_pending_webhook_events() IS
  'Remove registros done/abandoned com mais de 30 dias. '
  'Retorna o número de registros deletados.';

-- 6. Índice no caixinhas.last_transaction_at (scan periódico de caixinhas ativas)
CREATE INDEX IF NOT EXISTS idx_caixinhas_last_transaction_at
  ON caixinhas (last_transaction_at)
  WHERE last_transaction_at IS NOT NULL;
