-- =====================================================
-- Migration: Comment Reactions + Replies
-- Adds like/reaction support and nested replies to comments
-- =====================================================

-- 1. Add parent_comment_id for nested replies (1 nível)
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS parent_comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE;

-- 2. Add likes_count denormalizado para exibição eficiente
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS likes_count INTEGER NOT NULL DEFAULT 0;

-- 3. Tabela de reações em comentários (padrão message_reactions)
CREATE TABLE IF NOT EXISTS comment_reactions (
  comment_id   TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment
  ON comment_reactions(comment_id);

-- 4. Índice para buscar replies de um comentário
CREATE INDEX IF NOT EXISTS idx_comments_parent
  ON comments(parent_comment_id)
  WHERE parent_comment_id IS NOT NULL;

-- 5. RLS — comment_reactions
ALTER TABLE comment_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comment_reactions_select"
  ON comment_reactions FOR SELECT
  USING (true);

CREATE POLICY "comment_reactions_insert"
  ON comment_reactions FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "comment_reactions_delete"
  ON comment_reactions FOR DELETE
  USING (user_id = auth.uid()::text);

-- 6. Trigger para manter likes_count sincronizado
CREATE OR REPLACE FUNCTION update_comment_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE comments SET likes_count = likes_count + 1 WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE comments SET likes_count = GREATEST(0, likes_count - 1) WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_comment_likes_count
  AFTER INSERT OR DELETE ON comment_reactions
  FOR EACH ROW
  EXECUTE FUNCTION update_comment_likes_count();
