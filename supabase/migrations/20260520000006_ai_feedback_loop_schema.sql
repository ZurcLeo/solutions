-- =====================================================
-- MIGRAÇÃO: ai_feedback_loop — Schema + RLS
-- Descrição: Formaliza a tabela de feedback de IA do SRE
--            (SreRepository.saveFeedback). Tabela interna,
--            acesso exclusivo via service_role (backend).
--            Criada diretamente no remoto; esta migration
--            documenta o schema e corrige o lint RLS-001
--            ("RLS habilitado sem policies").
-- Autor: infra-agent
-- Data: 2026-05-20
-- Refs: lint rls_initplan (RLS enabled, no policies)
-- =====================================================

-- =====================================================
-- 1. TABELA ai_feedback_loop
--    Armazena feedback Accept/Reject de desenvolvedores
--    sobre diagnósticos gerados pela IA (few-shot training).
--    Escrita exclusiva via SreRepository.saveFeedback()
--    usando service_role key.
-- =====================================================
CREATE TABLE IF NOT EXISTS public.ai_feedback_loop (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    correlation_id     TEXT        NOT NULL,                -- ref ao deposit_context_logs
    feedback_type      TEXT        NOT NULL
                           CHECK (feedback_type IN ('accept', 'reject')),
    developer_comment  TEXT,                               -- comentário livre do dev
    ai_classification  TEXT,                               -- classificação sugerida pela IA
    ai_rca             TEXT,                               -- Root Cause Analysis gerado pela IA
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ai_feedback_loop IS
    'Feedback de desenvolvedor (Accept/Reject) sobre diagnósticos de IA. '
    'Usado para few-shot learning e melhoria contínua do SRE AI. '
    'Acesso exclusivo via backend (service_role). Sem acesso público.';

COMMENT ON COLUMN public.ai_feedback_loop.correlation_id IS
    'ID de correlação do request — referência lógica a deposit_context_logs.correlation_id.';

COMMENT ON COLUMN public.ai_feedback_loop.feedback_type IS
    'Avaliação do desenvolvedor: accept (diagnóstico correto) ou reject (incorreto).';

COMMENT ON COLUMN public.ai_feedback_loop.ai_rca IS
    'Root Cause Analysis gerado pela IA — preservado para treino e auditoria.';

-- Índice para queries de treinamento (busca por tipo de feedback)
CREATE INDEX IF NOT EXISTS idx_ai_feedback_correlation
    ON public.ai_feedback_loop(correlation_id);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_type_date
    ON public.ai_feedback_loop(feedback_type, created_at DESC);

-- =====================================================
-- 2. RLS
--    Habilitado. Sem policies para anon/authenticated =
--    deny-by-default para roles públicos.
--    service_role (backend) bypassa RLS por definição.
--
--    Policy explícita de deny torna a intenção clara
--    e elimina o lint "RLS enabled but no policies".
-- =====================================================
ALTER TABLE public.ai_feedback_loop ENABLE ROW LEVEL SECURITY;

-- Policy explícita: nenhum role público acessa esta tabela.
-- Documenta a intenção e silencia o lint rls_initplan.
CREATE POLICY ai_feedback_loop_backend_only
    ON public.ai_feedback_loop
    FOR ALL
    TO authenticated, anon
    USING (false)
    WITH CHECK (false);

-- Garantir que anon/authenticated não têm SELECT/INSERT via PostgREST
REVOKE ALL ON public.ai_feedback_loop FROM anon, authenticated;
