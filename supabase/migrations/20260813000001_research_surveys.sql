-- ============================================================
-- SURVEY-001 — Pesquisas de mercado (research surveys)
-- ============================================================
-- Tabelas para form builder generico: definicao JSONB + respostas normalizadas.
-- Zero auth para respondentes; admin cria/gere via /api/research.

-- ── Surveys (definicao) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS research_surveys (
  id              TEXT PRIMARY KEY DEFAULT ('rsv_' || replace(gen_random_uuid()::TEXT, '-', '')),
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  description     TEXT,
  eyebrow         TEXT DEFAULT 'ElosCloud',
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','closed')),
  form_definition JSONB NOT NULL DEFAULT '{"steps":[],"finish_screen":{}}',
  target_audience TEXT,
  response_count  INT NOT NULL DEFAULT 0,
  created_by      TEXT NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ
);

-- ── Responses (respostas) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS research_responses (
  id          TEXT PRIMARY KEY DEFAULT ('rsr_' || replace(gen_random_uuid()::TEXT, '-', '')),
  survey_id   TEXT NOT NULL REFERENCES research_surveys(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id),
  answers     JSONB NOT NULL DEFAULT '{}',
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ─────────────────────────────────────────────────

CREATE INDEX idx_research_surveys_slug ON research_surveys(slug) WHERE status = 'active';
CREATE INDEX idx_research_surveys_status ON research_surveys(status);
CREATE INDEX idx_research_responses_survey ON research_responses(survey_id);
CREATE INDEX idx_research_responses_created ON research_responses(created_at);

-- ── RLS ─────────────────────────────────────────────────────

ALTER TABLE research_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY research_surveys_admin ON research_surveys FOR ALL
  USING (auth.jwt() ->> 'role' = 'authenticated');
CREATE POLICY research_responses_admin ON research_responses FOR ALL
  USING (auth.jwt() ->> 'role' = 'authenticated');

-- ── Trigger: auto-increment response_count ──────────────────

CREATE OR REPLACE FUNCTION update_survey_response_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE research_surveys SET response_count = (
    SELECT count(*) FROM research_responses WHERE survey_id = NEW.survey_id
  ), updated_at = now()
  WHERE id = NEW.survey_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_survey_response_count
  AFTER INSERT ON research_responses
  FOR EACH ROW EXECUTE FUNCTION update_survey_response_count();
