-- =============================================================================
-- Migration: KYC Document Capture — Liveness + Document Photo Verification
-- Épico: KYC-DOC-001
-- Data: 2026-06-16
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Novos campos em user_kyc_verifications (captura de mídia + liveness)
-- -----------------------------------------------------------------------------

ALTER TABLE user_kyc_verifications
  ADD COLUMN IF NOT EXISTS liveness_video_path      TEXT,       -- path no bucket kyc-docs: {uid}/liveness_{ts}.webm
  ADD COLUMN IF NOT EXISTS doc_front_path           TEXT,       -- path no bucket kyc-docs: {uid}/doc_front_{ts}.jpg
  ADD COLUMN IF NOT EXISTS doc_back_path            TEXT,       -- path no bucket kyc-docs: {uid}/doc_back_{ts}.jpg
  ADD COLUMN IF NOT EXISTS liveness_challenge       TEXT,       -- 'blink'|'smile'|'turn_left'|'turn_right'|'nod'
  ADD COLUMN IF NOT EXISTS liveness_passed          BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS name_match_score         INTEGER,    -- 0-100 (fuzzy vs receita_name do CPF)
  ADD COLUMN IF NOT EXISTS document_number_encrypted JSONB,     -- AES-256-GCM, mesmo padrão de cpf_encrypted
  ADD COLUMN IF NOT EXISTS support_ticket_id        TEXT;       -- referência ao ticket gerado no manual_review

COMMENT ON COLUMN user_kyc_verifications.liveness_video_path IS 'Path no bucket kyc-docs para o vídeo de prova de vida (expirado em 90 dias por LGPD).';
COMMENT ON COLUMN user_kyc_verifications.liveness_challenge IS 'Desafio apresentado durante a prova de vida: blink, smile, turn_left, turn_right, nod.';
COMMENT ON COLUMN user_kyc_verifications.name_match_score IS 'Score fuzzy (0-100) entre nome declarado pelo usuário e receita_name da verificação CPF.';
COMMENT ON COLUMN user_kyc_verifications.document_number_encrypted IS 'Número do documento criptografado com AES-256-GCM. Nunca armazenado em plaintext. Mesmo formato de cpf_encrypted.';
COMMENT ON COLUMN user_kyc_verifications.support_ticket_id IS 'ID do ticket de suporte criado automaticamente quando status entra em manual_review.';

-- -----------------------------------------------------------------------------
-- 2. Novos campos em users (dados do documento aprovado)
-- -----------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS document_number_encrypted JSONB,     -- copiado de user_kyc_verifications na aprovação
  ADD COLUMN IF NOT EXISTS document_type            TEXT        CHECK (document_type IN ('rg', 'cnh', 'passport')),
  ADD COLUMN IF NOT EXISTS document_expiry          DATE;

COMMENT ON COLUMN users.document_number_encrypted IS 'Número do documento de identidade criptografado. Preenchido após kyc_level = document.';
COMMENT ON COLUMN users.document_type IS 'Tipo de documento verificado: rg, cnh ou passport.';
COMMENT ON COLUMN users.document_expiry IS 'Data de validade do documento. NULL para documentos sem validade (ex: RG).';

-- -----------------------------------------------------------------------------
-- 3. Índice para fila admin (filtro por nível e status)
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_kyc_verif_level_status
  ON user_kyc_verifications (level, status, created_at DESC)
  WHERE status IN ('manual_review', 'pending');

-- -----------------------------------------------------------------------------
-- 4. Bucket kyc-docs — atualizar políticas de storage
--
-- OBJETIVO:
--   - Usuário pode fazer upload dos próprios arquivos (INSERT only)
--   - Usuário NÃO pode deletar arquivos (auditoria LGPD)
--   - Usuário NÃO pode acessar diretamente (apenas via signed URL pelo backend)
--   - Aceitar video/webm e video/mp4 além de image/*
--
-- NOTA: As políticas de storage do Supabase são configuradas via Supabase Console
-- ou via migrations SQL. As declarações abaixo atualizam as policies existentes.
-- -----------------------------------------------------------------------------

-- Remover política de DELETE do usuário (se existir)
DROP POLICY IF EXISTS "Users can delete own kyc docs" ON storage.objects;

-- Garantir que INSERT é permitido apenas para o próprio usuário
DROP POLICY IF EXISTS "Users can upload own kyc docs" ON storage.objects;
CREATE POLICY "Users can upload own kyc docs"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'kyc-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Remover SELECT direto (admin usa signed URL via service_role)
DROP POLICY IF EXISTS "Users can view own kyc docs" ON storage.objects;

-- Manter UPDATE (para re-upload, ex: foto rejeitada)
DROP POLICY IF EXISTS "Users can update own kyc docs" ON storage.objects;
CREATE POLICY "Users can update own kyc docs"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'kyc-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Atualizar metadata do bucket para aceitar vídeos
-- (tamanho máximo 30MB para vídeos de liveness ~8s a 720p)
UPDATE storage.buckets
SET
  file_size_limit  = 31457280,  -- 30 MB
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/webm',
    'video/mp4',
    'video/quicktime'
  ]
WHERE id = 'kyc-docs';
