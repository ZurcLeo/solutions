-- =====================================================
-- MIGRAÇÃO: Gamificação — Tasks do Sistema de Avaliação Tripartite
-- [DELIVERY-RATING-GAME] 4 tasks no catálogo de gamificação
--
-- Eventos mapeados em gamificationService.triggerEvent:
--   delivery_rating_submitted        → +30 XP (cap 5/dia) + tasks onboarding
--   delivery_received_5star_rating   → +75 XP + task entregador nota 10
--   delivery_rating_cycle_completed  → +100 XP + task ciclo completo
--
-- Depende de:
--   20260514000002_gamification_schema.sql  (gamification_tasks, categoria CHECK)
--   20260610000019_delivery_ratings.sql     (tabela delivery_ratings)
--
-- Agente: game-agent | Revisado por: ClaudIA
-- Data: 2026-06-10
-- =====================================================


-- =====================================================
-- 1. Extende CHECK constraint de category para 'delivery'
-- =====================================================

ALTER TABLE public.gamification_tasks
    DROP CONSTRAINT IF EXISTS gamification_tasks_category_check;

ALTER TABLE public.gamification_tasks
    ADD CONSTRAINT gamification_tasks_category_check
    CHECK (category IN (
        'identidade', 'social', 'financeiro',
        'consistencia', 'comunidade', 'caixinha', 'mercado', 'delivery'
    ));


-- =====================================================
-- 2. Tasks de gamificação — delivery ratings
-- =====================================================

-- Task 1: Primeira avaliação enviada (onboarding — 1x)
INSERT INTO public.gamification_tasks (
    slug, name, description,
    category, xp_reward, coin_reward,
    is_repeatable, max_completions, target_count,
    sort_order
) VALUES (
    'delivery_rating_first',
    'Primeira Opinião',
    'Avalie pela primeira vez após uma entrega.',
    'delivery', 50, 10,
    FALSE, 1, 1,
    2010
) ON CONFLICT (slug) DO NOTHING;

-- Task 2: 10 avaliações enviadas (progressiva — 1x)
INSERT INTO public.gamification_tasks (
    slug, name, description,
    category, xp_reward, coin_reward,
    is_repeatable, max_completions, target_count,
    sort_order
) VALUES (
    'delivery_rating_10',
    'Voz da Comunidade',
    'Envie 10 avaliações de entrega.',
    'delivery', 200, 40,
    FALSE, 1, 10,
    2020
) ON CONFLICT (slug) DO NOTHING;

-- Task 3: Receber nota 5 estrelas como entregador (repetível ilimitado)
INSERT INTO public.gamification_tasks (
    slug, name, description,
    category, xp_reward, coin_reward,
    is_repeatable, max_completions, target_count,
    sort_order
) VALUES (
    'delivery_rated_5stars',
    'Entregador Nota 10',
    'Receba uma avaliação 5 estrelas como entregador.',
    'delivery', 150, 30,
    TRUE, NULL, 1,
    2030
) ON CONFLICT (slug) DO NOTHING;

-- Task 4: Ciclo completo — avaliar TODOS os outros de uma entrega (repetível ilimitado)
INSERT INTO public.gamification_tasks (
    slug, name, description,
    category, xp_reward, coin_reward,
    is_repeatable, max_completions, target_count,
    sort_order
) VALUES (
    'delivery_rating_cycle_completed',
    'Ciclo Completo',
    'Avalie todos os outros participantes de uma entrega.',
    'delivery', 100, 20,
    TRUE, NULL, 1,
    2040
) ON CONFLICT (slug) DO NOTHING;


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- =====================================================

-- V1. Tasks inseridas:
-- SELECT slug, name, xp_reward, is_repeatable
-- FROM public.gamification_tasks
-- WHERE category = 'delivery'
-- ORDER BY sort_order;
-- Esperado: 4 linhas.

-- V2. CHECK constraint atualizado:
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conname = 'gamification_tasks_category_check';
-- Esperado: incluir 'delivery'.
