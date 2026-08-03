-- =====================================================
-- MIGRAÇÃO: Bucket Storage kyc-docs
-- Épico: SOCIAL-KYC | Task: SOCIAL-KYC-004
-- Referência: docs/business/KYC_SOCIAL.md §Fotos de documento
--
-- Cria o bucket privado `kyc-docs` para armazenamento
-- de fotos de documentos enviadas opcionalmente durante
-- o fluxo de KYC Social. O bucket NUNCA é público:
--  - Acesso ao frontend: sempre via signed URL (TTL 5min)
--  - Limpeza automática: pg_cron job (migration 20260525000010)
--  - Expiração: 90 dias após document_uploaded_at (trigger kyc_social_schema)
--
-- LGPD: document_photo_url nunca retornado via API pública
--       (Interface Cega — getRequestForValidation)
-- =====================================================

-- 1. Criar bucket privado
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'kyc-docs',
  'kyc-docs',
  false,                                              -- nunca público
  5242880,                                            -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 2. Solicitante pode fazer upload do próprio documento
--    Path esperado: {user_id}/nome-do-arquivo.ext
CREATE POLICY "kyc_docs_upload_own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'kyc-docs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 3. Solicitante pode substituir (update) o próprio documento
CREATE POLICY "kyc_docs_update_own"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'kyc-docs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 4. Solicitante pode deletar o próprio documento
--    (necessário para o job de limpeza LGPD operar via service_role também)
CREATE POLICY "kyc_docs_delete_own"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'kyc-docs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 5. Leitura via SELECT é bloqueada para todos os roles autenticados.
--    O backend gera signed URLs com TTL de 5 minutos via service_role.
--    Nenhuma policy SELECT é criada — acesso direto ao objeto é negado por padrão.

-- =====================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar:
-- =====================================================

-- V1. Confirmar que o bucket existe e é privado:
-- SELECT id, name, public, file_size_limit, allowed_mime_types
-- FROM storage.buckets WHERE id = 'kyc-docs';
-- Esperado: 1 linha com public = false.

-- V2. Confirmar que as 3 policies foram criadas:
-- SELECT policyname, cmd FROM pg_policies
-- WHERE tablename = 'objects' AND policyname LIKE 'kyc_docs_%';
-- Esperado: 3 linhas (INSERT, UPDATE, DELETE).
