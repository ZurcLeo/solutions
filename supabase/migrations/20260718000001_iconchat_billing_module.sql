-- ============================================================
-- Migration: IconChat como Módulo de Billing dos Planos Brasileirinho
-- Data: 2026-07-18
-- Propósito:
--   1. ALTER subscription_plans: +iconchat_included, +iconchat_message_quota, +iconchat_hard_cap_pct
--   2. CREATE seller_addons: add-ons opcionais por seller
--   3. CREATE iconchat_usage_snapshots: snapshot de uso recebido via webhook
-- ============================================================

BEGIN;

-- ── 1. Expandir subscription_plans com colunas IconChat ──────────

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS iconchat_included BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS iconchat_message_quota INTEGER,
  ADD COLUMN IF NOT EXISTS iconchat_hard_cap_pct NUMERIC(4,1) DEFAULT 150.0;

COMMENT ON COLUMN subscription_plans.iconchat_included IS 'Se true, IconChat vem incluso no plano (T2/T3)';
COMMENT ON COLUMN subscription_plans.iconchat_message_quota IS 'Franquia mensal de mensagens IA (null = N/A)';
COMMENT ON COLUMN subscription_plans.iconchat_hard_cap_pct IS 'Percentual de hard cut (default 150%)';

-- Seed: T2 inclui 500 msg, T3 inclui 1000 msg
UPDATE subscription_plans SET iconchat_included = true, iconchat_message_quota = 500  WHERE slug = 'brasileirinho_t2';
UPDATE subscription_plans SET iconchat_included = true, iconchat_message_quota = 1000 WHERE slug = 'brasileirinho_t3';

-- T1 e básicos ficam false/null (add-on opcional para T1)
UPDATE subscription_plans SET iconchat_included = false WHERE slug IN ('lojista_basico', 'brasileirinho_t1', 'entregador_basico', 'entregador_ativo');

-- ── 2. Tabela seller_addons ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS seller_addons (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_user_id TEXT NOT NULL REFERENCES users(id),
  seller_id     TEXT NOT NULL REFERENCES seller_profiles(id),
  addon_slug    TEXT NOT NULL DEFAULT 'iconchat',
  monthly_price_brl NUMERIC(10,2) NOT NULL DEFAULT 29.90,
  annual_price_brl  NUMERIC(10,2) NOT NULL DEFAULT 299.00,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'annual')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_deactivation', 'inactive')),
  activated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivates_at TIMESTAMPTZ,     -- fim do ciclo pago (set on deactivation toggle)
  deactivated_at TIMESTAMPTZ,     -- when actually deactivated by cron
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(seller_user_id, addon_slug)
);

COMMENT ON TABLE seller_addons IS 'Add-ons opcionais por seller (ex: IconChat para T1)';

-- RLS: service_role only (backend gerencia)
ALTER TABLE seller_addons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seller_addons_service_role" ON seller_addons
  FOR ALL USING (auth.role() = 'service_role');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION trg_seller_addons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER seller_addons_updated_at
  BEFORE UPDATE ON seller_addons
  FOR EACH ROW
  EXECUTE FUNCTION trg_seller_addons_updated_at();

-- ── 3. Tabela iconchat_usage_snapshots ──────────────────────────

CREATE TABLE IF NOT EXISTS iconchat_usage_snapshots (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_user_id  TEXT NOT NULL REFERENCES users(id),
  seller_id       TEXT NOT NULL REFERENCES seller_profiles(id),
  messages_used   INTEGER NOT NULL DEFAULT 0,
  messages_quota  INTEGER NOT NULL DEFAULT 0,
  last_threshold_pct INTEGER NOT NULL DEFAULT 0,
  period_start    TIMESTAMPTZ,
  period_end      TIMESTAMPTZ,
  source          TEXT DEFAULT 'webhook',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(seller_user_id)
);

COMMENT ON TABLE iconchat_usage_snapshots IS 'Snapshot de uso de mensagens IconChat (upsert via webhook)';

-- RLS: service_role only
ALTER TABLE iconchat_usage_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "iconchat_usage_snapshots_service_role" ON iconchat_usage_snapshots
  FOR ALL USING (auth.role() = 'service_role');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION trg_iconchat_usage_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER iconchat_usage_updated_at
  BEFORE UPDATE ON iconchat_usage_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION trg_iconchat_usage_updated_at();

-- ── 4. Asserts ──────────────────────────────────────────────────

DO $$
BEGIN
  -- Verifica colunas adicionadas
  ASSERT (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'subscription_plans' AND column_name = 'iconchat_included') = 1,
    'Coluna iconchat_included não encontrada em subscription_plans';

  ASSERT (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'subscription_plans' AND column_name = 'iconchat_message_quota') = 1,
    'Coluna iconchat_message_quota não encontrada em subscription_plans';

  -- Verifica seed T2/T3
  ASSERT (SELECT iconchat_included FROM subscription_plans WHERE slug = 'brasileirinho_t2') = true,
    'T2 deve ter iconchat_included = true';

  ASSERT (SELECT iconchat_message_quota FROM subscription_plans WHERE slug = 'brasileirinho_t3') = 1000,
    'T3 deve ter iconchat_message_quota = 1000';

  -- Verifica tabelas criadas
  ASSERT (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_name = 'seller_addons') = 1,
    'Tabela seller_addons não encontrada';

  ASSERT (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_name = 'iconchat_usage_snapshots') = 1,
    'Tabela iconchat_usage_snapshots não encontrada';

  RAISE NOTICE 'Migration 20260718000001: Todos os asserts passaram';
END $$;

COMMIT;
