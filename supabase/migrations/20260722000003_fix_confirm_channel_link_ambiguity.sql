-- ============================================================================
-- Fix: confirm_channel_link — "column reference phone is ambiguous"
--
-- Root cause: RETURNS TABLE(phone TEXT, ...) creates implicit variable `phone`
-- inside the function body. The UPDATE on line 74 references `phone` without
-- a table alias, so Postgres can't tell if it's the column or the variable.
--
-- Fix: (1) prefix all RETURNS TABLE columns with `out_`, (2) alias the table
-- as `ucl` in every DML, (3) qualify all column references.
--
-- Service side: channelLinkService.confirmLink reads row.link_id, row.phone,
-- row.conversation_id, row.revoked_count — must be updated to out_* names.
-- ============================================================================

-- DROP necessário: CREATE OR REPLACE não permite mudar RETURNS TABLE columns
DROP FUNCTION IF EXISTS confirm_channel_link(TEXT, TEXT);

CREATE OR REPLACE FUNCTION confirm_channel_link(
  p_token_hash TEXT,
  p_user_id TEXT
) RETURNS TABLE(
  out_link_id TEXT,
  out_phone TEXT,
  out_conversation_id TEXT,
  out_revoked_count INTEGER
) AS $$
DECLARE
  v_pending RECORD;
  v_revoked INTEGER;
BEGIN
  -- 1. Buscar e validar o pending
  SELECT * INTO v_pending FROM user_channel_links ucl
    WHERE ucl.link_token_hash = p_token_hash
      AND ucl.status = 'pending'
      AND ucl.token_expires_at > now()
    FOR UPDATE;

  IF v_pending IS NULL THEN
    RAISE EXCEPTION 'invalid_or_expired_token';
  END IF;

  -- 2. Revogar todos os verificados conflitantes (1:1 enforcement)
  UPDATE user_channel_links ucl
    SET status = 'revoked',
        revoked_reason = 'replaced_by_new_link',
        updated_at = now()
    WHERE ucl.status = 'verified'
      AND ucl.channel = v_pending.channel
      AND (ucl.phone = v_pending.phone OR ucl.user_id = p_user_id);
  GET DIAGNOSTICS v_revoked = ROW_COUNT;

  -- 3. Promover pending -> verified
  UPDATE user_channel_links ucl
    SET status = 'verified',
        user_id = p_user_id,
        verified_at = now(),
        link_token_hash = NULL,
        token_expires_at = NULL,
        updated_at = now()
    WHERE ucl.id = v_pending.id AND ucl.status = 'pending';

  -- 4. Retornar dados para o callback
  RETURN QUERY SELECT
    v_pending.id::TEXT,
    v_pending.phone::TEXT,
    v_pending.conversation_id::TEXT,
    v_revoked;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
