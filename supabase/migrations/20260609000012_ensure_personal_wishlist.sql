-- ============================================================
-- BARTER-006 (re-apply garantia): Lista de Desejos Pessoal
--
-- A migration original (20260525000004_personal_wishlist.sql) pode não
-- ter sido aplicada no banco. Esta migration é idempotente e garante
-- que a coluna exista antes do deploy.
--
-- Depende de: 20260513000000_identity_schema.sql (tabela users)
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS personal_wishlist TEXT[] DEFAULT '{}';

-- Índice GIN para buscas futuras ("quem quer bicicleta?")
CREATE INDEX IF NOT EXISTS idx_users_personal_wishlist
  ON public.users USING gin(personal_wishlist);

-- ============================================================
-- Verificação pós-migration
-- ============================================================
DO $$ BEGIN
  ASSERT (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'users'
      AND column_name  = 'personal_wishlist'
  ) = 1, 'FALHOU: personal_wishlist não existe em users';

  RAISE NOTICE 'BARTER-006 ensure migration OK — personal_wishlist presente em users';
END $$;
