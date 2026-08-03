-- =====================================================
-- MIGRAÇÃO: Dedup de progresso em user_tasks
-- Adiciona credited_ids para evitar dupla contagem
-- em tarefas multi-etapa (comment_10_posts, receive_10_reactions).
-- Data: 2026-05-25
-- =====================================================

ALTER TABLE user_tasks
  ADD COLUMN IF NOT EXISTS credited_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN user_tasks.credited_ids IS
  'Array de dedup keys já creditadas nesta tarefa (ex: "post:uuid", "senderId:postId"). '
  'Impede dupla contagem para tarefas multi-etapa como comment_10_posts e receive_10_reactions.';
