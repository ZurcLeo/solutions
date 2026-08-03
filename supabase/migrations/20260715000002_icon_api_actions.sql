-- =============================================================================
-- Migration: Icon API Actions — Dedup + Auditoria
-- Tabela icon_action_log para idempotência e rastreabilidade das ações C1-C5.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.icon_action_log (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  action_type     TEXT NOT NULL,
  seller_id       TEXT NOT NULL REFERENCES seller_profiles(id),
  customer_phone  TEXT,
  resource_id     TEXT,
  status          TEXT NOT NULL,  -- approved | denied | requires_human
  reason          TEXT,
  request_body    JSONB,
  response_body   JSONB,
  created_at      TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT uq_icon_action_dedup UNIQUE (conversation_id, action_type, resource_id)
);

CREATE INDEX idx_icon_action_seller  ON icon_action_log(seller_id);
CREATE INDEX idx_icon_action_created ON icon_action_log(created_at DESC);

ALTER TABLE icon_action_log ENABLE ROW LEVEL SECURITY;

-- Somente service_role acessa (backend)
CREATE POLICY "service_role_full_access"
  ON icon_action_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
