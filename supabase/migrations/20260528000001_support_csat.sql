-- supabase/migrations/20260528000001_support_csat.sql
-- SUPP-CSAT-001: Campos de pesquisa de satisfação pós-resolução

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS csat_score          INT          CHECK (csat_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS csat_comment        TEXT,
  ADD COLUMN IF NOT EXISTS csat_responded_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS csat_survey_token   TEXT         UNIQUE,
  ADD COLUMN IF NOT EXISTS csat_survey_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN support_tickets.csat_score           IS 'Nota de satisfação do usuário (1–5 estrelas)';
COMMENT ON COLUMN support_tickets.csat_comment         IS 'Comentário opcional do usuário na pesquisa CSAT';
COMMENT ON COLUMN support_tickets.csat_responded_at    IS 'Timestamp em que o usuário respondeu à pesquisa';
COMMENT ON COLUMN support_tickets.csat_survey_token    IS 'Token único para acesso público à pesquisa (sem login)';
COMMENT ON COLUMN support_tickets.csat_survey_sent_at  IS 'Timestamp em que o email de pesquisa CSAT foi enviado';

-- Índice parcial para lookup por token (apenas tickets que já possuem token gerado)
CREATE INDEX IF NOT EXISTS idx_support_tickets_csat_survey_token
  ON support_tickets (csat_survey_token)
  WHERE csat_survey_token IS NOT NULL;
