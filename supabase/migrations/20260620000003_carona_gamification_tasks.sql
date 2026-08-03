-- =====================================================
-- MIGRAÇÃO: Carona Solidária — Tasks de Gamificação
-- [CARONA-003] 5 tasks no catálogo de gamificação
--
-- Eventos mapeados em gamificationService.triggerEvent:
--   carona_ride_offered           → first_carona_offered
--   carona_ride_completed_driver  → carona_10_rides_driver
--   carona_seat_booked            → carona_first_passenger
--   carona_received_5star         → carona_solidaria_5star
--   carona_recurring_active       → carona_recurring_week
--
-- Depende de:
--   20260514000002_gamification_schema.sql  (gamification_tasks, categoria CHECK)
--   20260619000002_agora_gamification_tasks.sql (último CHECK inclui 'civic')
--   20260620000001_carona_schema.sql
--
-- Agente: claudia-agent | Revisado por: Léo (PO)
-- Data: 2026-06-20
-- =====================================================


-- =====================================================
-- 1. Extende CHECK constraint de category para 'mobilidade'
-- =====================================================

ALTER TABLE public.gamification_tasks
    DROP CONSTRAINT IF EXISTS gamification_tasks_category_check;

ALTER TABLE public.gamification_tasks
    ADD CONSTRAINT gamification_tasks_category_check
    CHECK (category = ANY (ARRAY[
        'identidade', 'social', 'financeiro', 'consistencia',
        'comunidade', 'caixinha', 'mercado', 'delivery', 'jogos', 'civic',
        'mobilidade'
    ]));


-- =====================================================
-- 2. Tasks de gamificação — Carona Solidária
-- =====================================================

-- Task 1: Primeira carona oferecida (onboarding — 1x)
INSERT INTO public.gamification_tasks (
    slug, name, description,
    category, xp_reward, coin_reward,
    is_repeatable, max_completions, target_count,
    sort_order
) VALUES (
    'first_carona_offered',
    'Motorista Solidário',
    'Ofereça sua primeira carona solidária na plataforma.',
    'mobilidade', 50, 10,
    FALSE, 1, 1,
    3010
) ON CONFLICT (slug) DO NOTHING;

-- Task 2: 10 viagens como motorista (progressiva — 1x)
INSERT INTO public.gamification_tasks (
    slug, name, description,
    category, xp_reward, coin_reward,
    is_repeatable, max_completions, target_count,
    sort_order
) VALUES (
    'carona_10_rides_driver',
    'Estrada da Confiança',
    'Complete 10 viagens como motorista de carona solidária.',
    'mobilidade', 200, 40,
    FALSE, 1, 10,
    3020
) ON CONFLICT (slug) DO NOTHING;

-- Task 3: Primeira reserva como passageiro (onboarding — 1x)
INSERT INTO public.gamification_tasks (
    slug, name, description,
    category, xp_reward, coin_reward,
    is_repeatable, max_completions, target_count,
    sort_order
) VALUES (
    'carona_first_passenger',
    'Primeira Carona',
    'Reserve sua primeira vaga em uma carona solidária.',
    'mobilidade', 30, 5,
    FALSE, 1, 1,
    3030
) ON CONFLICT (slug) DO NOTHING;

-- Task 4: Receber 5 estrelas como motorista (repetível ilimitado)
INSERT INTO public.gamification_tasks (
    slug, name, description,
    category, xp_reward, coin_reward,
    is_repeatable, max_completions, target_count,
    sort_order
) VALUES (
    'carona_solidaria_5star',
    'Cinco Estrelas na Estrada',
    'Receba uma avaliação 5 estrelas como motorista.',
    'mobilidade', 150, 30,
    TRUE, NULL, 1,
    3040
) ON CONFLICT (slug) DO NOTHING;

-- Task 5: Carona recorrente por 4 semanas (progressiva — 1x)
INSERT INTO public.gamification_tasks (
    slug, name, description,
    category, xp_reward, coin_reward,
    is_repeatable, max_completions, target_count,
    sort_order
) VALUES (
    'carona_recurring_week',
    'Rota Solidária',
    'Mantenha uma carona recorrente ativa por 4 semanas consecutivas.',
    'mobilidade', 100, 20,
    FALSE, 1, 4,
    3050
) ON CONFLICT (slug) DO NOTHING;


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- =====================================================

-- V1. Tasks inseridas:
-- SELECT slug, name, xp_reward, is_repeatable
-- FROM public.gamification_tasks
-- WHERE category = 'mobilidade'
-- ORDER BY sort_order;
-- Esperado: 5 linhas.

-- V2. CHECK constraint atualizado:
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conname = 'gamification_tasks_category_check';
-- Esperado: incluir 'mobilidade'.
