-- =====================================================
-- [HYPER-LOC-001] Campos de localização textual hierárquica
-- Épico: Descoberta Hiper-Local (ElosCloud)
--
-- Decisão de privacidade aprovada por Léo (2026-06-09):
--   Localização = texto (bairro/cidade/estado), NUNCA coordenadas GPS.
--   Proximidade calculada por hierarquia textual — sem PostGIS para usuários.
--
-- Alterações:
--   • users              — home_bairro, home_cidade, home_estado + índices
--   • seller_profiles    — address_state (complementa address_neighborhood + address_city)
--   • posts              — post_bairro, post_cidade, post_estado (snapshot ao postar)
--
-- RPC criada:
--   • get_location_level(u_*, t_*) → 0=mesmo bairro, 1=mesma cidade, 2=mesmo estado, 3=fora
--
-- Multiplicadores de relevância (usados pelo social-agent e marketplace-agent no Sprint B):
--   Nível 0 → ×3.0 | Nível 1 → ×1.8 | Nível 2 → ×1.2 | Nível 3 → ×0.6
--
-- Zero-downtime:
--   • Todos os campos são NULLABLE — sem bloqueio de tabela
--   • Índices PARCIAIS (WHERE NOT NULL) — menores, mais rápidos
--   • RPC IMMUTABLE — segura para otimização do planner
--
-- Depende de: 20260513000000_identity_schema.sql (users),
--             20260513000005_social_feed_schema.sql (posts),
--             20260524000001_marketplace_schema.sql (seller_profiles)
-- Agente: infra-agent | Revisado por: ClaudIA
-- Data: 2026-06-09
-- =====================================================


-- =====================================================
-- 1. users — campos de localização do usuário
-- =====================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS home_bairro VARCHAR(120),
  ADD COLUMN IF NOT EXISTS home_cidade VARCHAR(120),
  ADD COLUMN IF NOT EXISTS home_estado VARCHAR(60);

COMMENT ON COLUMN public.users.home_bairro IS
  '[HYPER-LOC-001] Bairro de referência do usuário (texto normalizado, ex: "Rocinha"). '
  'NUNCA coordenadas GPS — decisão de privacidade por design (LGPD). '
  'Preenchido via Preferências → Localização quando location_mode = fixed. '
  'Visível APENAS para o próprio usuário e membros de caixinhas em comum (RLS).';

COMMENT ON COLUMN public.users.home_cidade IS
  '[HYPER-LOC-001] Cidade de referência do usuário (ex: "Rio de Janeiro"). '
  'Usado no cálculo de get_location_level para ranking geográfico do feed.';

COMMENT ON COLUMN public.users.home_estado IS
  '[HYPER-LOC-001] Estado de referência do usuário — sigla ou nome (ex: "RJ"). '
  'Usado no cálculo de get_location_level nível 2.';

-- Índices parciais (apenas linhas preenchidas)
CREATE INDEX IF NOT EXISTS idx_users_home_bairro
  ON public.users (LOWER(TRIM(home_bairro)))
  WHERE home_bairro IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_home_cidade
  ON public.users (LOWER(TRIM(home_cidade)))
  WHERE home_cidade IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_home_estado
  ON public.users (LOWER(TRIM(home_estado)))
  WHERE home_estado IS NOT NULL;


-- =====================================================
-- 2. seller_profiles — estado (address_state)
-- =====================================================

ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS address_state VARCHAR(60);

COMMENT ON COLUMN public.seller_profiles.address_state IS
  '[HYPER-LOC-001] Estado do vendedor (ex: "RJ", "SP"). '
  'Complementa address_neighborhood e address_city para o algoritmo hierárquico. '
  'Público quando status = active.';

CREATE INDEX IF NOT EXISTS idx_seller_address_state
  ON public.seller_profiles (LOWER(TRIM(address_state)))
  WHERE address_state IS NOT NULL;


-- =====================================================
-- 3. posts — snapshot de localização ao publicar
-- =====================================================

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS post_bairro VARCHAR(120),
  ADD COLUMN IF NOT EXISTS post_cidade VARCHAR(120),
  ADD COLUMN IF NOT EXISTS post_estado VARCHAR(60);

COMMENT ON COLUMN public.posts.post_bairro IS
  '[HYPER-LOC-001] Bairro do autor no momento da publicação (snapshot). '
  'Copiado de users.home_bairro pelo backend ao criar o post. '
  'Visível ao mesmo nível que o post (se post público, bairro é público).';

COMMENT ON COLUMN public.posts.post_cidade IS
  '[HYPER-LOC-001] Cidade do autor no momento da publicação.';

COMMENT ON COLUMN public.posts.post_estado IS
  '[HYPER-LOC-001] Estado do autor no momento da publicação.';

CREATE INDEX IF NOT EXISTS idx_posts_post_bairro
  ON public.posts (LOWER(TRIM(post_bairro)))
  WHERE post_bairro IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_post_cidade
  ON public.posts (LOWER(TRIM(post_cidade)))
  WHERE post_cidade IS NOT NULL;


-- =====================================================
-- 4. RPC get_location_level — nível de proximidade textual
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_location_level(
  u_bairro TEXT,
  u_cidade  TEXT,
  u_estado  TEXT,
  t_bairro  TEXT,
  t_cidade  TEXT,
  t_estado  TEXT
)
RETURNS INT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN u_bairro IS NOT NULL
      AND t_bairro IS NOT NULL
      AND LOWER(TRIM(u_bairro)) = LOWER(TRIM(t_bairro))
      AND LOWER(TRIM(u_cidade)) = LOWER(TRIM(t_cidade))
      THEN 0
    WHEN u_cidade IS NOT NULL
      AND t_cidade IS NOT NULL
      AND LOWER(TRIM(u_cidade)) = LOWER(TRIM(t_cidade))
      AND LOWER(TRIM(u_estado)) = LOWER(TRIM(t_estado))
      THEN 1
    WHEN u_estado IS NOT NULL
      AND t_estado IS NOT NULL
      AND LOWER(TRIM(u_estado)) = LOWER(TRIM(t_estado))
      THEN 2
    ELSE 3
  END
$$;

COMMENT ON FUNCTION public.get_location_level(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  '[HYPER-LOC-001] Calcula nível de proximidade hierárquica entre dois conjuntos de localização textual. '
  'Retorna: 0 = mesmo bairro+cidade | 1 = mesma cidade+estado | 2 = mesmo estado | 3 = fora. '
  'IMMUTABLE + PARALLEL SAFE: segura para uso em ORDER BY e colunas computadas. '
  'Multiplicadores de relevância: 0→×3.0 | 1→×1.8 | 2→×1.2 | 3→×0.6.';

-- Grant: authenticated users podem chamar via RPC
GRANT EXECUTE ON FUNCTION public.get_location_level(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;


-- =====================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar.
-- =====================================================

-- V1. Colunas em users:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'users'
--   AND column_name IN ('home_bairro','home_cidade','home_estado');
-- Esperado: 3 linhas.

-- V2. Colunas em posts:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'posts'
--   AND column_name IN ('post_bairro','post_cidade','post_estado');
-- Esperado: 3 linhas.

-- V3. RPC funcional (nível 0 = mesmo bairro):
-- SELECT public.get_location_level('Rocinha','Rio de Janeiro','RJ','rocinha','Rio de Janeiro','RJ');
-- Esperado: 0

-- V4. RPC funcional (nível 1 = mesma cidade):
-- SELECT public.get_location_level('Copacabana','Rio de Janeiro','RJ','Ipanema','Rio de Janeiro','RJ');
-- Esperado: 1

-- V5. RPC funcional (nível 3 = fora):
-- SELECT public.get_location_level('Copacabana','Rio de Janeiro','RJ','Moema','São Paulo','SP');
-- Esperado: 3
