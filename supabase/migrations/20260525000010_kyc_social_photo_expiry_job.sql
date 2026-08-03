-- =====================================================
-- MIGRAÇÃO: Job de expiração de fotos KYC Social (LGPD)
-- Descrição: pg_cron daily job 03:00 UTC — expira
--            solicitações pendentes e limpa URLs de
--            documentos cujo prazo de 90 dias venceu.
--
-- Épico: SOCIAL-KYC | Task: SOCIAL-KYC-004
-- Desbloqueado por: SOCIAL-KYC-001 (migration 20260525000008)
--
-- Nota: a deleção física do arquivo no Supabase Storage
-- (bucket kyc-docs) é feita via endpoint backend
-- POST /api/kyc-social/admin/cleanup-expired-photos
-- pois pg_cron não tem acesso direto ao Storage API.
--
-- Fallback (se pg_cron não disponível no plano):
-- Usar Supabase Edge Function scheduled ou cron externo
-- que chame POST /api/kyc-social/admin/cleanup-expired-photos
-- com header Authorization: Bearer <ADMIN_TOKEN>.
--
-- Autor: infra-agent (delegado por ClaudIA)
-- Data: 2026-05-25
-- =====================================================

-- Habilitar pg_cron (extensão para jobs agendados no PostgreSQL)
-- Requer plano Supabase com pg_cron habilitado (Pro ou superior).
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Job diário às 03:00 UTC — expiração de fotos KYC Social
SELECT cron.schedule(
  'kyc-social-photo-expiry',   -- nome único do job
  '0 3 * * *',                  -- todo dia às 03:00 UTC
  $$
    -- 1. Marcar solicitações pendentes com foto expirada como 'expired'
    UPDATE kyc_social_requests
    SET status = 'expired'
    WHERE status = 'pending'
      AND document_expires_at IS NOT NULL
      AND document_expires_at < now();

    -- 2. Nulificar URLs de documentos expirados (pending, approved ou rejected)
    --    LGPD: a foto cumpriu seu propósito — URL deve ser removida do banco.
    --    A deleção física do arquivo no Storage é feita via endpoint backend.
    UPDATE kyc_social_requests
    SET document_photo_url = NULL
    WHERE document_photo_url IS NOT NULL
      AND document_expires_at IS NOT NULL
      AND document_expires_at < now();
  $$
);
