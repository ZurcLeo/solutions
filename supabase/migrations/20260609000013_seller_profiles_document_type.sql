-- ============================================================
-- FEAT-MKTPLACE-002: Adiciona document_type a seller_profiles
--
-- Contexto:
--   - document (TEXT) já existe, mas sem distinção de tipo.
--   - Para o fluxo de abertura de loja precisamos saber se o
--     vendedor está usando CPF ou CNPJ.
--   - Quem usa CPF precisa ter KYC validado (users.kyc_level IN ('cpf','document','full')).
--   - Quem informa CNPJ pode abrir a loja sem validação imediata;
--     a validação posterior desbloqueia badge + recursos premium.
--
-- Depende de: 20260524000001_marketplace_schema.sql
-- ============================================================

ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS document_type TEXT
    CHECK (document_type IS NULL OR document_type IN ('cpf', 'cnpj'));

COMMENT ON COLUMN public.seller_profiles.document_type IS
  '[FEAT-MKTPLACE-002] Tipo do documento informado ao abrir a loja. '
  'NULL = não informado (perfis antigos). '
  '''cpf'' = abertura com CPF (requer kyc_level >= ''cpf'' + kyc_status = ''verified''). '
  '''cnpj'' = abertura com CNPJ (validação posterior desbloqueia badge + recursos premium). '
  'document_validated = true indica que o documento já foi verificado pela plataforma.';

-- ============================================================
-- Verificação pós-migration
-- ============================================================
DO $$ BEGIN
  ASSERT (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'seller_profiles'
      AND column_name  = 'document_type'
  ) = 1, 'FALHOU: document_type não adicionada em seller_profiles';

  RAISE NOTICE 'FEAT-MKTPLACE-002 migration OK — document_type adicionada a seller_profiles';
END $$;
