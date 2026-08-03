-- =====================================================
-- MIGRAÇÃO: Tasks de Gamificação — Mercado Local
-- Descrição: Insere no catálogo as tarefas de marketplace
--            referenciadas no eventMap do gamificationService
--            mas ausentes de gamification_tasks.
--            Também garante a existência de 'first_connection'
--            que o eventMap espera mas não havia migration explícita.
--
-- Épico: MKTPLACE-002 | Gaps detectados pelo game-agent / ClaudIA
-- Autor: ClaudIA (game-agent)
-- Data: 2026-06-09
-- =====================================================

-- Garante que a categoria 'mercado' existe (adicionada em 20260525000009)
-- Apenas insere as tasks ausentes — idempotente.

INSERT INTO gamification_tasks (slug, name, description, category, xp_reward, coin_reward, is_repeatable, max_completions, target_count, sort_order)
VALUES
  -- Mercado Local
  ('seller_profile_created',
   'Vendedor Ativo',
   'Crie seu perfil de vendedor no Mercado Local',
   'mercado', 60, 10, FALSE, 1, 1, 1050),

  ('first_sale',
   'Primeira Venda',
   'Realize sua primeira venda no Mercado Local',
   'mercado', 100, 20, FALSE, 1, 1, 1060),

  ('first_purchase',
   'Primeira Compra',
   'Realize sua primeira compra no Mercado Local',
   'mercado', 50, 10, FALSE, 1, 1, 1070),

  ('community_supporter',
   'Apoiador Comunitário',
   'Apoie uma meta comunitária no Mercado Local',
   'comunidade', 80, 15, FALSE, 1, 1, 1080),

  ('first_review',
   'Avaliador',
   'Deixe sua primeira avaliação após uma compra ou venda',
   'mercado', 40, 5, FALSE, 1, 1, 1090),

  -- Social (garante existência — base migration pode ter UUID diferente após recreação)
  ('first_connection',
   'Primeiro Elo',
   'Faça sua primeira conexão com outro membro da comunidade',
   'social', 40, 5, FALSE, 1, 1, 25)

ON CONFLICT (slug) DO NOTHING;
