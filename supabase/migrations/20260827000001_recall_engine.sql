-- ============================================================
-- RECALL-003 — Motor de Recall (regras, log, opt-out)
-- ============================================================
-- Seller configura regras de retorno; sistema dispara lembretes
-- automaticos para clientes que nao voltam ha N dias.
-- Complementa RECALL-001/002 (lembretes de agendamento).

-- ── Regras de recall (seller) ─────────────────────────

CREATE TABLE IF NOT EXISTS seller_recall_rules (
  id              TEXT PRIMARY KEY DEFAULT ('rcr_' || replace(gen_random_uuid()::TEXT, '-', '')),
  seller_id       TEXT NOT NULL REFERENCES seller_profiles(id) ON DELETE CASCADE,
  rule_name       TEXT NOT NULL,
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN (
    'days_since_last_order',
    'days_since_last_booking',
    'days_since_completed_booking',
    'custom'
  )),
  interval_days   INT NOT NULL CHECK (interval_days > 0),
  product_category TEXT,
  message_template TEXT NOT NULL,
  channel_preference TEXT[] NOT NULL DEFAULT '{in_app,email,push}',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  max_sends       INT NOT NULL DEFAULT 3,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Log de recalls enviados (analytics + dedup) ──────

CREATE TABLE IF NOT EXISTS recall_log (
  id                TEXT PRIMARY KEY DEFAULT ('rcl_' || replace(gen_random_uuid()::TEXT, '-', '')),
  rule_id           TEXT NOT NULL REFERENCES seller_recall_rules(id) ON DELETE CASCADE,
  seller_id         TEXT NOT NULL REFERENCES seller_profiles(id) ON DELETE CASCADE,
  client_user_id    TEXT REFERENCES users(id),
  guest_email       TEXT,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'sent' CHECK (status IN (
    'sent', 'delivered', 'opened', 'converted', 'opted_out'
  )),
  converted_order_id TEXT,
  dedup_key         TEXT NOT NULL UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Opt-out de clientes (LGPD) ───────────────────────

CREATE TABLE IF NOT EXISTS recall_optouts (
  id                TEXT PRIMARY KEY DEFAULT ('rco_' || replace(gen_random_uuid()::TEXT, '-', '')),
  client_identifier TEXT NOT NULL,
  seller_id         TEXT REFERENCES seller_profiles(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- C1 fix: NULL-safe unique — PostgreSQL trata NULL como distinto em UNIQUE.
-- Dois partial indexes cobrem ambos os cenarios (global e por seller).
CREATE UNIQUE INDEX idx_recall_optouts_global
  ON recall_optouts (client_identifier)
  WHERE seller_id IS NULL;

CREATE UNIQUE INDEX idx_recall_optouts_seller
  ON recall_optouts (client_identifier, seller_id)
  WHERE seller_id IS NOT NULL;

-- ── Indexes ───────────────────────────────────────────

CREATE INDEX idx_recall_rules_seller_active ON seller_recall_rules(seller_id) WHERE is_active = true;
CREATE INDEX idx_recall_log_seller ON recall_log(seller_id, sent_at);
CREATE INDEX idx_recall_log_client ON recall_log(client_user_id, seller_id);
CREATE INDEX idx_recall_log_rule ON recall_log(rule_id, sent_at);
CREATE INDEX idx_recall_optouts_client ON recall_optouts(client_identifier);

-- ── RLS ───────────────────────────────────────────────

ALTER TABLE seller_recall_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE recall_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE recall_optouts ENABLE ROW LEVEL SECURITY;

-- Seller manages own rules (owner or team member)
CREATE POLICY seller_recall_rules_own ON seller_recall_rules
  FOR ALL USING (
    seller_id IN (
      SELECT sp.id FROM seller_profiles sp WHERE sp.user_id = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1 FROM seller_team_members stm
      WHERE stm.seller_id = seller_recall_rules.seller_id
        AND stm.user_id = auth.uid()::text
        AND stm.status = 'active'
    )
  );

-- Recall log: seller can read
CREATE POLICY recall_log_seller ON recall_log
  FOR SELECT USING (
    seller_id IN (
      SELECT sp.id FROM seller_profiles sp WHERE sp.user_id = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1 FROM seller_team_members stm
      WHERE stm.seller_id = recall_log.seller_id
        AND stm.user_id = auth.uid()::text
        AND stm.status = 'active'
    )
  );

-- Recall log: client can see recalls sent to them
CREATE POLICY recall_log_client ON recall_log
  FOR SELECT USING (client_user_id = auth.uid()::text);

-- Recall log: service role inserts (backend)
CREATE POLICY recall_log_insert_service ON recall_log
  FOR INSERT WITH CHECK (true);

-- Optouts: client manages own
CREATE POLICY recall_optouts_own ON recall_optouts
  FOR ALL USING (client_identifier = auth.uid()::text);

-- Optouts: service role can read (for backend dedup)
CREATE POLICY recall_optouts_read_service ON recall_optouts
  FOR SELECT USING (true);

-- ── Trigger: updated_at ───────────────────────────────

CREATE OR REPLACE FUNCTION update_recall_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recall_rules_updated_at
  BEFORE UPDATE ON seller_recall_rules
  FOR EACH ROW EXECUTE FUNCTION update_recall_rules_updated_at();
