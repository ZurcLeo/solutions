-- =====================================================
-- Migration: Tabelas de Observabilidade SRE
-- Cria deposit_context_logs e health_history
-- Referências:
--   - SreRepository.js (saveContextLog, getPendingDiagnostics)
--   - healthHistoryService.js (saveSnapshot, getRecentHistory)
--   - sreWorker.js (cron 2x/dia)
-- =====================================================

-- 1. Tabela de logs de contexto SRE
CREATE TABLE IF NOT EXISTS public.deposit_context_logs (
    correlation_id    UUID PRIMARY KEY,
    user_hash         VARCHAR(64),
    severity          VARCHAR(10) NOT NULL,
    severity_reason   TEXT,
    duration_ms       NUMERIC(10, 2),
    status_code       INT,
    method            VARCHAR(10),
    path              TEXT,
    metadata_snapshot JSONB,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sre_severity
    ON public.deposit_context_logs(severity);

CREATE INDEX IF NOT EXISTS idx_sre_created_at
    ON public.deposit_context_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sre_user_hash
    ON public.deposit_context_logs(user_hash);

ALTER TABLE public.deposit_context_logs ENABLE ROW LEVEL SECURITY;

-- Backend usa service_role key (bypassa RLS)
-- Nenhuma policy necessaria para acesso via frontend

-- 2. Tabela de historico de health checks
CREATE TABLE IF NOT EXISTS public.health_history (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    health_score      NUMERIC(5, 2),
    overall_status    TEXT,
    confidence_level  NUMERIC(3, 2),
    checks_summary    JSONB,
    penalties         JSONB,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_history_created_at
    ON public.health_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_history_confidence
    ON public.health_history(confidence_level)
    WHERE confidence_level >= 0.7;

ALTER TABLE public.health_history ENABLE ROW LEVEL SECURITY;
