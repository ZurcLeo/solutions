-- =====================================================
-- MIGRAÇÃO: Gamificação — Tasks do Módulo de Jogos
-- [JOGOS-DB-003] 6 tasks no catálogo de gamificação
--
-- Eventos mapeados em gamificationService.triggerEvent:
--   game_created            → +100 XP (1x) · criou um jogo ou concurso
--   game_joined             → +30 XP (repetível) · aceitou participar de um jogo
--   raffle_ticket_bought    → +20 XP (repetível) · comprou bilhete de rifa
--   selection_item_claimed  → +10 XP (repetível) · marcou item em lista de seleção
--   secret_friend_draw      → +50 XP (repetível) · participou de amigo oculto
--   game_host_completed     → +200 XP (repetível) · jogo concluído como anfitrião
--
-- Depende de:
--   20260514000002_gamification_schema.sql    (gamification_tasks)
--   20260610000020_gamification_delivery_ratings.sql  (constraint com 'mercado','delivery')
--
-- Agente: game-agent | Revisado por: ClaudIA
-- Data: 2026-06-15
-- =====================================================


-- =====================================================
-- 1. Extende CHECK constraint de category para 'jogos'
-- =====================================================

ALTER TABLE public.gamification_tasks
    DROP CONSTRAINT IF EXISTS gamification_tasks_category_check;

ALTER TABLE public.gamification_tasks
    ADD CONSTRAINT gamification_tasks_category_check
    CHECK (category IN (
        'identidade', 'social', 'financeiro',
        'consistencia', 'comunidade', 'caixinha', 'mercado', 'delivery', 'jogos'
    ));


-- =====================================================
-- 2. Tasks de gamificação — módulo de jogos
-- =====================================================

-- Task 1: Criou um jogo (onboarding — 1x)
INSERT INTO public.gamification_tasks (
    slug, name, description,
    category, xp_reward, coin_reward,
    is_repeatable, max_completions, target_count,
    sort_order
) VALUES (
    'game_created',
    'Criou um Jogo',
    'Você criou seu primeiro jogo ou concurso',
    'jogos', 100, 20,
    FALSE, 1, 1,
    3010
) ON CONFLICT (slug) DO NOTHING;

-- Task 2: Participou de um jogo (repetível ilimitado)
INSERT INTO public.gamification_tasks (
    slug, name, description,
    category, xp_reward, coin_reward,
    is_repeatable, max_completions, target_count,
    sort_order
) VALUES (
    'game_joined',
    'Participou de um Jogo',
    'Você aceitou participar de um jogo ou concurso',
    'jogos', 30, 5,
    TRUE, NULL, 1,
    3020
) ON CONFLICT (slug) DO NOTHING;

-- Task 3: Comprou bilhete de rifa (repetível ilimitado)
INSERT INTO public.gamification_tasks (
    slug, name, description,
    category, xp_reward, coin_reward,
    is_repeatable, max_completions, target_count,
    sort_order
) VALUES (
    'raffle_ticket_bought',
    'Comprou um Bilhete',
    'Você comprou um bilhete de rifa',
    'jogos', 20, 5,
    TRUE, NULL, 1,
    3030
) ON CONFLICT (slug) DO NOTHING;

-- Task 4: Escolheu item em lista de seleção (repetível ilimitado)
INSERT INTO public.gamification_tasks (
    slug, name, description,
    category, xp_reward, coin_reward,
    is_repeatable, max_completions, target_count,
    sort_order
) VALUES (
    'selection_item_claimed',
    'Escolheu um Item',
    'Você marcou um item em uma lista de seleção',
    'jogos', 10, 2,
    TRUE, NULL, 1,
    3040
) ON CONFLICT (slug) DO NOTHING;

-- Task 5: Participou de amigo oculto (repetível ilimitado)
INSERT INTO public.gamification_tasks (
    slug, name, description,
    category, xp_reward, coin_reward,
    is_repeatable, max_completions, target_count,
    sort_order
) VALUES (
    'secret_friend_draw',
    'Amigo Oculto Sorteado',
    'Participou de um sorteio de amigo oculto',
    'jogos', 50, 10,
    TRUE, NULL, 1,
    3050
) ON CONFLICT (slug) DO NOTHING;

-- Task 6: Jogo concluído como anfitrião (repetível ilimitado)
INSERT INTO public.gamification_tasks (
    slug, name, description,
    category, xp_reward, coin_reward,
    is_repeatable, max_completions, target_count,
    sort_order
) VALUES (
    'game_host_completed',
    'Jogo Concluído como Anfitrião',
    'Seu jogo chegou ao fim com sucesso',
    'jogos', 200, 40,
    TRUE, NULL, 1,
    3060
) ON CONFLICT (slug) DO NOTHING;


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- =====================================================

-- V1. Tasks inseridas:
-- SELECT slug, name, xp_reward, is_repeatable, category
-- FROM public.gamification_tasks
-- WHERE category = 'jogos'
-- ORDER BY sort_order;
-- Esperado: 6 linhas.

-- V2. CHECK constraint atualizado:
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conname = 'gamification_tasks_category_check';
-- Esperado: incluir 'jogos'.
