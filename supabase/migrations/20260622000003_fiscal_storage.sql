-- =====================================================
-- MIGRAÇÃO: Fiscal Storage — Bucket para documentos
-- [FISCAL-002] Bucket privado booking-attachments
--
-- Path: {seller_id}/{booking_id}/{uuid}.{ext}
-- Signed URLs: 1h TTL, geradas pelo backend
--
-- Autor: marketplace-agent (ElosCloud)
-- Data: 2026-06-22
-- =====================================================

-- Criar bucket privado
INSERT INTO storage.buckets (id, name, public)
VALUES ('booking-attachments', 'booking-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Upload policy: autenticados podem fazer upload no path correto
CREATE POLICY "booking_attachments_upload"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'booking-attachments'
        AND (storage.foldername(name))[1] IS NOT NULL
    );

-- Download policy: autenticados podem ler (signed URLs geradas pelo backend)
CREATE POLICY "booking_attachments_read"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (bucket_id = 'booking-attachments');

-- Delete policy: autenticados podem deletar seus próprios uploads
CREATE POLICY "booking_attachments_delete"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'booking-attachments'
        AND owner_id = auth.uid()::text
    );
