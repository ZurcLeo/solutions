-- Migration: Atomic RPC for loan payment registration
-- Fixes: Race condition in loanService.makePayment() — non-atomic SELECT → INSERT → UPDATE
-- All steps (lock empréstimo + insert pagamento + update empréstimo + audit transação + update saldo) in single transaction

CREATE OR REPLACE FUNCTION registrar_pagamento_emprestimo(
  p_emprestimo_id TEXT,
  p_caixinha_id TEXT,
  p_user_id TEXT,
  p_valor NUMERIC,
  p_observacao TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp emprestimos%ROWTYPE;
  v_novo_valor_pago NUMERIC;
  v_novo_status TEXT;
  v_novo_saldo NUMERIC;
  v_pagamento_id UUID;
  v_transacao_id TEXT;
BEGIN
  -- 0. Validar valor
  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor do pagamento deve ser maior que zero.' USING ERRCODE = 'P0004';
  END IF;

  -- 1. Lock and fetch the loan (SELECT FOR UPDATE prevents concurrent modification)
  SELECT * INTO v_emp
  FROM emprestimos
  WHERE id = p_emprestimo_id
    AND caixinha_id = p_caixinha_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empréstimo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF v_emp.status NOT IN ('aprovado', 'parcial') THEN
    RAISE EXCEPTION 'Pagamento não pode ser registrado para empréstimo no status: %', v_emp.status
      USING ERRCODE = 'P0003';
  END IF;

  -- 2. Calculate new totals
  v_novo_valor_pago := COALESCE(v_emp.valor_pago, 0) + p_valor;
  v_novo_status := CASE
    WHEN v_novo_valor_pago >= v_emp.valor_total THEN 'quitado'
    ELSE 'parcial'
  END;

  -- 3. Insert payment record (atomic within this transaction)
  INSERT INTO emprestimo_pagamentos (emprestimo_id, valor, data, observacao)
  VALUES (p_emprestimo_id, p_valor, NOW(), p_observacao)
  RETURNING id INTO v_pagamento_id;

  -- 4. Update loan (atomic within this transaction)
  UPDATE emprestimos
  SET valor_pago = v_novo_valor_pago,
      status = v_novo_status,
      data_quitacao = CASE WHEN v_novo_status = 'quitado' THEN NOW() ELSE data_quitacao END,
      updated_at = NOW()
  WHERE id = p_emprestimo_id
    AND caixinha_id = p_caixinha_id;

  -- 5. Create audit transaction record
  v_transacao_id := gen_random_uuid()::TEXT;
  INSERT INTO transacoes (id, caixinha_id, user_id, tipo, valor, data, emprestimo_id)
  VALUES (
    v_transacao_id,
    p_caixinha_id,
    p_user_id,
    'pagamento_emprestimo',
    p_valor,
    NOW(),
    p_emprestimo_id
  );

  -- 6. Atomic saldo increment (payment returns money to caixinha)
  UPDATE caixinhas
  SET saldo_total = saldo_total + p_valor,
      updated_at = NOW()
  WHERE id = p_caixinha_id
  RETURNING saldo_total INTO v_novo_saldo;

  RETURN jsonb_build_object(
    'success', true,
    'emprestimo_id', p_emprestimo_id,
    'pagamento_id', v_pagamento_id,
    'valor_pago', p_valor,
    'valor_pago_total', v_novo_valor_pago,
    'novo_status', v_novo_status,
    'novo_saldo', v_novo_saldo,
    'transacao_id', v_transacao_id
  );
END;
$$;

-- Only service_role can call this
REVOKE EXECUTE ON FUNCTION registrar_pagamento_emprestimo(TEXT, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
