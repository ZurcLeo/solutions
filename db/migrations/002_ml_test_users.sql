-- Migration: ml_test_users
-- Persiste credenciais de usuários de teste do Mercado Livre criados via API.
-- O ML não fornece endpoint para listar test users existentes,
-- então salvamos localmente para referência do admin.

CREATE TABLE IF NOT EXISTS ml_test_users (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ml_user_id    BIGINT NOT NULL,
  nickname      VARCHAR(100) NOT NULL,
  password      VARCHAR(100) NOT NULL,
  site_id       VARCHAR(10) NOT NULL DEFAULT 'MLB',
  site_status   VARCHAR(20) NOT NULL DEFAULT 'active',
  role          VARCHAR(20) NOT NULL DEFAULT 'seller' CHECK (role IN ('seller', 'buyer')),
  notes         TEXT,
  created_by    TEXT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expired       BOOLEAN NOT NULL DEFAULT false
);

-- Index para lookup rápido
CREATE INDEX IF NOT EXISTS idx_ml_test_users_created_by ON ml_test_users(created_by);
CREATE INDEX IF NOT EXISTS idx_ml_test_users_expired    ON ml_test_users(expired);

-- RLS: apenas admins podem ler/escrever
ALTER TABLE ml_test_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY ml_test_users_admin_all ON ml_test_users
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid()::text AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid()::text AND role = 'admin')
  );

COMMENT ON TABLE ml_test_users IS 'Credenciais de usuários de teste do Mercado Livre (sandbox em produção)';
