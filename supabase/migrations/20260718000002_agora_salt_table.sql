-- =============================================================================
-- Migration: Mover agora_salt de GUC (current_setting) para tabela de config
-- Motivo: Supabase gerenciado não permite ALTER DATABASE SET app.*
-- =============================================================================

-- 1. Tabela de config interna (1 row, admin-only)
CREATE TABLE IF NOT EXISTS agora_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

ALTER TABLE agora_config ENABLE ROW LEVEL SECURITY;

-- Apenas service_role/superuser pode ler/escrever (triggers rodam como SECURITY DEFINER)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'agora_config' AND policyname = 'agora_config_admin_only'
  ) THEN
    CREATE POLICY "agora_config_admin_only" ON agora_config
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- 2. Inserir o salt (TROQUE pelo valor real antes de aplicar)
INSERT INTO agora_config (key, value)
VALUES ('hmac_salt', 'TROQUE_POR_UM_SECRET_GERADO_COM_openssl_rand_hex_32')
ON CONFLICT (key) DO NOTHING;

-- 3. Recriar a função HMAC para ler da tabela em vez de current_setting
CREATE OR REPLACE FUNCTION agora_hash_user_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_salt TEXT;
BEGIN
  SELECT value INTO v_salt FROM agora_config WHERE key = 'hmac_salt';
  IF v_salt IS NULL OR v_salt = '' THEN
    RAISE EXCEPTION 'agora_config.hmac_salt não configurado';
  END IF;

  NEW.user_id := encode(
    hmac(NEW.user_id::bytea, v_salt::bytea, 'sha256'),
    'hex'
  );

  RETURN NEW;
END;
$$;

-- 4. Recriar função de verificação de voto em enquete
CREATE OR REPLACE FUNCTION agora_user_voted_enquete(p_user_id TEXT, p_enquete_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE
  v_salt TEXT;
  v_hash TEXT;
  v_exists BOOLEAN;
BEGIN
  SELECT value INTO v_salt FROM agora_config WHERE key = 'hmac_salt';
  IF v_salt IS NULL OR v_salt = '' THEN
    RETURN false;
  END IF;

  v_hash := encode(hmac(p_user_id::bytea, v_salt::bytea, 'sha256'), 'hex');

  SELECT EXISTS(
    SELECT 1 FROM agora_respostas_enquete
    WHERE enquete_id = p_enquete_id AND user_id = v_hash
  ) INTO v_exists;

  RETURN v_exists;
END;
$$;

-- 5. Recriar função de verificação de voto em informativo
CREATE OR REPLACE FUNCTION agora_user_voted_informativo(p_user_id TEXT, p_informativo_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE
  v_salt TEXT;
  v_hash TEXT;
  v_exists BOOLEAN;
BEGIN
  SELECT value INTO v_salt FROM agora_config WHERE key = 'hmac_salt';
  IF v_salt IS NULL OR v_salt = '' THEN
    RETURN false;
  END IF;

  v_hash := encode(hmac(p_user_id::bytea, v_salt::bytea, 'sha256'), 'hex');

  SELECT EXISTS(
    SELECT 1 FROM agora_votos_enquete
    WHERE informativo_id = p_informativo_id AND user_id = v_hash
  ) INTO v_exists;

  RETURN v_exists;
END;
$$;
