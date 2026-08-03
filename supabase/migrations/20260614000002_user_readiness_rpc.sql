-- =====================================================
-- MIGRAÇÃO: RPC get_user_readiness (Progressive Feature Unlocking)
-- Descrição: Calcula os 5 gates de prontidão do usuário consultando
--            users, user_preferences e user_payment_methods em uma
--            única chamada. Retorna booleans + lista de itens faltantes.
-- Autor: ClaudIA / compliance-agent
-- Data: 2026-06-14
-- =====================================================

CREATE OR REPLACE FUNCTION get_user_readiness(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user          RECORD;
  v_prefs         RECORD;
  v_has_payment   BOOLEAN := false;

  v_profile_ok    BOOLEAN := false;
  v_address_ok    BOOLEAN := false;
  v_kyc_ok        BOOLEAN := false;
  v_payment_ok    BOOLEAN := false;
  v_juridico_ok   BOOLEAN := false;

  v_missing       JSONB   := '[]'::jsonb;
BEGIN
  -- 1. Dados do usuário
  SELECT full_name, username, telefone, descricao, kyc_status, tipo_de_conta
    INTO v_user
    FROM users
   WHERE id = p_user_id;

  -- 2. Dados de endereço (user_preferences pode não ter linha ainda)
  SELECT addr_res_cep, addr_res_logradouro
    INTO v_prefs
    FROM user_preferences
   WHERE user_id = p_user_id;

  -- 3. Método de pagamento validado
  SELECT EXISTS(
    SELECT 1
      FROM user_payment_methods
     WHERE user_id = p_user_id
       AND is_validated = true
  ) INTO v_has_payment;

  -- ─── Calcular gates ────────────────────────────────────────────────────────

  v_profile_ok := (
    v_user.full_name   IS NOT NULL AND v_user.full_name   <> '' AND
    v_user.username    IS NOT NULL AND v_user.username    <> '' AND
    v_user.telefone    IS NOT NULL AND v_user.telefone    <> '' AND
    v_user.descricao   IS NOT NULL AND v_user.descricao   <> ''
  );

  v_address_ok := (
    v_prefs.addr_res_cep        IS NOT NULL AND v_prefs.addr_res_cep        <> '' AND
    v_prefs.addr_res_logradouro IS NOT NULL AND v_prefs.addr_res_logradouro <> ''
  );

  v_kyc_ok := (v_user.kyc_status = 'verified');

  v_payment_ok := v_has_payment;

  -- JURIDICO_ELIGIBLE: é advogado pelo tipo_de_conta
  -- (contrato-based eligibility é extensão futura via contract_signatories)
  v_juridico_ok := (v_user.tipo_de_conta = 'Advogado');

  -- ─── Montar lista de itens faltantes ───────────────────────────────────────

  IF NOT v_profile_ok THEN
    v_missing := v_missing || jsonb_build_object(
      'gate',  'PROFILE_COMPLETE',
      'label', 'Complete seu perfil',
      'route', '/configuracoes/perfil'
    );
  END IF;

  IF NOT v_address_ok THEN
    v_missing := v_missing || jsonb_build_object(
      'gate',  'ADDRESS_COMPLETE',
      'label', 'Adicione seu endereço',
      'route', '/configuracoes/enderecos'
    );
  END IF;

  IF NOT v_kyc_ok THEN
    v_missing := v_missing || jsonb_build_object(
      'gate',  'KYC_VERIFIED',
      'label', 'Verificação de identidade (CPF)',
      'route', '/configuracoes/seguranca'
    );
  END IF;

  IF NOT v_payment_ok THEN
    v_missing := v_missing || jsonb_build_object(
      'gate',  'PAYMENT_READY',
      'label', 'Dados bancários e PIX validado',
      'route', '/configuracoes/pagamentos'
    );
  END IF;

  -- JURIDICO_ELIGIBLE não entra em missingItems — é um critério de elegibilidade,
  -- não uma tarefa que o usuário pode completar diretamente.

  RETURN jsonb_build_object(
    'PROFILE_COMPLETE',   v_profile_ok,
    'ADDRESS_COMPLETE',   v_address_ok,
    'KYC_VERIFIED',       v_kyc_ok,
    'PAYMENT_READY',      v_payment_ok,
    'JURIDICO_ELIGIBLE',  v_juridico_ok,
    'missingItems',       v_missing
  );
END;
$$;

COMMENT ON FUNCTION get_user_readiness(TEXT) IS
  'Calcula os 5 gates de prontidão do usuário (PROFILE_COMPLETE, ADDRESS_COMPLETE, '
  'KYC_VERIFIED, PAYMENT_READY, JURIDICO_ELIGIBLE) consultando users, '
  'user_preferences e user_payment_methods. Retorna JSONB com booleans + missingItems.';
