-- =====================================================
-- MIGRAÇÃO: Gamificação - Pacote Starter Seed (Semente)
-- Descrição: Insere novas tarefas e ajusta o onboarding 
--            para o nível inicial.
-- Data: 2026-05-15
-- =====================================================

-- 1. Inserir a nova tarefa de Primeira Conexão (Onboarding Social)
INSERT INTO gamification_tasks (slug, name, description, category, xp_reward, coin_reward, sort_order) 
VALUES (
    'first_connection', 
    'Primeiro Elo', 
    'Faça sua primeira conexão com outro membro da comunidade', 
    'social', 
    40, 
    5, 
    15
) ON CONFLICT (slug) DO NOTHING;

-- 2. Refinar a ordem e os nomes das tarefas de Identidade para o pacote Semente
-- Ajustamos os nomes para algo mais lúdico e definimos a ordem de onboarding (sort_order)
UPDATE gamification_tasks SET sort_order = 1,  name = 'O Despertar'     WHERE slug = 'first_login';
UPDATE gamification_tasks SET sort_order = 5,  name = 'Voz da Verdade'  WHERE slug = 'verify_email';
UPDATE gamification_tasks SET sort_order = 10, name = 'Sem Anonimato'   WHERE slug = 'upload_avatar';
UPDATE gamification_tasks SET sort_order = 12, name = 'Identidade Digital' WHERE slug = 'complete_profile';
UPDATE gamification_tasks SET sort_order = 20, name = 'Alô Mundo!'      WHERE slug = 'first_post';

COMMENT ON TABLE gamification_tasks IS 'Catálogo de tarefas atualizado com o pacote Starter Seed (Semente)';
