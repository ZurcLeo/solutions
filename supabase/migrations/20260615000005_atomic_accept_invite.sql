-- Migration: Atomic RPC for accepting caixinha invites
-- Fixes: Race condition in acceptInvite — check-then-act between membership check and upsert
-- Uses advisory lock + INSERT ON CONFLICT to prevent duplicate memberships

CREATE OR REPLACE FUNCTION accept_caixinha_invite(
  p_invite_id TEXT,
  p_caixinha_id TEXT,
  p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite caixinha_invites%ROWTYPE;
  v_already_member BOOLEAN;
  v_member_id TEXT;
BEGIN
  -- 1. Lock invite row to prevent concurrent acceptance
  SELECT * INTO v_invite
  FROM caixinha_invites
  WHERE id = p_invite_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF v_invite.status != 'pending' THEN
    RAISE EXCEPTION 'Este convite já foi processado (status: %).' , v_invite.status USING ERRCODE = 'P0003';
  END IF;

  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < NOW() THEN
    -- Mark as expired atomically
    UPDATE caixinha_invites SET status = 'expired', responded_at = NOW(), updated_at = NOW()
    WHERE id = p_invite_id;
    RAISE EXCEPTION 'Este convite já expirou.' USING ERRCODE = 'P0004';
  END IF;

  -- Validate target if set
  IF v_invite.target_id IS NOT NULL AND v_invite.target_id != p_user_id THEN
    RAISE EXCEPTION 'Este convite não pertence a você.' USING ERRCODE = 'P0005';
  END IF;

  -- 2. Check existing membership
  SELECT EXISTS(
    SELECT 1 FROM caixinha_members
    WHERE caixinha_id = p_caixinha_id AND user_id = p_user_id
  ) INTO v_already_member;

  -- 3. Accept invite regardless (idempotent)
  UPDATE caixinha_invites
  SET status = 'accepted', responded_at = NOW(), updated_at = NOW()
  WHERE id = p_invite_id;

  -- 4. If already member, return early (idempotent)
  IF v_already_member THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_member', true,
      'caixinha_id', p_caixinha_id,
      'message', 'Você já é membro desta caixinha.'
    );
  END IF;

  -- 5. Atomic member insertion with ON CONFLICT (prevents race condition)
  v_member_id := p_caixinha_id || '_' || p_user_id;
  INSERT INTO caixinha_members (id, caixinha_id, user_id, role, status, active, is_admin, joined_at)
  VALUES (v_member_id, p_caixinha_id, p_user_id, 'membro', 'ativo', true, false, NOW())
  ON CONFLICT (caixinha_id, user_id) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'already_member', false,
    'caixinha_id', p_caixinha_id,
    'member_id', v_member_id,
    'message', 'Convite aceito com sucesso.'
  );
END;
$$;

-- Only service_role can call this
REVOKE EXECUTE ON FUNCTION accept_caixinha_invite(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
ALTER FUNCTION accept_caixinha_invite(TEXT, TEXT, TEXT) SET search_path = public;
