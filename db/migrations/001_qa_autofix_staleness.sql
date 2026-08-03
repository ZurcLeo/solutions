-- =============================================================================
-- Migração 001: Sistema de Staleness para qa_autofix_pending
-- =============================================================================
-- Adiciona colunas de rastreamento de staleness, scoring e auditoria.
-- Cria tabela auto_resolution_audit para log imutável de decisões automáticas.
-- Idempotente: usa IF NOT EXISTS / IF EXISTS em todos os statements.
-- =============================================================================
-- Como rodar: Cole no SQL Editor do Supabase ou via psql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PARTE 1: Novos campos em qa_autofix_pending
-- ---------------------------------------------------------------------------

ALTER TABLE qa_autofix_pending
  -- Campos de classificação (extraídos do JSONB bug para facilitar queries)
  ADD COLUMN IF NOT EXISTS flow_id                 TEXT,
  ADD COLUMN IF NOT EXISTS step_id                 TEXT,
  ADD COLUMN IF NOT EXISTS file_path               TEXT,
  ADD COLUMN IF NOT EXISTS financial_impact        TEXT    DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS severity                TEXT    DEFAULT 'P2',
  ADD COLUMN IF NOT EXISTS dormancy_threshold_days INTEGER DEFAULT 21,

  -- Contadores de execução QA
  ADD COLUMN IF NOT EXISTS consecutive_pass_count  INTEGER DEFAULT 0  NOT NULL,
  ADD COLUMN IF NOT EXISTS total_pass_count        INTEGER DEFAULT 0  NOT NULL,
  ADD COLUMN IF NOT EXISTS total_execution_count   INTEGER DEFAULT 0  NOT NULL,

  -- Timestamps de atividade
  ADD COLUMN IF NOT EXISTS last_seen_active_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_actual_execution_at  TIMESTAMPTZ,

  -- Campos de code drift (usados a partir do P2)
  ADD COLUMN IF NOT EXISTS file_hash_at_creation   TEXT,
  ADD COLUMN IF NOT EXISTS file_hash_current       TEXT,
  ADD COLUMN IF NOT EXISTS code_drift_detected     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS drift_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS drift_commit_sha        TEXT,
  ADD COLUMN IF NOT EXISTS drift_pr_url            TEXT,
  ADD COLUMN IF NOT EXISTS oldcode_present         BOOLEAN,

  -- Scoring de staleness
  ADD COLUMN IF NOT EXISTS staleness_score         INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS staleness_status        TEXT    DEFAULT 'awaiting_review',
  ADD COLUMN IF NOT EXISTS staleness_reason        TEXT,
  ADD COLUMN IF NOT EXISTS staleness_updated_at    TIMESTAMPTZ,

  -- Auditoria de resolução
  ADD COLUMN IF NOT EXISTS state_history           JSONB   DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS resolved_by             TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_evidence     JSONB;

-- ---------------------------------------------------------------------------
-- PARTE 2: Índices para performance
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_qa_autofix_pending_flow_step
  ON qa_autofix_pending (flow_id, step_id);

CREATE INDEX IF NOT EXISTS idx_qa_autofix_pending_staleness_status
  ON qa_autofix_pending (staleness_status);

CREATE INDEX IF NOT EXISTS idx_qa_autofix_pending_staleness_score
  ON qa_autofix_pending (staleness_score DESC);

CREATE INDEX IF NOT EXISTS idx_qa_autofix_pending_last_seen_active
  ON qa_autofix_pending (last_seen_active_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- PARTE 3: Backfill de itens existentes
-- ---------------------------------------------------------------------------
-- Extrai flow_id, step_id e file_path do JSONB `bug` para os campos indexáveis.
-- Inicializa state_history com uma entrada de "legacy item".

UPDATE qa_autofix_pending
SET
  flow_id   = bug->>'flow',
  step_id   = bug->>'step',
  file_path = bug->'proposedFix'->>'filePath',

  staleness_status = 'awaiting_review',
  staleness_score  = 0,

  state_history = jsonb_build_array(
    jsonb_build_object(
      'action',     'registered',
      'changed_at', COALESCE(created_at, NOW())::TEXT,
      'note',       'Item legado — migrado para sistema de staleness (P0)'
    )
  )

WHERE flow_id IS NULL;

-- ---------------------------------------------------------------------------
-- PARTE 4: Tabela auto_resolution_audit (log imutável de decisões automáticas)
-- ---------------------------------------------------------------------------
-- Não confundir com state_history (que fica no item principal e é para UI).
-- Esta tabela é para compliance e exportação de auditoria. Nunca tem UPDATE.

CREATE TABLE IF NOT EXISTS auto_resolution_audit (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_fix_id    UUID        NOT NULL,  -- FK para qa_autofix_pending.id
  action            TEXT        NOT NULL,  -- 'auto_archived' | 'score_updated' | 'reopened' | 'staleness_flagged'
  score_at_action   INTEGER,
  evidence          JSONB       DEFAULT '{}'::JSONB,
  qa_run_ids        TEXT[]      DEFAULT '{}',
  commit_sha        TEXT,
  system_version    TEXT        NOT NULL DEFAULT 'P1.0',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para busca por pending fix
CREATE INDEX IF NOT EXISTS idx_auto_resolution_audit_pending_fix
  ON auto_resolution_audit (pending_fix_id, created_at DESC);

-- Comentário para clareza
COMMENT ON TABLE auto_resolution_audit IS
  'Log imutável de todas as decisões automáticas do sistema de staleness. '
  'Nunca recebe UPDATE — apenas INSERT. Retenção mínima: 90 dias.';

COMMENT ON COLUMN auto_resolution_audit.system_version IS
  'Versão do algoritmo de scoring que tomou a decisão. '
  'P1.0 = somente Sinal 1 (QA run cross-reference). '
  'P2.0 adicionará Sinal 2 (code drift).';

-- RLS: service_role bypassa automaticamente; anon bloqueado por padrão
ALTER TABLE auto_resolution_audit ENABLE ROW LEVEL SECURITY;
