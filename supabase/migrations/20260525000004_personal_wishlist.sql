-- ============================================================
-- BARTER-006: Lista de Desejos Pessoal do Usuário
-- Permite que qualquer usuário registre itens que deseja
-- receber/trocar, independente de nível de acesso.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS personal_wishlist TEXT[] DEFAULT '{}';

-- Índice GIN para buscas futuras (ex: "quem quer bicicleta?")
CREATE INDEX IF NOT EXISTS idx_users_personal_wishlist
  ON users USING gin(personal_wishlist);

-- RLS: usuário só lê/escreve a própria wishlist
-- (A policy existente na tabela users já cobre isso via user_id = auth.uid())
-- Nenhuma policy adicional necessária.

-- Verificação pós-migration
DO $$ BEGIN
  ASSERT (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'personal_wishlist'
  ) = 1, 'personal_wishlist column missing';
  RAISE NOTICE 'BARTER-006 migration OK — personal_wishlist added to users';
END $$;
