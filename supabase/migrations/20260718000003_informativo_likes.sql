-- ============================================================================
-- Migration: Informativo Likes (public, identified engagement)
-- Unlike HMAC-based anonymous voting, likes are public/identified interactions.
-- ============================================================================

CREATE TABLE agora_informativo_likes (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  informativo_id TEXT NOT NULL REFERENCES agora_informativos(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, informativo_id)
);

ALTER TABLE agora_informativo_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "likes_select" ON agora_informativo_likes
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "likes_insert" ON agora_informativo_likes
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "likes_delete" ON agora_informativo_likes
  FOR DELETE USING (auth.uid()::text = user_id);

-- Denormalized counter on informativos
ALTER TABLE agora_informativos ADD COLUMN IF NOT EXISTS likes_count INTEGER NOT NULL DEFAULT 0;

-- Trigger to sync counter
CREATE OR REPLACE FUNCTION sync_informativo_likes_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE agora_informativos SET likes_count = likes_count + 1 WHERE id = NEW.informativo_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE agora_informativos SET likes_count = likes_count - 1 WHERE id = OLD.informativo_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_informativo_likes
  AFTER INSERT OR DELETE ON agora_informativo_likes
  FOR EACH ROW EXECUTE FUNCTION sync_informativo_likes_count();

-- Gamification task for liking informativos
INSERT INTO gamification_tasks (slug, name, description, category, xp_reward, coin_reward, is_repeatable, max_completions)
VALUES ('like_informativo', 'Leitor Engajado', 'Curta um informativo legislativo na Ágora', 'civic', 10, 2, false, 1)
ON CONFLICT (slug) DO NOTHING;
