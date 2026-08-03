-- =============================================================================
-- TRUST PASSPORT: Score unificado cross-vertical de reputação
--
-- Decisões travadas (PO):
--   D1: Score numérico é interno (0-100). Público: nível (1-5) + validadores.
--       Próprio usuário vê progress_pct + próximas ações. RPC SECURITY DEFINER
--       para acesso público — sem SELECT direto na tabela para terceiros.
--   D2: Decaimento por inatividade, NÃO por conduta ruim. Eventos negativos
--       têm peso permanente. Positivos perdem peso com dormência do domínio.
--   D3: Endosso Snapshot — endorser_level_at_time imutável. Suspensão/fraude
--       marca 'under_review', não invalida automaticamente.
-- =============================================================================

-- 1. Tabela de níveis de confiança (lookup, 5 linhas)
CREATE TABLE IF NOT EXISTS trust_levels (
  level       INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  min_score   NUMERIC NOT NULL,
  min_domains INTEGER NOT NULL DEFAULT 0,
  perks       JSONB DEFAULT '[]'
);

INSERT INTO trust_levels (level, name, min_score, min_domains, perks) VALUES
  (1, 'Novato',                 0, 0, '[{"perk_key":"tx_500","description":"Transações até R$500"}]'),
  (2, 'Conhecido',             15, 1, '[{"perk_key":"tx_2000","description":"Transações até R$2.000"},{"perk_key":"custodia_peq","description":"Custódia de caixinha pequena"}]'),
  (3, 'Vizinho de Confiança',  35, 2, '[{"perk_key":"tx_5000","description":"Transações até R$5.000"},{"perk_key":"custodia_med","description":"Custódia de caixinha média"},{"perk_key":"destaque","description":"Destaque no marketplace"}]'),
  (4, 'Pilar da Comunidade',   60, 3, '[{"perk_key":"tx_ilimitado","description":"Transações sem limite"},{"perk_key":"kyc_validator","description":"Validador KYC social"},{"perk_key":"voto_peso","description":"Peso extra em votação de disputas"}]'),
  (5, 'Guardião',              85, 4, '[{"perk_key":"custodia_grande","description":"Custódia de caixinha grande"},{"perk_key":"badge_guardiao","description":"Badge Guardião permanente"}]')
ON CONFLICT (level) DO NOTHING;

-- 2. Série temporal de eventos de confiança (append-only, imutável)
CREATE TABLE IF NOT EXISTS trust_events (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT NOT NULL REFERENCES users(id),
  domain      TEXT NOT NULL
    CHECK (domain IN (
      'account', 'social', 'financial', 'stays',
      'delivery', 'marketplace', 'moderation'
    )),
  event_type  TEXT NOT NULL,
  impact      NUMERIC NOT NULL,
  is_negative BOOLEAN NOT NULL DEFAULT false,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Sinal do impact deve bater com is_negative: positivo→positive, negativo→negative
  CONSTRAINT chk_impact_sign CHECK (
    (is_negative = false AND impact > 0) OR
    (is_negative = true  AND impact < 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_trust_events_user_domain
  ON trust_events(user_id, domain, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trust_events_user_recent
  ON trust_events(user_id, created_at DESC);

-- 3. Cache do passaporte calculado (recalculado periodicamente pelo backend)
CREATE TABLE IF NOT EXISTS trust_passports (
  user_id            TEXT PRIMARY KEY REFERENCES users(id),
  trust_score        NUMERIC NOT NULL DEFAULT 0,
  trust_level        INTEGER NOT NULL DEFAULT 1 REFERENCES trust_levels(level),
  domain_scores      JSONB NOT NULL DEFAULT '{}',
  active_domains     TEXT[] NOT NULL DEFAULT '{}',
  validators         JSONB NOT NULL DEFAULT '[]',
  next_level_actions JSONB NOT NULL DEFAULT '[]',
  progress_pct       NUMERIC NOT NULL DEFAULT 0,
  bottleneck         TEXT DEFAULT NULL,
  last_calculated    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. RLS — trust_events: apenas o próprio usuário lê; INSERT/UPDATE via service role
ALTER TABLE trust_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trust_events_select_own" ON trust_events
  FOR SELECT USING (user_id = auth.uid()::text);

-- 5. RLS — trust_passports: SÓ o próprio usuário lê direto
--    Terceiros usam RPC get_public_passport (SECURITY DEFINER)
ALTER TABLE trust_passports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trust_passport_select_own" ON trust_passports
  FOR SELECT USING (user_id = auth.uid()::text);

-- 6. RPC pública — retorna SOMENTE colunas seguras para terceiros
--    SECURITY DEFINER bypassa RLS internamente
--    NUNCA expõe: trust_score, domain_scores, progress_pct, next_level_actions, bottleneck
CREATE OR REPLACE FUNCTION get_public_passport(p_user_id TEXT)
RETURNS TABLE (
  trust_level    INTEGER,
  level_name     TEXT,
  validators     JSONB,
  active_domains TEXT[]
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    tp.trust_level,
    tl.name AS level_name,
    tp.validators,
    tp.active_domains
  FROM trust_passports tp
  JOIN trust_levels tl ON tl.level = tp.trust_level
  WHERE tp.user_id = p_user_id;
$$;

-- 7. Trigger updated_at (reusa trg_fn_set_updated_at existente)
CREATE TRIGGER set_trust_passports_updated_at
  BEFORE UPDATE ON trust_passports
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- =============================================================================
-- 8. ALTER kyc_social_validations — suporte a endosso de confiança
--    Snapshot: endorser_level_at_time imutável por inatividade.
--    Revisão administrativa por suspensão/fraude via endorsement_status.
-- =============================================================================

-- Coluna denormalizada: user validado (para unicidade de par)
-- Derivado de: validations.request_id → requests.user_id
ALTER TABLE kyc_social_validations
  ADD COLUMN IF NOT EXISTS validated_user_id TEXT,
  ADD COLUMN IF NOT EXISTS endorser_level_at_time INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS endorsement_status TEXT NOT NULL DEFAULT 'active';

-- CHECK constraint para endorsement_status
DO $$ BEGIN
  ALTER TABLE kyc_social_validations
    ADD CONSTRAINT chk_endorsement_status
    CHECK (endorsement_status IN ('active', 'under_review', 'invalidated'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill validated_user_id para validações existentes
UPDATE kyc_social_validations v
SET validated_user_id = r.user_id
FROM kyc_social_requests r
WHERE v.request_id = r.id
  AND v.validated_user_id IS NULL;

-- Agora tornar NOT NULL (após backfill)
ALTER TABLE kyc_social_validations
  ALTER COLUMN validated_user_id SET NOT NULL;

-- Unicidade INCONDICIONAL: um par (validator, validated), para sempre
-- Se invalidado, a linha permanece como 'invalidated' e BLOQUEIA novo endosso
-- Re-endosso após reabilitação = UPDATE status → 'active', não nova linha
CREATE UNIQUE INDEX IF NOT EXISTS idx_kyc_unique_endorser_pair
  ON kyc_social_validations(validator_id, validated_user_id);
