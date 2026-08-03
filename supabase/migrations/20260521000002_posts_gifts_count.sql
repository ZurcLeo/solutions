-- Migration: add gifts_count to posts + trigger to auto-increment
-- This counter mirrors the pattern of reactions_count / comments_count,
-- so the feed can expose giftsCount without a separate JOIN.

-- 1. Add column
ALTER TABLE posts ADD COLUMN IF NOT EXISTS gifts_count INT NOT NULL DEFAULT 0;

-- 2. Backfill from existing gifts
UPDATE posts p
SET gifts_count = (
  SELECT COUNT(*) FROM gifts g WHERE g.post_id = p.id
);

-- 3. Trigger function
CREATE OR REPLACE FUNCTION increment_post_gifts_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE posts
  SET gifts_count = GREATEST(gifts_count + 1, 0)
  WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$;

-- 4. Trigger on INSERT into gifts (only when post_id is set)
DROP TRIGGER IF EXISTS trg_increment_gifts_count ON gifts;
CREATE TRIGGER trg_increment_gifts_count
AFTER INSERT ON gifts
FOR EACH ROW
WHEN (NEW.post_id IS NOT NULL)
EXECUTE FUNCTION increment_post_gifts_count();
