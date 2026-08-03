-- migration: 20260528000003_knowledge_articles
-- épico: SUPP-ARTICLE-001 — Base de Conhecimento

CREATE TABLE IF NOT EXISTS public.knowledge_articles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  category    TEXT        NOT NULL DEFAULT 'general'
                          CHECK (category IN ('financial','caixinha','loan','account','technical','security','general')),
  tags        TEXT[]      NOT NULL DEFAULT '{}',
  author_id   TEXT        NOT NULL,
  published   BOOLEAN     NOT NULL DEFAULT false,
  view_count  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ka_category  ON public.knowledge_articles(category) WHERE published = true;
CREATE INDEX IF NOT EXISTS idx_ka_published ON public.knowledge_articles(published);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.ka_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER ka_updated_at
  BEFORE UPDATE ON public.knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION public.ka_set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.knowledge_articles ENABLE ROW LEVEL SECURITY;

-- Leitura pública: apenas artigos publicados
CREATE POLICY ka_select_public ON public.knowledge_articles
  FOR SELECT USING (
    published = true
    OR check_global_role(auth.uid()::TEXT, 'admin')
    OR check_global_role(auth.uid()::TEXT, 'support')
  );

-- Insert/Update/Delete: apenas admins e agentes de suporte
CREATE POLICY ka_insert ON public.knowledge_articles
  FOR INSERT WITH CHECK (
    check_global_role(auth.uid()::TEXT, 'admin')
    OR check_global_role(auth.uid()::TEXT, 'support')
  );

CREATE POLICY ka_update ON public.knowledge_articles
  FOR UPDATE USING (
    check_global_role(auth.uid()::TEXT, 'admin')
    OR check_global_role(auth.uid()::TEXT, 'support')
  );

CREATE POLICY ka_delete ON public.knowledge_articles
  FOR DELETE USING (
    check_global_role(auth.uid()::TEXT, 'admin')
  );
