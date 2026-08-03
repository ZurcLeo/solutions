-- =====================================================
-- MIGRAÇÃO: Waitlist + Contact Matching (WL-001)
-- Descrição: Lista de espera com matching por HMAC-SHA256
--            de telefone. Privacy-by-design: nunca armazena
--            telefone em texto claro. Matching bidirecional:
--            (1) quando A entra na waitlist, (2) quando B
--            se cadastra na plataforma.
-- Decisões PO:
--   - HMAC-SHA256 com salt do servidor (WAITLIST_SALT)
--   - Mesmo padrão do AGORA_SALT (current_setting)
--   - Contact Picker como progressive enhancement
--   - Input manual como fallback universal
-- Autor: ClaudIA (orquestradora) + Léo (PO)
-- Data: 2026-06-23
-- =====================================================

-- Garante pgcrypto para hmac()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- 1. TABELA waitlist — Lista de espera
-- =====================================================
CREATE TABLE waitlist (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  phone_hash TEXT,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'notified', 'invited', 'joined', 'expired')),
  referral_source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ,
  invited_at TIMESTAMPTZ,
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT waitlist_email_unique UNIQUE (email)
);

COMMENT ON TABLE waitlist IS 'Lista de espera de usuários sem convite. Status: waiting → notified → invited → joined.';
COMMENT ON COLUMN waitlist.phone_hash IS 'HMAC-SHA256 do telefone normalizado com WAITLIST_SALT. Nunca armazena telefone em texto claro.';
COMMENT ON COLUMN waitlist.referral_source IS 'Canal de origem: icl, instagram, indicacao, google, etc. Capturado via ?ref= na URL.';

CREATE INDEX idx_waitlist_status ON waitlist (status);
CREATE INDEX idx_waitlist_email ON waitlist (email);
CREATE INDEX idx_waitlist_referral ON waitlist (referral_source) WHERE referral_source IS NOT NULL;
CREATE INDEX idx_waitlist_created ON waitlist (created_at);

-- =====================================================
-- 2. TABELA phone_hashes — Hashes de telefone de membros
-- =====================================================
CREATE TABLE phone_hashes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  public_matching BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id)
);

COMMENT ON TABLE phone_hashes IS 'HMAC-SHA256 de telefone de membros ativos para matching com waitlist. Opt-out via public_matching=false.';
COMMENT ON COLUMN phone_hashes.public_matching IS 'Opt-out de matching: quando false, o membro não aparece nos resultados de busca da waitlist.';

-- Índice B-tree explícito para performance no ANY() — decisão PO
CREATE UNIQUE INDEX idx_phone_hashes_hash ON phone_hashes (hash);

-- =====================================================
-- 3. TABELA waitlist_contact_hashes — Agenda de A (hashes)
-- =====================================================
CREATE TABLE waitlist_contact_hashes (
  waitlist_id TEXT NOT NULL REFERENCES waitlist(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  matched_at TIMESTAMPTZ,
  PRIMARY KEY (waitlist_id, hash)
);

COMMENT ON TABLE waitlist_contact_hashes IS 'Hashes HMAC-SHA256 dos contatos da agenda de A. Usados para matching reverso quando B entra na plataforma. Retenção máxima: 12 meses.';

CREATE INDEX idx_wch_hash ON waitlist_contact_hashes (hash);
CREATE INDEX idx_wch_unmatched ON waitlist_contact_hashes (hash) WHERE matched_at IS NULL;

-- =====================================================
-- 4. TABELA waitlist_match_notifications — Notificações para B
-- =====================================================
CREATE TABLE waitlist_match_notifications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  notified_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  waitlist_id TEXT NOT NULL REFERENCES waitlist(id) ON DELETE CASCADE,
  waitlist_nome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'invited', 'dismissed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days',
  responded_at TIMESTAMPTZ,
  CONSTRAINT wmn_unique_pair UNIQUE (notified_user_id, waitlist_id)
);

COMMENT ON TABLE waitlist_match_notifications IS 'Notificações enviadas a B quando A da waitlist tem B na agenda. B decide se convida.';

CREATE INDEX idx_wmn_user_pending ON waitlist_match_notifications (notified_user_id, status) WHERE status = 'pending';
CREATE INDEX idx_wmn_expires ON waitlist_match_notifications (expires_at) WHERE status = 'pending';

-- =====================================================
-- 5. RPC: compute_phone_hmac — HMAC centralizado
-- =====================================================
CREATE OR REPLACE FUNCTION compute_phone_hmac(p_phone TEXT)
RETURNS TEXT AS $$
DECLARE
  v_salt TEXT;
  v_normalized TEXT;
BEGIN
  v_salt := current_setting('app.waitlist_salt', true);
  IF v_salt IS NULL OR v_salt = '' THEN
    RAISE EXCEPTION 'app.waitlist_salt não configurado no Supabase';
  END IF;

  -- Normaliza: só dígitos, garante código do país
  v_normalized := regexp_replace(p_phone, '\D', '', 'g');
  IF NOT v_normalized LIKE '55%' THEN
    v_normalized := '55' || v_normalized;
  END IF;

  RETURN encode(hmac(v_normalized::bytea, v_salt::bytea, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION compute_phone_hmac IS 'Computa HMAC-SHA256 de telefone normalizado com WAITLIST_SALT. Usado por waitlistService e phone_hashes.';

-- =====================================================
-- 6. RPC: check_waitlist_on_new_member — Matching reverso
-- =====================================================
CREATE OR REPLACE FUNCTION check_waitlist_on_new_member(
  p_user_id TEXT,
  p_phone_hash TEXT
) RETURNS INTEGER AS $$
DECLARE
  v_match RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_match IN
    SELECT wch.waitlist_id, w.nome
    FROM waitlist_contact_hashes wch
    JOIN waitlist w ON w.id = wch.waitlist_id
    WHERE wch.hash = p_phone_hash
      AND wch.matched_at IS NULL
      AND w.status = 'waiting'
  LOOP
    -- Marca o match
    UPDATE waitlist_contact_hashes
    SET matched_at = now()
    WHERE waitlist_id = v_match.waitlist_id
      AND hash = p_phone_hash;

    -- Cria notificação para o novo membro B (ignora duplicatas)
    INSERT INTO waitlist_match_notifications
      (notified_user_id, waitlist_id, waitlist_nome)
    VALUES
      (p_user_id, v_match.waitlist_id, v_match.nome)
    ON CONFLICT (notified_user_id, waitlist_id) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_waitlist_on_new_member IS 'Chamado quando B registra telefone. Verifica se algum A na waitlist tem B na agenda e cria notificação.';

-- =====================================================
-- 7. RPC: check_waitlist_contacts — Matching direto (batch)
-- =====================================================
CREATE OR REPLACE FUNCTION check_waitlist_contacts(
  p_waitlist_id TEXT,
  p_hashes TEXT[]
) RETURNS INTEGER AS $$
DECLARE
  v_match RECORD;
  v_count INTEGER := 0;
BEGIN
  -- Salva hashes da agenda de A
  INSERT INTO waitlist_contact_hashes (waitlist_id, hash)
  SELECT p_waitlist_id, unnest(p_hashes)
  ON CONFLICT (waitlist_id, hash) DO NOTHING;

  -- Verifica matches com membros ativos
  FOR v_match IN
    SELECT ph.user_id, ph.hash
    FROM phone_hashes ph
    WHERE ph.hash = ANY(p_hashes)
      AND ph.public_matching = true
  LOOP
    -- Marca o match na agenda
    UPDATE waitlist_contact_hashes
    SET matched_at = now()
    WHERE waitlist_id = p_waitlist_id
      AND hash = v_match.hash;

    -- Cria notificação para B
    INSERT INTO waitlist_match_notifications
      (notified_user_id, waitlist_id, waitlist_nome)
    SELECT v_match.user_id, p_waitlist_id, w.nome
    FROM waitlist w WHERE w.id = p_waitlist_id
    ON CONFLICT (notified_user_id, waitlist_id) DO NOTHING;

    v_count := v_count + 1;

    -- Atualiza status da waitlist
    UPDATE waitlist SET status = 'notified', notified_at = now()
    WHERE id = p_waitlist_id AND status = 'waiting';
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_waitlist_contacts IS 'Salva hashes da agenda de A e verifica matches com membros ativos. Retorna número de matches encontrados.';

-- =====================================================
-- 8. RPC: waitlist_invite_accepted — Quando B convida A
-- =====================================================
CREATE OR REPLACE FUNCTION waitlist_invite_accepted(
  p_notification_id TEXT,
  p_inviter_user_id TEXT
) RETURNS TEXT AS $$
DECLARE
  v_notification RECORD;
  v_waitlist_id TEXT;
BEGIN
  SELECT * INTO v_notification
  FROM waitlist_match_notifications
  WHERE id = p_notification_id
    AND notified_user_id = p_inviter_user_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notificação não encontrada ou já processada';
  END IF;

  v_waitlist_id := v_notification.waitlist_id;

  -- Atualiza notificação
  UPDATE waitlist_match_notifications
  SET status = 'invited', responded_at = now()
  WHERE id = p_notification_id;

  -- Atualiza waitlist
  UPDATE waitlist
  SET status = 'invited', invited_at = now(), invited_by = p_inviter_user_id
  WHERE id = v_waitlist_id;

  RETURN v_waitlist_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION waitlist_invite_accepted IS 'Quando B aceita convidar A: atualiza notificação e waitlist. Retorna waitlist_id para o invite flow.';

-- =====================================================
-- 9. RLS Policies
-- =====================================================

-- waitlist: sem acesso direto — apenas via RPCs SECURITY DEFINER
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- phone_hashes: membro vê/edita apenas seu próprio registro
ALTER TABLE phone_hashes ENABLE ROW LEVEL SECURITY;

CREATE POLICY phone_hashes_own_select ON phone_hashes
  FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY phone_hashes_own_insert ON phone_hashes
  FOR INSERT WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY phone_hashes_own_update ON phone_hashes
  FOR UPDATE USING (user_id = auth.uid()::text);

CREATE POLICY phone_hashes_own_delete ON phone_hashes
  FOR DELETE USING (user_id = auth.uid()::text);

-- waitlist_contact_hashes: sem acesso direto
ALTER TABLE waitlist_contact_hashes ENABLE ROW LEVEL SECURITY;

-- waitlist_match_notifications: membro vê apenas notificações para si
ALTER TABLE waitlist_match_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY wmn_own_select ON waitlist_match_notifications
  FOR SELECT USING (notified_user_id = auth.uid()::text);

CREATE POLICY wmn_own_update ON waitlist_match_notifications
  FOR UPDATE USING (notified_user_id = auth.uid()::text);

-- =====================================================
-- 10. pg_cron: Limpeza automática (LGPD — 12 meses)
-- =====================================================

-- Expira notificações pendentes
SELECT cron.schedule(
  'waitlist-expire-notifications',
  '0 4 * * *',
  $$
    UPDATE waitlist_match_notifications
    SET status = 'expired'
    WHERE status = 'pending'
      AND expires_at < now();
  $$
);

-- Limpeza de hashes de contatos após 12 meses ou status terminal
SELECT cron.schedule(
  'waitlist-cleanup-hashes',
  '0 3 * * *',
  $$
    DELETE FROM waitlist_contact_hashes
    WHERE waitlist_id IN (
      SELECT id FROM waitlist
      WHERE created_at < now() - interval '12 months'
         OR status IN ('joined', 'expired')
    );
  $$
);

-- Expira waitlist entries após 12 meses sem ação
SELECT cron.schedule(
  'waitlist-expire-entries',
  '30 3 * * *',
  $$
    UPDATE waitlist
    SET status = 'expired'
    WHERE status = 'waiting'
      AND created_at < now() - interval '12 months';
  $$
);

-- =====================================================
-- FIM DA MIGRAÇÃO
-- =====================================================
