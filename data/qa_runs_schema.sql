-- DDL para as tabelas de QA Orchestrator (Migração Firestore -> Supabase)
-- Para ser executado no SQL Editor do Supabase

-- 1. Tabela Principal de Runs
CREATE TABLE IF NOT EXISTS qa_runs (
  run_id TEXT PRIMARY KEY,
  triggered_by TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  health_score INTEGER,
  summary TEXT,
  total_flows INTEGER,
  passed_flows INTEGER,
  failed_flows INTEGER,
  from_cache BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabela de Bugs Detectados (Subcoleção 'bugs' no Firestore)
CREATE TABLE IF NOT EXISTS qa_run_bugs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT REFERENCES qa_runs(run_id) ON DELETE CASCADE,
  flow TEXT NOT NULL,
  step TEXT NOT NULL,
  severity TEXT NOT NULL, -- 'critical' | 'minor'
  error TEXT,
  affected_users TEXT,
  suggested_fix TEXT,
  reported_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabela de Steps de Execução (Subcoleção 'steps' no Firestore)
CREATE TABLE IF NOT EXISTS qa_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT REFERENCES qa_runs(run_id) ON DELETE CASCADE,
  flow_id TEXT NOT NULL,
  step_name TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  duration INTEGER, -- em ms
  correlation_id TEXT,
  artifacts JSONB,
  error TEXT,
  error_detail TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabela de Cache de Interpretação da IA (Claude)
CREATE TABLE IF NOT EXISTS qa_interpretation_cache (
  hash TEXT PRIMARY KEY,
  report JSONB NOT NULL,
  cached_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabela de Autofixes Realizados (Controle de Cota)
CREATE TABLE IF NOT EXISTS qa_autofixes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT NOT NULL,
  pr_url TEXT,
  flow_id TEXT,
  step_id TEXT,
  status TEXT DEFAULT 'opened', -- 'opened' | 'merged' | 'closed'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tabela de Autofixes Pendentes de Revisão Humana
CREATE TABLE IF NOT EXISTS qa_autofix_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bug JSONB NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'awaiting_review', -- 'awaiting_review' | 'approved' | 'rejected'
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para Performance no Dashboard
CREATE INDEX IF NOT EXISTS idx_qa_runs_completed_at ON qa_runs(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_run_bugs_run_id ON qa_run_bugs(run_id);
CREATE INDEX IF NOT EXISTS idx_qa_run_steps_run_id ON qa_run_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_qa_run_steps_correlation_id ON qa_run_steps(correlation_id);
CREATE INDEX IF NOT EXISTS idx_qa_autofixes_file_path ON qa_autofixes(file_path);
CREATE INDEX IF NOT EXISTS idx_qa_autofix_pending_status ON qa_autofix_pending(status);

-- Estas tabelas são dados internos de monitoramento (não contêm PII de usuários).
-- RLS desabilitado para permitir acesso via anon key do backend Express.
-- Se migrar para service_role key, reabilitar RLS com políticas adequadas.
ALTER TABLE qa_runs           DISABLE ROW LEVEL SECURITY;
ALTER TABLE qa_run_bugs       DISABLE ROW LEVEL SECURITY;
ALTER TABLE qa_run_steps      DISABLE ROW LEVEL SECURITY;
ALTER TABLE qa_interpretation_cache DISABLE ROW LEVEL SECURITY;
ALTER TABLE qa_autofixes      DISABLE ROW LEVEL SECURITY;
ALTER TABLE qa_autofix_pending DISABLE ROW LEVEL SECURITY;

-- Grant full access to anon role (dados internos de QA, sem exposição pública)
GRANT ALL ON qa_runs, qa_run_bugs, qa_run_steps, qa_interpretation_cache, qa_autofixes, qa_autofix_pending TO anon;
