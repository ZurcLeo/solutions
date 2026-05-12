-- health_history_schema.sql
-- Histórico estruturado de snapshots do Health Score para análise de tendência.
-- Usado pelo SRE Agent para detectar degradação progressiva vs. quedas súbitas.
-- Tabela: health_history (Supabase/PostgreSQL)

CREATE TABLE IF NOT EXISTS health_history (
  id               BIGSERIAL PRIMARY KEY,
  health_score     INT NOT NULL,                          -- 0-100, score ponderado
  overall_status   VARCHAR(20) NOT NULL,                 -- operational | degraded | partial_outage | major_outage | critical_outage
  confidence_level NUMERIC(3,2) NOT NULL DEFAULT 1.0,   -- 0.0 | 0.5 | 1.0
  checks_summary   JSONB NOT NULL,                       -- { database: { status, latencyMs }, ... }
  penalties        JSONB,                                -- penalidades de latência aplicadas (nullable)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para queries de tendência e IA SRE
CREATE INDEX IF NOT EXISTS idx_health_history_created_at
  ON health_history (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_history_score_status
  ON health_history (health_score, overall_status);

-- Partial index para snapshots confiáveis (confidence >= 0.7)
-- Usado pelo SreAgentService para análise de tendência sem ruído
CREATE INDEX IF NOT EXISTS idx_health_history_trusted
  ON health_history (created_at DESC)
  WHERE confidence_level >= 0.7;

-- RLS desabilitado: dados internos de infraestrutura, sem PII
ALTER TABLE health_history DISABLE ROW LEVEL SECURITY;

-- Política de retenção recomendada (executar via pg_cron ou Supabase scheduled jobs):
-- DELETE FROM health_history WHERE created_at < NOW() - INTERVAL '30 days';
