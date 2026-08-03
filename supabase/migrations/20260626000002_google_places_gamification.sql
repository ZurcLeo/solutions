-- =====================================================
-- MIGRAÇÃO: Tasks + Selo — Google Places × Mercado Local
-- Descrição: Insere task e selo para verificação de
--            estabelecimento via Google Places (GP-3).
--
-- Épico: GP-3 | Google Places × Mercado Local
-- Autor: ClaudIA (game-agent)
-- Data: 2026-06-26
-- =====================================================

-- Task: verificar negócio no Google Places (single completion)
INSERT INTO gamification_tasks (slug, name, description, category, xp_reward, coin_reward, is_repeatable, max_completions, target_count, sort_order)
VALUES
  ('verify_google_business',
   'Negócio Verificado no Google',
   'Vincule seu estabelecimento ao Google Places para comprovar reputação externa',
   'mercado', 100, 20, FALSE, 1, 1, 1100)
ON CONFLICT (slug) DO NOTHING;

-- Selo: Negócio Verificado (plataforma, concedido algoritmicamente)
INSERT INTO selos (slug, name, description, category, tier, icon_url, is_platform_grant, grant_criteria)
VALUES
  ('negocio_verificado_google',
   'Negócio Verificado',
   'Estabelecimento vinculado e verificado via Google Places',
   'plataforma', 'ouro', 'verified_business',
   TRUE,
   '{"event": "google_place_verified", "min_rating": 3.5, "min_reviews": 10}'::jsonb)
ON CONFLICT (slug) DO NOTHING;
