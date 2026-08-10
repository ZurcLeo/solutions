-- =============================================================================
-- LEDGER UNIFICADO — W1: Schema, RPC, Trigger, RLS, Seed
-- ref: docs/specs/LEDGER-UNIFICADO.md
-- Camada financeira BRL de partidas dobradas.
-- Toda movimentacao e um par de lancamentos que soma zero.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABELAS
-- ref: LEDGER-UNIFICADO.md §Schema
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_type      TEXT NOT NULL CHECK (owner_type IN ('user','platform','caixinha')),
  owner_id        TEXT,                -- NULL quando owner_type = 'platform'
  asaas_wallet_id TEXT,                -- subconta Asaas correspondente, quando houver
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id)
);

COMMENT ON TABLE ledger_accounts IS 'Titulares do ledger: usuarios, plataforma e caixinhas (visibilidade)';

CREATE TABLE IF NOT EXISTS ledger_entries (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  transaction_id TEXT NOT NULL,         -- agrupa lancamentos que somam zero
  account_id     TEXT NOT NULL REFERENCES ledger_accounts(id),
  amount_brl     NUMERIC(14,2) NOT NULL CHECK (amount_brl <> 0),
  status         TEXT NOT NULL CHECK (status IN ('pending','available','settled','reversed')),
  available_at   TIMESTAMPTZ,           -- quando vira sacavel (compensacao Asaas) — ref: D6
  source_type    TEXT NOT NULL CHECK (source_type IN (
    'marketplace_order','carona_ride','delivery','property_stay',
    'service_booking','rifa','subscription','subscription_debt',
    'withdrawal','withdrawal_fee','refund','adjustment'
  )),
  source_id      TEXT,
  description    TEXT NOT NULL,
  asaas_ref      TEXT,                  -- payment_id ou transfer_id do Asaas
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_by    TEXT REFERENCES ledger_entries(id)
);

COMMENT ON TABLE ledger_entries IS 'Lancamentos de partidas dobradas — saldo derivado, nunca armazenado';

CREATE TABLE IF NOT EXISTS ledger_discrepancies (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  check_type      TEXT NOT NULL CHECK (check_type IN ('zero_sum','asaas_coverage','transaction_balance')),
  expected_value  NUMERIC(14,2),
  actual_value    NUMERIC(14,2),
  delta           NUMERIC(14,2),
  transaction_id  TEXT,                 -- preenchido quando check_type = 'transaction_balance'
  resolved        BOOLEAN NOT NULL DEFAULT false,
  resolved_by     TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ledger_discrepancies IS 'Alertas de reconciliacao — discrepancias detectadas pelo job diario';

-- ---------------------------------------------------------------------------
-- 2. INDICES
-- ref: LEDGER-UNIFICADO.md §Schema
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_ledger_account_status
  ON ledger_entries(account_id, status);

CREATE INDEX IF NOT EXISTS idx_ledger_transaction
  ON ledger_entries(transaction_id);

CREATE INDEX IF NOT EXISTS idx_ledger_source
  ON ledger_entries(source_type, source_id);

-- Parcial: so lancamentos pendentes aguardando promocao — ref: D6
CREATE INDEX IF NOT EXISTS idx_ledger_available_at
  ON ledger_entries(status, available_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- 3. TRIGGER DE IMUTABILIDADE — ref: D4 (invariante 3)
-- Impede acrescimo de lancamentos a um transaction_id ja existente.
-- Defesa em profundidade: a RPC gera IDs unicos, mas o trigger protege
-- contra INSERT direto caso o REVOKE seja contornado.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_ledger_entry_immutable_txn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- A RPC record_ledger_transaction seta 'ledger.rpc_active' = 'true'
  -- antes de inserir. Se esse flag esta ativo, permitimos o INSERT
  -- (a RPC ja validou SUM=0 e gera transaction_id unico).
  -- Fora da RPC (INSERT direto), o flag nao existe e o trigger bloqueia
  -- se o transaction_id ja tiver lancamentos.
  IF current_setting('ledger.rpc_active', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Fora da RPC: bloquear se transaction_id ja existe
  IF EXISTS (
    SELECT 1 FROM ledger_entries
    WHERE transaction_id = NEW.transaction_id
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'ledger_immutable: transaction_id "%" ja esta fechado — lancamentos nao podem ser acrescentados',
      NEW.transaction_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- O trigger usa BEFORE INSERT FOR EACH STATEMENT para checar uma vez por batch,
-- nao por linha. Mas FOR EACH STATEMENT nao da acesso a NEW, entao usamos
-- FOR EACH ROW com a checagem de existencia pre-batch (snapshot isolation).
DROP TRIGGER IF EXISTS trg_ledger_entries_immutable ON ledger_entries;
CREATE TRIGGER trg_ledger_entries_immutable
  BEFORE INSERT ON ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION trg_ledger_entry_immutable_txn();

-- ---------------------------------------------------------------------------
-- 4. RPC ATOMICA — ref: D4 (invariantes 1, 2, 3)
--
-- Recebe JSONB array de entries, gera transaction_id, valida SUM=0,
-- valida account_ids, insere tudo atomicamente. Retorna transaction_id.
--
-- SECURITY DEFINER: executa com privilegios do owner (service_role),
-- independente de quem chama. Permite escrita mesmo com INSERT revogado.
--
-- Formato esperado de p_entries:
-- [
--   {
--     "account_id": "...",
--     "amount_brl": 100.00,
--     "status": "pending",
--     "available_at": null,
--     "source_type": "marketplace_order",
--     "source_id": "order_123",
--     "description": "Venda produto X",
--     "asaas_ref": "pay_abc"
--   },
--   { ... }
-- ]
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION record_ledger_transaction(p_entries JSONB)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn_id      TEXT;
  v_sum         NUMERIC(14,2);
  v_entry_count INT;
  v_invalid_accounts TEXT[];
BEGIN
  -- Gerar transaction_id unico (prefixo txn_ + UUID)
  v_txn_id := 'txn_' || gen_random_uuid()::text;

  -- Validar que o array tem >= 2 entries
  v_entry_count := jsonb_array_length(p_entries);
  IF v_entry_count IS NULL OR v_entry_count < 2 THEN
    RAISE EXCEPTION 'ledger_min_entries: transacao requer pelo menos 2 lancamentos, recebeu %',
      COALESCE(v_entry_count, 0)
      USING ERRCODE = 'check_violation';
  END IF;

  -- Validar SUM(amount_brl) = 0 — ref: D4 invariante 1
  SELECT COALESCE(SUM((e->>'amount_brl')::NUMERIC(14,2)), 0)
  INTO v_sum
  FROM jsonb_array_elements(p_entries) AS e;

  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'ledger_zero_sum: soma dos lancamentos deve ser zero, obteve % (transaction_id: %)',
      v_sum, v_txn_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Validar que todos os account_id existem em ledger_accounts
  SELECT array_agg(DISTINCT e->>'account_id')
  INTO v_invalid_accounts
  FROM jsonb_array_elements(p_entries) AS e
  WHERE NOT EXISTS (
    SELECT 1 FROM ledger_accounts la
    WHERE la.id = e->>'account_id'
  );

  IF v_invalid_accounts IS NOT NULL AND array_length(v_invalid_accounts, 1) > 0 THEN
    RAISE EXCEPTION 'ledger_invalid_account: account_id(s) inexistente(s): %',
      array_to_string(v_invalid_accounts, ', ')
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Sinalizar que a RPC esta ativa — o trigger de imutabilidade permite
  -- INSERTs quando este flag esta setado (local a esta transacao SQL).
  PERFORM set_config('ledger.rpc_active', 'true', true);

  -- Inserir todos os lancamentos atomicamente — ref: D4 invariante 2
  INSERT INTO ledger_entries (
    transaction_id,
    account_id,
    amount_brl,
    status,
    available_at,
    source_type,
    source_id,
    description,
    asaas_ref
  )
  SELECT
    v_txn_id,
    e->>'account_id',
    (e->>'amount_brl')::NUMERIC(14,2),
    COALESCE(e->>'status', 'pending'),
    (e->>'available_at')::TIMESTAMPTZ,
    e->>'source_type',
    e->>'source_id',
    e->>'description',
    e->>'asaas_ref'
  FROM jsonb_array_elements(p_entries) AS e;

  RETURN v_txn_id;
END;
$$;

COMMENT ON FUNCTION record_ledger_transaction(JSONB) IS 'Insere grupo de lancamentos atomicamente. Valida SUM=0, >= 2 entries, accounts existem. ref: D4';

-- ---------------------------------------------------------------------------
-- 5. FUNCOES AUXILIARES DE SALDO (derivado, nunca armazenado)
-- ref: LEDGER-UNIFICADO.md §Saldo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ledger_balance(p_account_id TEXT, p_status TEXT DEFAULT 'available')
RETURNS NUMERIC(14,2)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount_brl), 0)::NUMERIC(14,2)
  FROM ledger_entries
  WHERE account_id = p_account_id
    AND status = p_status;
$$;

COMMENT ON FUNCTION ledger_balance(TEXT, TEXT) IS 'Saldo derivado de uma conta por status. Default: available';

CREATE OR REPLACE FUNCTION ledger_balance_full(p_account_id TEXT)
RETURNS TABLE(status TEXT, balance NUMERIC(14,2))
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    le.status,
    COALESCE(SUM(le.amount_brl), 0)::NUMERIC(14,2) AS balance
  FROM ledger_entries le
  WHERE le.account_id = p_account_id
  GROUP BY le.status;
$$;

COMMENT ON FUNCTION ledger_balance_full(TEXT) IS 'Saldo derivado de uma conta, agrupado por status (pending, available, settled, reversed)';

-- ---------------------------------------------------------------------------
-- 6. RLS — ref: LEDGER-UNIFICADO.md §RLS
-- ---------------------------------------------------------------------------

ALTER TABLE ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_discrepancies ENABLE ROW LEVEL SECURITY;

-- ledger_accounts: usuario ve apenas sua conta
CREATE POLICY ledger_accounts_select_own ON ledger_accounts
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid()::text OR owner_type = 'platform');

CREATE POLICY ledger_accounts_service ON ledger_accounts
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ledger_entries: usuario ve lancamentos das suas contas
CREATE POLICY ledger_entries_select_own ON ledger_entries
  FOR SELECT TO authenticated
  USING (
    account_id IN (
      SELECT id FROM ledger_accounts
      WHERE owner_id = auth.uid()::text
    )
  );

CREATE POLICY ledger_entries_service ON ledger_entries
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ledger_discrepancies: somente service_role (admin backend)
CREATE POLICY ledger_discrepancies_service ON ledger_discrepancies
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 7. REVOGAR INSERT DIRETO — ref: D4
-- Somente a RPC record_ledger_transaction (SECURITY DEFINER) escreve.
-- ---------------------------------------------------------------------------

REVOKE INSERT ON ledger_entries FROM authenticated;
REVOKE UPDATE ON ledger_entries FROM authenticated;
REVOKE DELETE ON ledger_entries FROM authenticated;

-- Tambem revogar em ledger_accounts (criacao de contas e via service_role)
REVOKE INSERT ON ledger_accounts FROM authenticated;
REVOKE UPDATE ON ledger_accounts FROM authenticated;
REVOKE DELETE ON ledger_accounts FROM authenticated;

-- ledger_discrepancies: somente service_role
REVOKE ALL ON ledger_discrepancies FROM authenticated;

-- ---------------------------------------------------------------------------
-- 8. SEED — Conta da plataforma
-- ref: LEDGER-UNIFICADO.md §Schema
-- ---------------------------------------------------------------------------

INSERT INTO ledger_accounts (id, owner_type, owner_id)
VALUES ('platform', 'platform', NULL)
ON CONFLICT (owner_type, owner_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 9. FUNCAO DE RECONCILIACAO (helper para o job diario)
-- ref: LEDGER-UNIFICADO.md §Reconciliacao diaria
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ledger_check_integrity()
RETURNS TABLE(
  check_name    TEXT,
  passed        BOOLEAN,
  expected_val  NUMERIC(14,2),
  actual_val    NUMERIC(14,2),
  delta_val     NUMERIC(14,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_sum     NUMERIC(14,2);
  v_bad_txn_count INT;
BEGIN
  -- Check 1: soma global de todos os lancamentos deve ser zero
  SELECT COALESCE(SUM(amount_brl), 0) INTO v_total_sum FROM ledger_entries;

  check_name   := 'zero_sum_global';
  expected_val := 0;
  actual_val   := v_total_sum;
  delta_val    := v_total_sum;
  passed       := (v_total_sum = 0);
  RETURN NEXT;

  -- Se falhou, grava em ledger_discrepancies
  IF v_total_sum <> 0 THEN
    INSERT INTO ledger_discrepancies (check_type, expected_value, actual_value, delta)
    VALUES ('zero_sum', 0, v_total_sum, v_total_sum);
  END IF;

  -- Check 2: cada transaction_id soma zero
  SELECT count(*) INTO v_bad_txn_count
  FROM (
    SELECT transaction_id, SUM(amount_brl) AS txn_sum
    FROM ledger_entries
    GROUP BY transaction_id
    HAVING SUM(amount_brl) <> 0
  ) bad;

  check_name   := 'per_transaction_balance';
  expected_val := 0;
  actual_val   := v_bad_txn_count;
  delta_val    := v_bad_txn_count;
  passed       := (v_bad_txn_count = 0);
  RETURN NEXT;

  -- Gravar cada transacao desbalanceada
  IF v_bad_txn_count > 0 THEN
    INSERT INTO ledger_discrepancies (check_type, expected_value, actual_value, delta, transaction_id)
    SELECT 'transaction_balance', 0, txn_sum, txn_sum, transaction_id
    FROM (
      SELECT transaction_id, SUM(amount_brl) AS txn_sum
      FROM ledger_entries
      GROUP BY transaction_id
      HAVING SUM(amount_brl) <> 0
    ) bad;
  END IF;

  RETURN;
END;
$$;

COMMENT ON FUNCTION ledger_check_integrity() IS 'Verifica integridade do ledger: soma global zero + cada transaction_id soma zero. Grava discrepancias. ref: Reconciliacao diaria';
