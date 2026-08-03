-- =====================================================
-- MIGRAÇÃO: RPCs atômicas para ledger de caixinhas
-- Descrição: Substitui o padrão read-then-write do ledgerService
--            por operações atômicas no banco (INSERT + UPDATE em uma tx).
--            credit_member_atomic: idempotente via payment_id (ON CONFLICT DO NOTHING)
--            debit_member_atomic: pessimistic lock via FOR UPDATE + check de saldo
-- Data: 2026-07-09
-- Ref: ledgerService.js creditMember/debitMember — elimina TOCTOU race condition
-- =====================================================

-- =====================================================
-- 1. credit_member_atomic
--    Atomicamente insere transação + incrementa saldos.
--    Idempotente: se payment_id já existe em transacoes, retorna sem modificar saldos.
--    Usa partial UNIQUE index transacoes_payment_id_unique (WHERE payment_id IS NOT NULL).
-- =====================================================
CREATE OR REPLACE FUNCTION credit_member_atomic(
  p_caixinha_id TEXT,
  p_user_id TEXT,
  p_amount NUMERIC,
  p_payment_id TEXT DEFAULT NULL,
  p_tipo TEXT DEFAULT 'contribuicao'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_count INTEGER;
  v_tx_id TEXT := gen_random_uuid()::text;
BEGIN
  -- Validação básica
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Valor de crédito deve ser maior que zero: %', p_amount
      USING ERRCODE = 'P0003';
  END IF;

  -- Step 1: Idempotent INSERT into transacoes
  IF p_payment_id IS NOT NULL THEN
    -- ON CONFLICT usa o partial UNIQUE index transacoes_payment_id_unique
    INSERT INTO transacoes (id, caixinha_id, user_id, tipo, valor, data, payment_id)
    VALUES (v_tx_id, p_caixinha_id, p_user_id, p_tipo, p_amount, NOW(), p_payment_id)
    ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL
    DO NOTHING;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count = 0 THEN
      -- Já processado — retorna sem modificar saldos
      RETURN jsonb_build_object(
        'success', true,
        'alreadyProcessed', true,
        'transactionId', NULL
      );
    END IF;
  ELSE
    -- Sem payment_id — sempre insere (path não-idempotente)
    INSERT INTO transacoes (id, caixinha_id, user_id, tipo, valor, data)
    VALUES (v_tx_id, p_caixinha_id, p_user_id, p_tipo, p_amount, NOW());
  END IF;

  -- Step 2: Atomic increment no saldo do membro (sem read-then-write)
  UPDATE caixinha_members
  SET saldo_virtual = saldo_virtual + p_amount,
      saldo_virtual_updated_at = NOW()
  WHERE caixinha_id = p_caixinha_id AND user_id = p_user_id;

  -- Step 3: Atomic increment no saldo total da caixinha
  UPDATE caixinhas
  SET saldo_total = saldo_total + p_amount,
      updated_at = NOW()
  WHERE id = p_caixinha_id;

  RETURN jsonb_build_object(
    'success', true,
    'alreadyProcessed', false,
    'transactionId', v_tx_id
  );
END;
$$;

COMMENT ON FUNCTION credit_member_atomic(TEXT, TEXT, NUMERIC, TEXT, TEXT) IS
  'Credita saldo de membro atomicamente. '
  'Idempotente via payment_id (ON CONFLICT DO NOTHING no partial UNIQUE index). '
  'Elimina race condition read-then-write do ledgerService.creditMember(). '
  'Retorna {success, alreadyProcessed, transactionId}.';

-- =====================================================
-- 2. debit_member_atomic
--    Atomicamente verifica saldo (FOR UPDATE) + insere transação + decrementa saldos.
--    Pessimistic lock: SELECT ... FOR UPDATE impede débitos concorrentes.
--    Aceita reference_id para rastreabilidade (não idempotente — débitos são únicos).
-- =====================================================
CREATE OR REPLACE FUNCTION debit_member_atomic(
  p_caixinha_id TEXT,
  p_user_id TEXT,
  p_amount NUMERIC,
  p_reference_id TEXT DEFAULT NULL,
  p_tipo TEXT DEFAULT 'debito'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance NUMERIC;
  v_tx_id TEXT := gen_random_uuid()::text;
BEGIN
  -- Validação básica
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Valor de débito deve ser maior que zero: %', p_amount
      USING ERRCODE = 'P0003';
  END IF;

  -- Step 1: Pessimistic lock + check de saldo
  -- FOR UPDATE garante serialização de débitos concorrentes no mesmo membro
  SELECT saldo_virtual
  INTO v_current_balance
  FROM caixinha_members
  WHERE caixinha_id = p_caixinha_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membro não encontrado: caixinha=%, user=%', p_caixinha_id, p_user_id
      USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_current_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'Saldo insuficiente: disponível R$ %, solicitado R$ %',
      COALESCE(v_current_balance, 0), p_amount
      USING ERRCODE = 'P0001';
  END IF;

  -- Step 2: Inserir transação de débito (valor negativo, conforme padrão da tabela)
  INSERT INTO transacoes (id, caixinha_id, user_id, tipo, valor, data, payment_id)
  VALUES (v_tx_id, p_caixinha_id, p_user_id, p_tipo, -p_amount, NOW(), p_reference_id);

  -- Step 3: Atomic decrement no saldo do membro
  UPDATE caixinha_members
  SET saldo_virtual = saldo_virtual - p_amount,
      saldo_virtual_updated_at = NOW()
  WHERE caixinha_id = p_caixinha_id AND user_id = p_user_id;

  -- Step 4: Atomic decrement no saldo total da caixinha
  UPDATE caixinhas
  SET saldo_total = saldo_total - p_amount,
      updated_at = NOW()
  WHERE id = p_caixinha_id;

  RETURN jsonb_build_object(
    'success', true,
    'transactionId', v_tx_id,
    'previousBalance', v_current_balance,
    'newBalance', v_current_balance - p_amount
  );
END;
$$;

COMMENT ON FUNCTION debit_member_atomic(TEXT, TEXT, NUMERIC, TEXT, TEXT) IS
  'Debita saldo de membro atomicamente com pessimistic lock (FOR UPDATE). '
  'Lança exceção P0001 se saldo insuficiente (nunca gera saldo negativo). '
  'reference_id é opcional para rastreabilidade (ex: withdrawal_id). '
  'Retorna {success, transactionId, previousBalance, newBalance}.';
