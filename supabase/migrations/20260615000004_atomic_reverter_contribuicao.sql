-- Migration: Atomic RPC for contribution reversal (estorno)
-- Fixes: 3 race conditions in Contribuicao.reverter() — non-atomic read-then-write
-- All steps (mark estornada + create transacao + decrement saldo) in single transaction

CREATE OR REPLACE FUNCTION reverter_contribuicao(
  p_contribuicao_id TEXT,
  p_caixinha_id TEXT,
  p_admin_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contrib contribuicoes%ROWTYPE;
  v_novo_saldo NUMERIC;
  v_transacao_id TEXT;
BEGIN
  -- 1. Lock and fetch the contribution (SELECT FOR UPDATE prevents concurrent modification)
  SELECT * INTO v_contrib
  FROM contribuicoes
  WHERE id = p_contribuicao_id
    AND caixinha_id = p_caixinha_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contribuição não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_contrib.status = 'estornada' THEN
    RAISE EXCEPTION 'Contribuição já foi estornada.' USING ERRCODE = 'P0003';
  END IF;

  IF v_contrib.valor IS NULL OR v_contrib.valor <= 0 THEN
    RAISE EXCEPTION 'Valor da contribuição inválido para estorno.' USING ERRCODE = 'P0004';
  END IF;

  -- 2. Mark contribution as estornada (atomic within this transaction)
  UPDATE contribuicoes
  SET status = 'estornada',
      estornado_em = NOW(),
      estornado_por = p_admin_id
  WHERE id = p_contribuicao_id
    AND caixinha_id = p_caixinha_id;

  -- 3. Create audit transaction record
  v_transacao_id := gen_random_uuid()::TEXT;
  INSERT INTO transacoes (id, caixinha_id, user_id, tipo, valor, data, contribuicao_id)
  VALUES (
    v_transacao_id,
    p_caixinha_id,
    v_contrib.user_id,
    'estorno',
    -(v_contrib.valor),
    NOW(),
    p_contribuicao_id
  );

  -- 4. Atomic saldo decrement with floor check
  UPDATE caixinhas
  SET saldo_total = GREATEST(saldo_total - v_contrib.valor, 0),
      updated_at = NOW()
  WHERE id = p_caixinha_id
  RETURNING saldo_total INTO v_novo_saldo;

  RETURN jsonb_build_object(
    'success', true,
    'contribuicao_id', p_contribuicao_id,
    'valor_estornado', v_contrib.valor,
    'novo_saldo', v_novo_saldo,
    'transacao_id', v_transacao_id
  );
END;
$$;

-- Only service_role can call this
REVOKE EXECUTE ON FUNCTION reverter_contribuicao(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
ALTER FUNCTION reverter_contribuicao(TEXT, TEXT, TEXT) SET search_path = public;
