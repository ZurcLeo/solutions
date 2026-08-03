-- migration: post_hashtags
-- Tabela para armazenar hashtags extraídas dos posts, permitindo trending e busca por tag.

CREATE TABLE IF NOT EXISTS post_hashtags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  hashtag     TEXT NOT NULL,  -- armazenada em minúsculas, sem o '#'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para busca por hashtag (trending)
CREATE INDEX IF NOT EXISTS idx_post_hashtags_hashtag    ON post_hashtags(hashtag);
-- Índice para deletar hashtags de um post rapidamente
CREATE INDEX IF NOT EXISTS idx_post_hashtags_post_id   ON post_hashtags(post_id);
-- Índice para trending com janela de tempo
CREATE INDEX IF NOT EXISTS idx_post_hashtags_created   ON post_hashtags(created_at DESC);
-- Evita duplicatas (mesmo post não pode ter a mesma hashtag duas vezes)
CREATE UNIQUE INDEX IF NOT EXISTS idx_post_hashtags_unique ON post_hashtags(post_id, hashtag);

-- RLS: leitura pública (hashtags são conteúdo público do feed)
ALTER TABLE post_hashtags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_hashtags_select_public"
  ON post_hashtags FOR SELECT
  USING (true);

CREATE POLICY "post_hashtags_insert_service"
  ON post_hashtags FOR INSERT
  WITH CHECK (true);

CREATE POLICY "post_hashtags_delete_service"
  ON post_hashtags FOR DELETE
  USING (true);
