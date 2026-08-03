-- =====================================================
-- MIGRAÇÃO: Adicionar @username aos usuários
-- Descrição: Campo de handle único para identificação
--            social (@mentions, perfis públicos, busca)
-- Autor: ClaudIA (ElosCloud)
-- Data: 2026-05-16
-- =====================================================

-- 1. Adicionar coluna username (nullable — não quebra rows existentes)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username VARCHAR(30);

-- 2. Coluna de controle de rate-limit (troca mensal)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username_last_changed_at TIMESTAMPTZ;

-- 3. Constraint de formato: letras, números, underscore, 3–30 chars
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_username_format'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_username_format
      CHECK (username IS NULL OR username ~ '^[a-z0-9]{3,30}$');
  END IF;
END $$;

-- 4. Índice único parcial (apenas rows com username preenchido)
-- CONCURRENTLY não pode rodar dentro de transação — executar separadamente se necessário
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
  ON users(username)
  WHERE username IS NOT NULL;

-- 5. Comentários
COMMENT ON COLUMN users.username IS 'Handle único público do usuário (@username). Editável 1x por mês.';
COMMENT ON COLUMN users.username_last_changed_at IS 'Timestamp da última alteração do username (rate-limit: 30 dias).';
