-- ============================================================================
-- DOC-001: Cofre de Documentos — Storage Bucket + Policies
-- Bucket dedicado `document-vault` com RLS restritiva.
-- ============================================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Bucket dedicado — privado, 50MB por arquivo
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'document-vault',
  'document-vault',
  false,
  52428800,  -- 50MB
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Storage Policies
-- Upload: autenticados no path {vault_id}/{uuid}.{ext}
-- Download: via signed URL (backend gera)
-- ──────────────────────────────────────────────────────────────────────────────

-- Upload policy: participante do vault pode fazer upload no path do vault
CREATE POLICY vault_storage_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'document-vault'
    AND EXISTS (
      SELECT 1 FROM public.booking_document_vaults v
      WHERE v.id = (storage.foldername(name))[1]
        AND v.status = 'active'
        AND (
          v.client_uid = auth.uid()::text
          OR v.provider_uid = auth.uid()::text
          OR auth.uid()::text = ANY(v.authorized_uids)
        )
    )
  );

-- Read policy: participante do vault pode ler arquivos do vault
CREATE POLICY vault_storage_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'document-vault'
    AND EXISTS (
      SELECT 1 FROM public.booking_document_vaults v
      WHERE v.id = (storage.foldername(name))[1]
        AND (
          v.client_uid = auth.uid()::text
          OR v.provider_uid = auth.uid()::text
          OR auth.uid()::text = ANY(v.authorized_uids)
        )
    )
  );

-- Delete policy: apenas quem fez upload ou service_role
CREATE POLICY vault_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'document-vault'
    AND (owner_id)::text = auth.uid()::text
  );

COMMIT;
