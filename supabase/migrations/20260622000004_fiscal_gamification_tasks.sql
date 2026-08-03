-- =====================================================
-- MIGRAÇÃO: Fiscal — Gamification Tasks
-- [FISCAL-003] Tasks de XP para o módulo fiscal
--
-- Sem XP para criação de pendência (incentivo perverso).
-- XP de resolução só se concluída DENTRO do prazo.
--
-- Autor: game-agent (ElosCloud)
-- Data: 2026-06-22
-- =====================================================

-- Expandir CHECK constraint de category para incluir 'fiscal'
ALTER TABLE public.gamification_tasks
    DROP CONSTRAINT IF EXISTS gamification_tasks_category_check;
ALTER TABLE public.gamification_tasks
    ADD CONSTRAINT gamification_tasks_category_check
    CHECK (category IN (
        'identidade', 'social', 'financeiro',
        'consistencia', 'comunidade', 'caixinha',
        'delivery', 'mobilidade', 'civic', 'fiscal',
        'jogos', 'mercado'
    ));

INSERT INTO public.gamification_tasks (slug, name, description, category, xp_reward, coin_reward, is_repeatable, max_completions)
VALUES
    ('client_added',                'Adicionar cliente',              'Adicionar um cliente à carteira',          'fiscal', 50,  0, true,  NULL),
    ('clients_10',                  'Carteira com 10 clientes',       'Alcançar 10 clientes na carteira',         'fiscal', 200, 0, false, 1),
    ('pendencia_resolved_no_prazo', 'Pendência resolvida no prazo',   'Concluir pendência dentro do prazo legal', 'fiscal', 80,  0, true,  NULL),
    ('attachment_uploaded',          'Documento enviado',              'Enviar documento para um booking',         'fiscal', 20,  0, true,  NULL)
ON CONFLICT (slug) DO NOTHING;
