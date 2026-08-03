-- 20260701000018_email_delivery_tracking.sql
-- GAP 1: Delivery event tracking para webhooks Resend (bounce, delivery, complaint)

-- ─── 1. email_delivery_events — log append-only de eventos de entrega ───────
CREATE TABLE IF NOT EXISTS email_delivery_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_log_id  UUID REFERENCES email_logs(id) ON DELETE SET NULL,
  message_id    TEXT NOT NULL,
  event_type    TEXT NOT NULL CHECK (event_type IN (
    'email.sent', 'email.delivered', 'email.delivery_delayed',
    'email.bounced', 'email.complained', 'email.opened', 'email.clicked'
  )),
  recipient     TEXT NOT NULL,
  bounce_type   TEXT,          -- hard | soft (somente para bounced)
  bounce_reason TEXT,          -- motivo do bounce
  raw_payload   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_events_message_id ON email_delivery_events(message_id);
CREATE INDEX idx_delivery_events_email_log  ON email_delivery_events(email_log_id);
CREATE INDEX idx_delivery_events_type       ON email_delivery_events(event_type);
CREATE INDEX idx_delivery_events_recipient  ON email_delivery_events(recipient);

-- ─── 2. email_recipient_reputation — contadores rolling por destinatário ────
CREATE TABLE IF NOT EXISTS email_recipient_reputation (
  recipient         TEXT PRIMARY KEY,
  bounce_count      INTEGER NOT NULL DEFAULT 0,
  complaint_count   INTEGER NOT NULL DEFAULT 0,
  last_bounce_at    TIMESTAMPTZ,
  last_complaint_at TIMESTAMPTZ,
  is_suppressed     BOOLEAN NOT NULL DEFAULT false,
  suppressed_at     TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 3. Expandir CHECK do email_logs.status ─────────────────────────────────
-- Remover constraint existente e recriar com novos valores
DO $$
BEGIN
  -- Tentar dropar constraint de check existente (pode ter nomes diferentes)
  BEGIN
    ALTER TABLE email_logs DROP CONSTRAINT IF EXISTS email_logs_status_check;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;

  -- Adicionar constraint expandida
  ALTER TABLE email_logs ADD CONSTRAINT email_logs_status_check
    CHECK (status IN ('pending', 'sent', 'delivered', 'bounced', 'complained', 'delivery_delayed', 'error', 'resent', 'canceled'));
END $$;

-- ─── 4. Index em email_logs.message_id para lookup rápido por webhook ───────
CREATE INDEX IF NOT EXISTS idx_email_logs_message_id ON email_logs(message_id);

-- ─── 5. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE email_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_recipient_reputation ENABLE ROW LEVEL SECURITY;

-- Somente service_role pode inserir/ler (backend via service_role_key)
CREATE POLICY "service_role_all_delivery_events" ON email_delivery_events
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_recipient_reputation" ON email_recipient_reputation
  FOR ALL USING (auth.role() = 'service_role');
