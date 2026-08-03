-- Migration: user_preferences
-- PREFS-001 — Fundação das preferências do usuário (cookie consent, privacidade, notificações)
-- Data: 2026-05-30

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  cookie_prefs       JSONB NOT NULL DEFAULT '{"necessary":true,"functional":false,"analytics":false,"marketing":false,"third_party":false}',
  privacy_prefs      JSONB NOT NULL DEFAULT '{"public_profile":true,"appear_in_searches":true,"activity_visibility":true,"social_function":true,"who_can_add":"everyone"}',
  notification_prefs JSONB NOT NULL DEFAULT '{"channels":{"push":true,"email":true,"sms":false},"events":{"payments":{"push":true,"email":true},"invites":{"push":true,"email":true},"caixinhas":{"push":true,"email":true},"messages":{"push":true,"email":false},"security":{"push":true,"email":true}}}',
  consent_updated_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger: atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION update_user_preferences_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION update_user_preferences_updated_at();

-- Trigger: campos imutáveis — necessary e security não podem ser alterados
CREATE OR REPLACE FUNCTION enforce_immutable_preference_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- cookie_prefs.necessary deve ser sempre true
  IF (NEW.cookie_prefs->>'necessary')::boolean = false THEN
    RAISE EXCEPTION 'cookie_prefs.necessary não pode ser desativado';
  END IF;

  -- notification_prefs.events.security deve ser sempre push:true e email:true
  IF (NEW.notification_prefs->'events'->'security'->>'push')::boolean = false
  OR (NEW.notification_prefs->'events'->'security'->>'email')::boolean = false THEN
    RAISE EXCEPTION 'notification_prefs.events.security não pode ser desativado';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_immutable_preference_fields
  BEFORE INSERT OR UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION enforce_immutable_preference_fields();

-- RLS
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Usuário lê suas próprias preferências
CREATE POLICY "user_preferences_select_own"
  ON user_preferences FOR SELECT
  USING (auth.uid() = user_id);

-- Usuário atualiza suas próprias preferências
CREATE POLICY "user_preferences_update_own"
  ON user_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Usuário insere seu próprio registro (criado automaticamente no registro)
CREATE POLICY "user_preferences_insert_own"
  ON user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Admin lê tudo (para suporte)
-- user_roles.user_id é TEXT, auth.uid() é UUID → cast necessário
-- user_roles.role_id armazena o id do role ('admin', 'moderator', etc.)
CREATE POLICY "user_preferences_select_admin"
  ON user_preferences FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()::text
        AND role_id IN ('admin', 'moderator')
    )
  );

-- Índice para queries por user_id (já é PK, mas deixar explícito)
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

-- Comentários
COMMENT ON TABLE user_preferences IS 'Preferências do usuário: cookie consent (LGPD), privacidade e notificações.';
COMMENT ON COLUMN user_preferences.cookie_prefs IS 'Consentimento de cookies por categoria (LGPD). necessary sempre true.';
COMMENT ON COLUMN user_preferences.privacy_prefs IS 'Configurações de privacidade granular.';
COMMENT ON COLUMN user_preferences.notification_prefs IS 'Preferências de notificação por canal e evento. security sempre true.';
COMMENT ON COLUMN user_preferences.consent_updated_at IS 'Timestamp do último consentimento para auditoria LGPD.';
