-- RISCO-03: RPC atômica para atualizar saldo_total sem race condition

CREATE OR REPLACE FUNCTION update_caixinha_saldo(
  p_caixinha_id TEXT,
  p_delta       NUMERIC,
  p_min_saldo   NUMERIC DEFAULT 0
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new NUMERIC;
BEGIN
  UPDATE caixinhas
     SET saldo_total = saldo_total + p_delta,
         updated_at  = NOW()
   WHERE id = p_caixinha_id
     AND (saldo_total + p_delta) >= p_min_saldo
  RETURNING saldo_total INTO v_new;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALDO_INSUFICIENTE'
      USING HINT = 'Operação cancelada: saldo resultante seria negativo ou caixinha não encontrada.',
            ERRCODE = 'P0001';
  END IF;

  RETURN v_new;
END;
$$;

-- Apenas service_role pode chamar a função diretamente
REVOKE ALL ON FUNCTION update_caixinha_saldo(TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_caixinha_saldo(TEXT, NUMERIC, NUMERIC) TO service_role;
