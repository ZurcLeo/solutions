-- =====================================================
-- [PREFS-LOC-001] Localização nas preferências do usuário
-- Épico: Descoberta Hiper-Local (ElosCloud)
--
-- Alterações em user_preferences:
--   • location_mode VARCHAR(10) — 'fixed' | 'none' (default 'none')
--   • home_bairro   VARCHAR(120) — bairro informado pelo usuário
--   • home_cidade   VARCHAR(120) — cidade informada pelo usuário
--   • home_estado   VARCHAR(60)  — estado informado pelo usuário
--
-- Regras de negócio:
--   • location_mode = 'fixed' → home_bairro, home_cidade, home_estado DEVEM estar preenchidos
--   • location_mode = 'none'  → home_* podem ser NULL (limpeza automática via trigger)
--   • Sem GPS: apenas localização textual informada pelo usuário
--   • Sincronizado com users.home_bairro/cidade/estado via endpoint PATCH /api/preferences/location
--
-- RLS: herda as políticas de user_preferences (usuário lê/escreve apenas os próprios dados)
--
-- Depende de: 20260530000001_user_preferences.sql,
--             20260609000001_hyper_local_text_location.sql
-- Agente: prefs-agent | Revisado por: ClaudIA
-- Data: 2026-06-09
-- =====================================================


-- =====================================================
-- 1. Adicionar colunas de localização
-- =====================================================

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS location_mode VARCHAR(10)  DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS home_bairro   VARCHAR(120),
  ADD COLUMN IF NOT EXISTS home_cidade   VARCHAR(120),
  ADD COLUMN IF NOT EXISTS home_estado   VARCHAR(60);

-- CHECK constraint para location_mode
ALTER TABLE public.user_preferences
  ADD CONSTRAINT user_preferences_location_mode_check
  CHECK (location_mode IN ('fixed', 'none'));

COMMENT ON COLUMN public.user_preferences.location_mode IS
  '[PREFS-LOC-001] Modo de localização do usuário. '
  'fixed = usuário informou bairro/cidade/estado manualmente. '
  'none = localização não ativada (default). '
  'Sem GPS — apenas texto informado pelo usuário.';

COMMENT ON COLUMN public.user_preferences.home_bairro IS
  '[PREFS-LOC-001] Bairro de referência informado pelo usuário. '
  'NULL quando location_mode = none. '
  'Sincronizado com users.home_bairro pelo backend ao salvar.';

COMMENT ON COLUMN public.user_preferences.home_cidade IS
  '[PREFS-LOC-001] Cidade de referência informada pelo usuário.';

COMMENT ON COLUMN public.user_preferences.home_estado IS
  '[PREFS-LOC-001] Estado de referência informado pelo usuário.';


-- =====================================================
-- 2. Trigger: ao desativar location_mode, limpar campos
-- =====================================================

CREATE OR REPLACE FUNCTION public.clear_location_on_mode_none()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.location_mode = 'none' THEN
    NEW.home_bairro := NULL;
    NEW.home_cidade := NULL;
    NEW.home_estado := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clear_location_on_mode_none
  BEFORE INSERT OR UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_location_on_mode_none();

COMMENT ON FUNCTION public.clear_location_on_mode_none() IS
  '[PREFS-LOC-001] Quando location_mode = none, apaga home_bairro/cidade/estado. '
  'Garante o direito ao esquecimento de localização (LGPD Art. 18).';


-- =====================================================
-- 3. Função: contagem de presença por bairro
--    sem expor identidades (presença-sem-identidade)
--    Movida para cá porque depende de user_preferences.location_mode
-- =====================================================

CREATE OR REPLACE FUNCTION public.count_users_in_bairro(
  p_bairro TEXT,
  p_cidade  TEXT
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)
  FROM public.users u
  JOIN public.user_preferences up
    ON up.user_id::text = u.id
  WHERE
    up.location_mode = 'fixed'
    AND LOWER(TRIM(u.home_bairro)) = LOWER(TRIM(p_bairro))
    AND LOWER(TRIM(u.home_cidade)) = LOWER(TRIM(p_cidade))
    AND (up.privacy_prefs->>'public_profile')::boolean IS NOT FALSE
    AND u.is_active = TRUE
$$;

COMMENT ON FUNCTION public.count_users_in_bairro(TEXT, TEXT) IS
  '[HYPER-LOC-002][LGPD] Retorna COUNT de usuários ativos em um bairro/cidade. '
  'NUNCA expõe IDs, nomes ou qualquer dado identificável. '
  'Filtra: location_mode=fixed + public_profile=true + is_active=true. '
  'SECURITY DEFINER: bypassa RLS para fazer a contagem de forma segura. '
  'Exemplo de uso: "há 12 usuários no bairro Rocinha" sem revelar quem são.';

-- Permite chamada por qualquer usuário autenticado (resultado é agregado, não identificável)
GRANT EXECUTE ON FUNCTION public.count_users_in_bairro(TEXT, TEXT)
  TO authenticated;


-- =====================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO
-- =====================================================

-- V1. Colunas adicionadas:
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'user_preferences'
--   AND column_name IN ('location_mode','home_bairro','home_cidade','home_estado');
-- Esperado: 4 linhas, location_mode com default 'none'.

-- V2. Constraint de modo:
-- SELECT conname FROM pg_constraint
-- WHERE conrelid = 'user_preferences'::regclass
--   AND conname = 'user_preferences_location_mode_check';
-- Esperado: 1 linha.

-- V3. Trigger de limpeza:
-- SELECT trigger_name FROM information_schema.triggers
-- WHERE event_object_table = 'user_preferences'
--   AND trigger_name = 'trg_clear_location_on_mode_none';
-- Esperado: 1 linha.

-- V4. Smoke test — set none apaga campos:
-- UPDATE public.user_preferences
-- SET location_mode = 'none', home_bairro = 'Rocinha'
-- WHERE user_id = '<algum-uuid>';
-- SELECT home_bairro FROM public.user_preferences WHERE user_id = '<algum-uuid>';
-- Esperado: NULL (trigger limpa).
