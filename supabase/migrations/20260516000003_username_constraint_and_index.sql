-- =====================================================
-- MIGRAÇÃO: Constraint e índice do campo @username
-- Descrição: Complemento da 20260516000002 — a migration
--            anterior aplicou as colunas mas falhou antes
--            de criar a constraint e o índice.
-- Autor: ClaudIA (ElosCloud)
-- Data: 2026-05-16
-- =====================================================

-- 1. Constraint de formato: apenas letras minúsculas e números, 3–30 chars
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

-- 2. Índice único parcial (apenas rows com username preenchido)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
  ON users(username)
  WHERE username IS NOT NULL;
