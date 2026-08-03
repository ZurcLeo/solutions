-- =====================================================
-- MIGRAÇÃO: Remove FK de user_id → users(id) nas tabelas de gamificação
-- Motivo: usuários ainda não foram sincronizados do Firestore para o
--         Supabase, portanto a FK viola na primeira interação de gamificação.
--         A referência lógica ao Firebase UID é mantida; a constraint
--         formal será restaurada após a migração completa de identidade.
-- Data: 2026-05-15
-- =====================================================

ALTER TABLE user_gamification
    DROP CONSTRAINT IF EXISTS user_gamification_user_id_fkey;

ALTER TABLE user_tasks
    DROP CONSTRAINT IF EXISTS user_tasks_user_id_fkey;

ALTER TABLE user_selos
    DROP CONSTRAINT IF EXISTS user_selos_user_id_fkey;

ALTER TABLE xp_events
    DROP CONSTRAINT IF EXISTS xp_events_user_id_fkey;

ALTER TABLE daily_challenges
    DROP CONSTRAINT IF EXISTS daily_challenges_user_id_fkey;

ALTER TABLE content_boosts
    DROP CONSTRAINT IF EXISTS content_boosts_user_id_fkey;
