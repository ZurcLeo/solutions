-- =====================================================
-- MIGRAÇÃO: Campo distance_source em delivery_requests
-- [DELIVERY-FEE-002] Rastreia a fonte das distâncias
--
-- Registra se a distância foi calculada via Google Maps ou Haversine.
-- Útil para auditoria de precisão e migração progressiva.
--
-- Rows anteriores à Correção 1 ficam como 'haversine' (default).
--
-- Depende de:
--   20260610000001_delivery_schema.sql (delivery_requests)
--
-- Agente: marketplace-agent | Revisado por: ClaudIA
-- Data: 2026-06-19
-- =====================================================

ALTER TABLE public.delivery_requests
  ADD COLUMN IF NOT EXISTS distance_source TEXT NOT NULL DEFAULT 'haversine'
    CHECK (distance_source IN ('google_maps', 'haversine', 'unknown'));

COMMENT ON COLUMN public.delivery_requests.distance_source IS
  '[DELIVERY-FEE-002] Fonte usada para calculo das distancias. '
  'google_maps = Distance Matrix API (real). '
  'haversine = Haversine x 1.3 (estimativa). '
  'Rows anteriores a Correcao 1 ficam como haversine (default).';
