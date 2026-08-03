-- ============================================================================
-- VISION-001 · Vision Extraction Log — Tabela de auditoria de extracoes
-- ============================================================================
-- Registra cada chamada ao VisionExtractionService para auditoria, cost
-- tracking e rate-limit analytics.
-- ============================================================================

BEGIN;

-- ── Tabela principal ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vision_extraction_log (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           TEXT        NOT NULL,
  template_type     TEXT        NOT NULL,
  source_type       TEXT        NOT NULL CHECK (source_type IN ('upload', 'url')),
  confidence        NUMERIC(4,3) DEFAULT 0,
  success           BOOLEAN     NOT NULL DEFAULT FALSE,
  processing_time_ms INTEGER   DEFAULT 0,
  estimated_cost_usd NUMERIC(10,6) DEFAULT 0,
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ── Comentarios ─────────────────────────────────────────────────────────────

COMMENT ON TABLE  public.vision_extraction_log IS 'Log de extracoes visuais via Claude Vision API';
COMMENT ON COLUMN public.vision_extraction_log.template_type IS 'receipt | document_id | product_label | business_card | invoice | custom';
COMMENT ON COLUMN public.vision_extraction_log.source_type IS 'upload (file buffer) ou url (imagem baixada)';
COMMENT ON COLUMN public.vision_extraction_log.confidence IS 'Score de confianca da extracao (0.000 a 1.000)';
COMMENT ON COLUMN public.vision_extraction_log.estimated_cost_usd IS 'Custo estimado da chamada de API em USD';

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_vision_log_user_created
  ON public.vision_extraction_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vision_log_created
  ON public.vision_extraction_log (created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.vision_extraction_log ENABLE ROW LEVEL SECURITY;

-- Usuarios leem apenas seus proprios logs
CREATE POLICY vision_log_select_own ON public.vision_extraction_log
  FOR SELECT
  USING (auth.uid()::text = user_id);

-- Admins leem tudo
CREATE POLICY vision_log_select_admin ON public.vision_extraction_log
  FOR SELECT
  USING (
    check_global_role(auth.uid()::text, 'admin')
    OR check_global_role(auth.uid()::text, 'adm-master')
  );

-- Inserts apenas via service role (backend)
CREATE POLICY vision_log_insert_service ON public.vision_extraction_log
  FOR INSERT
  WITH CHECK (true);

COMMIT;
