-- =====================================================
-- MIGRACAO: Carona Doc Expiry — CARONA-GAP-007
-- Rastreamento de validade de documentos de motoristas
-- e processo de re-verificacao periodica.
--
-- Adiciona:
--   - verification_expires_at (admin define ao aprovar)
--   - last_reverification_at  (ultima re-verificacao)
--   - doc_expiry_notified_at  (dedup de alertas 7d)
--   - Status 'expired' no CHECK constraint
--
-- Agente: claudia-agent | Revisado por: Leo (PO)
-- Data: 2026-08-03
-- =====================================================

-- 1. Atualizar CHECK constraint para incluir 'expired'
ALTER TABLE carona_driver_profiles
  DROP CONSTRAINT IF EXISTS carona_driver_profiles_verification_status_check;

ALTER TABLE carona_driver_profiles
  ADD CONSTRAINT carona_driver_profiles_verification_status_check
  CHECK (verification_status IN ('pending', 'verified', 'rejected', 'expired'));

-- 2. Adicionar colunas de rastreamento de validade
ALTER TABLE carona_driver_profiles
  ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reverification_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS doc_expiry_notified_at  TIMESTAMPTZ;

-- 3. Comentarios para clareza
COMMENT ON COLUMN carona_driver_profiles.verification_expires_at IS
  'Admin define ao aprovar. NULL = sem validade (legado). Motorista nao pode criar corridas apos esta data.';

COMMENT ON COLUMN carona_driver_profiles.last_reverification_at IS
  'Ultima vez que o motorista foi re-verificado por admin.';

COMMENT ON COLUMN carona_driver_profiles.doc_expiry_notified_at IS
  'Ultima vez que motorista foi notificado sobre validade proxima de expirar (dedup 7 dias).';

-- 4. Indice para o cron job de expiracao (motoristas verificados com data de expiracao)
CREATE INDEX IF NOT EXISTS idx_carona_drivers_expiry
  ON carona_driver_profiles (verification_expires_at)
  WHERE verification_status = 'verified'
    AND verification_expires_at IS NOT NULL;


-- =====================================================
-- BLOCO DE VERIFICACAO POS-MIGRACAO
-- Execute no Supabase SQL Editor apos aplicar.
-- =====================================================

-- V1. Novas colunas existem:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'carona_driver_profiles'
--   AND column_name IN ('verification_expires_at', 'last_reverification_at', 'doc_expiry_notified_at');
-- Esperado: 3 colunas TIMESTAMPTZ.

-- V2. CHECK constraint atualizado:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'carona_driver_profiles'::regclass
--   AND conname = 'carona_driver_profiles_verification_status_check';
-- Esperado: inclui 'expired'.

-- V3. Indice criado:
-- SELECT indexname FROM pg_indexes
-- WHERE indexname = 'idx_carona_drivers_expiry';
-- Esperado: 1 resultado.
