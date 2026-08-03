-- =====================================================
-- MIGRAÇÃO: Restaura FKs de user_id → users(id) nas tabelas de gamificação
-- Motivo: FKs foram removidas em 20260515000003 enquanto usuários ainda não
--         estavam sincronizados no Supabase. Agora que a migração de identidade
--         está completa, as constraints são restauradas para que o PostgREST
--         possa descobrir os relacionamentos e permitir joins aninhados
--         (ex: posts → users → user_gamification).
-- Nota: Linha órfã 'test_user_check_123' removida antes desta migration.
-- =====================================================

-- Limpar eventuais órfãos antes de criar a FK
DELETE FROM user_gamification WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM user_tasks         WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM user_selos         WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM xp_events          WHERE user_id NOT IN (SELECT id FROM users);
-- daily_challenges não tem user_id (é por data/tarefa, não por usuário)
DELETE FROM content_boosts     WHERE user_id NOT IN (SELECT id FROM users);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_gamification_user_id_fkey') THEN
        ALTER TABLE user_gamification
            ADD CONSTRAINT user_gamification_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_tasks_user_id_fkey') THEN
        ALTER TABLE user_tasks
            ADD CONSTRAINT user_tasks_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_selos_user_id_fkey') THEN
        ALTER TABLE user_selos
            ADD CONSTRAINT user_selos_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'xp_events_user_id_fkey') THEN
        ALTER TABLE xp_events
            ADD CONSTRAINT xp_events_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_boosts_user_id_fkey') THEN
        ALTER TABLE content_boosts
            ADD CONSTRAINT content_boosts_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
