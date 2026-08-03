-- =====================================================
-- MIGRAÇÃO: Supabase Storage — Bucket marketplace-images
-- Autor: infra-agent (ElosCloud)
-- Data: 2026-06-12
--
-- Cria bucket público para imagens do marketplace:
--   {seller_id}/cover/{filename}          — capa da loja
--   {seller_id}/products/{product_id}/{filename} — fotos de produto
--
-- RLS:
--   Leitura pública (bucket público)
--   Escrita apenas pelo dono do seller_profile (seller_id = primeiro segmento do path)
-- =====================================================

-- Criar bucket marketplace-images (público para leitura)
INSERT INTO storage.buckets (id, name, public)
VALUES ('marketplace-images', 'marketplace-images', true)
ON CONFLICT (id) DO NOTHING;

-- ── Políticas de acesso ──────────────────────────────────────────────────────

-- 1. Leitura pública
CREATE POLICY "marketplace_images_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'marketplace-images');

-- 2. Upload: apenas seller dono do path ({seller_id}/...)
CREATE POLICY "marketplace_images_seller_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'marketplace-images' AND
  EXISTS (
    SELECT 1 FROM public.seller_profiles
    WHERE user_id = auth.uid()::text
      AND id      = (storage.foldername(name))[1]
  )
);

-- 3. Update: mesmo critério
CREATE POLICY "marketplace_images_seller_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'marketplace-images' AND
  EXISTS (
    SELECT 1 FROM public.seller_profiles
    WHERE user_id = auth.uid()::text
      AND id      = (storage.foldername(name))[1]
  )
);

-- 4. Delete: mesmo critério
CREATE POLICY "marketplace_images_seller_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'marketplace-images' AND
  EXISTS (
    SELECT 1 FROM public.seller_profiles
    WHERE user_id = auth.uid()::text
      AND id      = (storage.foldername(name))[1]
  )
);
