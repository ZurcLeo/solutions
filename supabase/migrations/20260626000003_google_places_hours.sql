-- ============================================================
-- GP-5: Google Places — Opening Hours & Open-Now Cache
-- ============================================================
-- Adiciona colunas para armazenar horarios de funcionamento
-- do Google Places e cache de "aberto agora", atualizados
-- pelo job de sync periodico (googlePlacesSyncJob).
-- ============================================================

-- 1. Colunas de horarios em seller_profiles
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS google_opening_hours  JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_is_open_now    BOOLEAN DEFAULT NULL;

-- 2. Comentarios
COMMENT ON COLUMN public.seller_profiles.google_opening_hours IS 'Horarios de funcionamento do Google Places (estrutura opening_hours da API: weekday_text, periods, open_now)';
COMMENT ON COLUMN public.seller_profiles.google_is_open_now IS 'Cache de "aberto agora" atualizado no ultimo sync — pode estar defasado entre syncs';
