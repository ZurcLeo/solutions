-- ============================================================
-- W7: seller_withdrawals — Registro de saques do seller
-- ref: docs/specs/LEDGER-UNIFICADO.md (W7)
-- ============================================================

-- Tabela de controle de saques (audit trail separada do ledger)
CREATE TABLE IF NOT EXISTS seller_withdrawals (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seller_user_id        TEXT NOT NULL,
  amount_brl            NUMERIC(14,2) NOT NULL CHECK (amount_brl > 0),
  fee_brl               NUMERIC(14,2) NOT NULL DEFAULT 0,
  billing_debt_brl      NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount_brl        NUMERIC(14,2) NOT NULL CHECK (net_amount_brl > 0),
  pix_key               TEXT NOT NULL,
  pix_key_type          TEXT NOT NULL DEFAULT 'EVP'
                         CHECK (pix_key_type IN ('CPF','CNPJ','EMAIL','PHONE','EVP')),
  ledger_txn_id         TEXT NOT NULL,
  fee_txn_id            TEXT,
  debt_txn_id           TEXT,
  asaas_transfer_id     TEXT,
  status                TEXT NOT NULL DEFAULT 'pending_transfer'
                         CHECK (status IN (
                           'pending_transfer',   -- aguardando admin transferir manualmente
                           'PENDING',            -- Asaas aceitou, processando
                           'BANK_PROCESSING',    -- Asaas enviou ao banco
                           'DONE',               -- concluido
                           'FAILED',             -- falhou
                           'CANCELLED'           -- cancelado
                         )),
  platform_absorbs_fee  BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_seller_withdrawals_user
  ON seller_withdrawals (seller_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_seller_withdrawals_status
  ON seller_withdrawals (status)
  WHERE status IN ('pending_transfer', 'PENDING', 'BANK_PROCESSING');

-- RLS
ALTER TABLE seller_withdrawals ENABLE ROW LEVEL SECURITY;

-- Seller pode ver seus proprios saques
CREATE POLICY seller_withdrawals_own ON seller_withdrawals
  FOR SELECT
  USING (seller_user_id = auth.uid()::text);

-- Service role (backend) pode tudo
CREATE POLICY seller_withdrawals_service ON seller_withdrawals
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_seller_withdrawals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_seller_withdrawals_updated_at
  BEFORE UPDATE ON seller_withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION update_seller_withdrawals_updated_at();

-- Comentarios
COMMENT ON TABLE seller_withdrawals IS 'Registro de saques de sellers — audit trail separada do ledger';
COMMENT ON COLUMN seller_withdrawals.status IS 'pending_transfer=manual, PENDING/BANK_PROCESSING/DONE/FAILED/CANCELLED=Asaas';
