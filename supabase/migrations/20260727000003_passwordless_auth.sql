-- =============================================================================
-- MIGRATION: AUTH-PL-001 — Passwordless Auth Tables
-- Ticket: AUTH-PL-001
--
-- Cria infraestrutura para autenticação passwordless:
--   1. user_access_codes    — códigos temporários 8-char (24h, email)
--   2. user_webauthn_credentials — passkeys FIDO2 (WebAuthn)
--   3. user_magic_links     — tokens de acesso por email (15min)
--
-- Zero-downtime: apenas CREATE TABLE (sem ALTER em tabelas existentes).
-- =============================================================================

BEGIN;

-- ============================================================
-- 1. user_access_codes — Códigos de acesso temporários
-- ============================================================
-- PIN alfanumérico 8-char (formato XXXX-XXXX), gerado pelo sistema,
-- enviado por email, válido por 24 horas. Hash bcrypt armazenado.
-- Rate limit: max 5 falhas → lockout progressivo no service layer.

CREATE TABLE IF NOT EXISTS public.user_access_codes (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code_hash       TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_codes_user_expires
  ON public.user_access_codes(user_id, expires_at DESC);

-- Cleanup: index para job que remove códigos expirados
CREATE INDEX IF NOT EXISTS idx_access_codes_expired
  ON public.user_access_codes(expires_at)
  WHERE used_at IS NULL;

ALTER TABLE public.user_access_codes ENABLE ROW LEVEL SECURITY;

-- Usuário pode ler seus próprios códigos (para verificar status)
CREATE POLICY "access_codes_own_select" ON public.user_access_codes
  FOR SELECT USING (user_id = auth.uid()::text);

-- Insert/Update via service_role apenas (backend)
REVOKE INSERT, UPDATE, DELETE ON public.user_access_codes FROM anon, authenticated;
GRANT SELECT ON public.user_access_codes TO authenticated;

-- ============================================================
-- 2. user_webauthn_credentials — Passkeys FIDO2
-- ============================================================
-- Armazena chaves públicas WebAuthn. credential_id e public_key
-- são BYTEA (binary) conforme spec FIDO2. counter previne replay.
-- Um usuário pode ter múltiplas passkeys (iPhone + laptop + etc).

CREATE TABLE IF NOT EXISTS public.user_webauthn_credentials (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  credential_id   TEXT NOT NULL UNIQUE,
  public_key      TEXT NOT NULL,
  counter         BIGINT NOT NULL DEFAULT 0,
  device_name     TEXT,
  transports      TEXT[],
  aaguid          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webauthn_user
  ON public.user_webauthn_credentials(user_id);

CREATE INDEX IF NOT EXISTS idx_webauthn_credential_id
  ON public.user_webauthn_credentials(credential_id);

ALTER TABLE public.user_webauthn_credentials ENABLE ROW LEVEL SECURITY;

-- Usuário pode ler e deletar suas próprias passkeys
CREATE POLICY "webauthn_own_select" ON public.user_webauthn_credentials
  FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY "webauthn_own_delete" ON public.user_webauthn_credentials
  FOR DELETE USING (user_id = auth.uid()::text);

-- Insert/Update via service_role apenas (backend registra após verificação)
REVOKE INSERT, UPDATE ON public.user_webauthn_credentials FROM anon, authenticated;
GRANT SELECT, DELETE ON public.user_webauthn_credentials TO authenticated;
REVOKE ALL ON public.user_webauthn_credentials FROM anon;

-- ============================================================
-- 3. user_magic_links — Tokens de acesso por email
-- ============================================================
-- Token aleatório enviado por email, válido 15 minutos, single-use.
-- Hash SHA-256 armazenado (token real nunca salvo em DB).

CREATE TABLE IF NOT EXISTS public.user_magic_links (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_magic_links_user_expires
  ON public.user_magic_links(user_id, expires_at DESC);

-- Cleanup: index para job que remove links expirados
CREATE INDEX IF NOT EXISTS idx_magic_links_expired
  ON public.user_magic_links(expires_at)
  WHERE used_at IS NULL;

-- Lookup por hash (verificação do token)
CREATE INDEX IF NOT EXISTS idx_magic_links_token_hash
  ON public.user_magic_links(token_hash)
  WHERE used_at IS NULL;

ALTER TABLE public.user_magic_links ENABLE ROW LEVEL SECURITY;

-- Leitura própria (para listar logins recentes)
CREATE POLICY "magic_links_own_select" ON public.user_magic_links
  FOR SELECT USING (user_id = auth.uid()::text);

-- Insert/Update via service_role apenas
REVOKE INSERT, UPDATE, DELETE ON public.user_magic_links FROM anon, authenticated;
GRANT SELECT ON public.user_magic_links TO authenticated;

-- ============================================================
-- 4. Rate limiting table — tentativas de login
-- ============================================================
-- Controle de rate limit por email (cross-method).
-- Lockout progressivo: 5 falhas → 15min, 10 → 1h, 15 → 24h.

CREATE TABLE IF NOT EXISTS public.auth_login_attempts (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email           TEXT NOT NULL,
  method          TEXT NOT NULL CHECK (method IN ('access_code', 'magic_link', 'webauthn', 'oauth')),
  success         BOOLEAN NOT NULL DEFAULT false,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time
  ON public.auth_login_attempts(email, created_at DESC);

-- Cleanup: particionar por tempo para purge eficiente
CREATE INDEX IF NOT EXISTS idx_login_attempts_created
  ON public.auth_login_attempts(created_at);

ALTER TABLE public.auth_login_attempts ENABLE ROW LEVEL SECURITY;

-- Nenhum acesso direto — apenas service_role
REVOKE ALL ON public.auth_login_attempts FROM anon, authenticated;

-- ============================================================
-- 5. Helper: função para verificar lockout
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_login_lockout(p_email TEXT)
RETURNS TABLE (
  is_locked    BOOLEAN,
  locked_until TIMESTAMPTZ,
  failed_count INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_failed   INT;
  v_lock_dur INTERVAL;
BEGIN
  -- Contar falhas nas últimas 24h
  SELECT COUNT(*)
  INTO v_failed
  FROM public.auth_login_attempts
  WHERE email = LOWER(TRIM(p_email))
    AND success = false
    AND created_at > NOW() - INTERVAL '24 hours';

  -- Lockout progressivo
  IF v_failed >= 15 THEN
    v_lock_dur := INTERVAL '24 hours';
  ELSIF v_failed >= 10 THEN
    v_lock_dur := INTERVAL '1 hour';
  ELSIF v_failed >= 5 THEN
    v_lock_dur := INTERVAL '15 minutes';
  ELSE
    RETURN QUERY SELECT false, NULL::TIMESTAMPTZ, v_failed;
    RETURN;
  END IF;

  -- Verificar se a última falha + duração ainda está no futuro
  DECLARE
    v_last_fail TIMESTAMPTZ;
  BEGIN
    SELECT MAX(created_at)
    INTO v_last_fail
    FROM public.auth_login_attempts
    WHERE email = LOWER(TRIM(p_email))
      AND success = false
      AND created_at > NOW() - INTERVAL '24 hours';

    IF v_last_fail + v_lock_dur > NOW() THEN
      RETURN QUERY SELECT true, v_last_fail + v_lock_dur, v_failed;
    ELSE
      RETURN QUERY SELECT false, NULL::TIMESTAMPTZ, v_failed;
    END IF;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.check_login_lockout(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_login_lockout(TEXT) TO authenticated;

COMMENT ON FUNCTION public.check_login_lockout(TEXT) IS
  'AUTH-PL-001: Verifica lockout progressivo por email. '
  '5 falhas → 15min, 10 → 1h, 15 → 24h. Reseta com login bem-sucedido.';

-- ============================================================
-- 6. Cleanup job helper: RPC para purgar registros expirados
-- ============================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_auth_records()
RETURNS TABLE (
  codes_deleted    INT,
  links_deleted    INT,
  attempts_deleted INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_codes    INT;
  v_links    INT;
  v_attempts INT;
BEGIN
  -- Códigos expirados (>48h após expiração, margem de segurança)
  DELETE FROM public.user_access_codes
  WHERE expires_at < NOW() - INTERVAL '48 hours';
  GET DIAGNOSTICS v_codes = ROW_COUNT;

  -- Magic links expirados (>24h após expiração)
  DELETE FROM public.user_magic_links
  WHERE expires_at < NOW() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_links = ROW_COUNT;

  -- Tentativas de login > 30 dias
  DELETE FROM public.auth_login_attempts
  WHERE created_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS v_attempts = ROW_COUNT;

  RETURN QUERY SELECT v_codes, v_links, v_attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_auth_records() FROM anon, authenticated;

COMMENT ON FUNCTION public.cleanup_expired_auth_records() IS
  'AUTH-PL-001: Cleanup de registros de autenticação expirados. '
  'Chamar via cron job diário (ex: 05:00 BRT).';

COMMIT;
