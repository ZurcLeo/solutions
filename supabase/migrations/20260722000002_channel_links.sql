-- ============================================================================
-- Channel Links: vinculação WhatsApp ↔ ElosCloud (Wave A)
-- 1:1 estrito: um phone ↔ uma conta, vínculo novo revoga anteriores
-- ============================================================================

-- ── Tabela ──────────────────────────────────────────────────────────────────

CREATE TABLE user_channel_links (
  id TEXT PRIMARY KEY DEFAULT ('ucl_' || replace(gen_random_uuid()::TEXT, '-', '')),
  user_id TEXT REFERENCES users(id),  -- nullable: pending links não têm user ainda
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'revoked')),
  link_token_hash TEXT,
  token_expires_at TIMESTAMPTZ,
  conversation_id TEXT,
  verified_at TIMESTAMPTZ,
  revoked_reason TEXT
    CHECK (revoked_reason IS NULL OR revoked_reason IN (
      'replaced_by_new_link', 'user_request', 'admin_action'
    )),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 1:1 estrito entre verificados
CREATE UNIQUE INDEX ucl_one_phone ON user_channel_links (channel, phone)
  WHERE status = 'verified';
CREATE UNIQUE INDEX ucl_one_user ON user_channel_links (channel, user_id)
  WHERE status = 'verified';

-- Lookup rápido
CREATE INDEX ucl_phone_lookup ON user_channel_links (channel, phone, status);

-- Trigger updated_at (reutiliza função existente)
CREATE TRIGGER update_user_channel_links_updated_at
  BEFORE UPDATE ON user_channel_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── RPC confirm_channel_link — transação atômica ────────────────────────────

CREATE OR REPLACE FUNCTION confirm_channel_link(
  p_token_hash TEXT,
  p_user_id TEXT
) RETURNS TABLE(
  link_id TEXT,
  phone TEXT,
  conversation_id TEXT,
  revoked_count INTEGER
) AS $$
DECLARE
  v_pending RECORD;
  v_revoked INTEGER;
BEGIN
  -- 1. Buscar e validar o pending
  SELECT * INTO v_pending FROM user_channel_links
    WHERE link_token_hash = p_token_hash
      AND status = 'pending'
      AND token_expires_at > now()
    FOR UPDATE;

  IF v_pending IS NULL THEN
    RAISE EXCEPTION 'invalid_or_expired_token';
  END IF;

  -- 2. Revogar todos os verificados conflitantes (1:1 enforcement)
  UPDATE user_channel_links
    SET status = 'revoked',
        revoked_reason = 'replaced_by_new_link',
        updated_at = now()
    WHERE status = 'verified'
      AND channel = v_pending.channel
      AND (phone = v_pending.phone OR user_id = p_user_id);
  GET DIAGNOSTICS v_revoked = ROW_COUNT;

  -- 3. Promover pending → verified
  UPDATE user_channel_links
    SET status = 'verified',
        user_id = p_user_id,
        verified_at = now(),
        link_token_hash = NULL,
        token_expires_at = NULL,
        updated_at = now()
    WHERE id = v_pending.id AND status = 'pending';

  -- 4. Retornar dados para o callback
  RETURN QUERY SELECT
    v_pending.id,
    v_pending.phone,
    v_pending.conversation_id,
    v_revoked;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE user_channel_links ENABLE ROW LEVEL SECURITY;

-- Users leem próprios links verificados
CREATE POLICY ucl_select_own ON user_channel_links FOR SELECT
  USING (user_id IS NOT NULL AND auth.uid()::TEXT = user_id AND status = 'verified');

-- Todas as mutações via service role (backend)
