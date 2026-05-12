-- DDL para a tabela de logs de contexto SRE
-- Para ser executado no SQL Editor do Supabase

CREATE TABLE IF NOT EXISTS deposit_context_logs (
  correlation_id UUID PRIMARY KEY,
  user_hash VARCHAR(64),
  severity VARCHAR(10) NOT NULL,
  severity_reason TEXT,
  duration_ms NUMERIC(10, 2),
  status_code INT,
  method VARCHAR(10),
  path TEXT,
  -- Snapshot completo do contexto sanitizado para análise de IA (Tier 1/2)
  metadata_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance no Dashboard QA Control Center
CREATE INDEX IF NOT EXISTS idx_sre_severity ON deposit_context_logs(severity);
CREATE INDEX IF NOT EXISTS idx_sre_created_at ON deposit_context_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sre_user_hash ON deposit_context_logs(user_hash);

-- Habilitar RLS (Row Level Security) - Apenas leitura para admins se necessário
ALTER TABLE deposit_context_logs ENABLE ROW LEVEL SECURITY;

-- Política simples: Apenas o service_role (backend) pode inserir e ler por padrão
-- No Supabase, o backend geralmente usa a service_role key que pula as políticas de RLS
