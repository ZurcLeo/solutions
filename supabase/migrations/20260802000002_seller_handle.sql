-- [HANDLE-004] Handle publico para seller_profiles
-- Namespace unificado com users.username

-- 1. Adicionar coluna username + rate limit
ALTER TABLE seller_profiles
  ADD COLUMN IF NOT EXISTS username VARCHAR(30),
  ADD COLUMN IF NOT EXISTS username_last_changed_at TIMESTAMPTZ;

-- 2. CHECK constraint (mesma regex de users — HANDLE-003)
ALTER TABLE seller_profiles
  ADD CONSTRAINT seller_profiles_username_format
  CHECK (
    username IS NULL
    OR (
      username ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'
      AND username !~ '--'
    )
  );

-- 3. Unique partial index (apenas non-null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_profiles_username_unique
  ON seller_profiles (username) WHERE username IS NOT NULL;

-- 4. Cross-entity uniqueness: username nao pode existir em users.username
-- Nota: verificacao via application layer (handleService.js) — nao via trigger/FK
-- pois sao tabelas distintas. O handleService.checkAvailability() consulta ambas.
