-- ============================================================================
-- BIZ-001: Business Seats — Entidades de Negócio & Controle Granular de Equipe
-- Sprint 1: Schema Foundation (non-breaking)
-- ============================================================================
-- Adds:
--   1a. business_type column on seller_profiles
--   1b. get_my_seller_ids() function (plural — returns ALL seller_ids for a user)
--   1c. business_invites table (combined platform + team invite)
--   1d. business_trust_scores table (stub — cálculo real no backlog)
-- ============================================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1a. business_type column on seller_profiles
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'individual'
    CHECK (business_type IN ('individual', 'company', 'professional'));

COMMENT ON COLUMN public.seller_profiles.business_type IS
  'Tipo do negócio: individual (CPF), company (CNPJ), professional (CRC/OAB/CRM)';

-- ──────────────────────────────────────────────────────────────────────────────
-- 1b. get_my_seller_ids() — retorna TODOS os seller_ids (owner + team member)
-- Complementa (NÃO substitui) get_my_seller_id() existente.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_seller_ids()
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT seller_id), ARRAY[]::TEXT[])
  FROM (
    -- Owner direto
    SELECT id AS seller_id
    FROM seller_profiles
    WHERE user_id = auth.uid()::text
      AND status != 'deleted'

    UNION

    -- Team member ativo
    SELECT stm.seller_id
    FROM seller_team_members stm
    JOIN seller_profiles sp ON sp.id = stm.seller_id
    WHERE stm.user_id = auth.uid()::text
      AND stm.status = 'active'
      AND stm.active = true
      AND sp.status != 'deleted'
  ) sub;
$$;

COMMENT ON FUNCTION public.get_my_seller_ids() IS
  'Retorna array de seller_ids onde o usuário é owner OU team member ativo. Usado para multi-business context.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 1c. business_invites — convite combinado plataforma + equipe
-- Se o convidado não é usuário, gera token de registro (porta de entrada D6).
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.business_invites (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seller_id      TEXT NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  invited_by     TEXT NOT NULL REFERENCES public.users(id),
  target_email   TEXT NOT NULL,
  target_user_id TEXT REFERENCES public.users(id),  -- NULL se usuário ainda não existe
  proposed_role  TEXT NOT NULL DEFAULT 'employee'
    CHECK (proposed_role IN ('manager', 'employee')),
  proposed_permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  invite_token   TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  status         TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_business_invites_seller
  ON public.business_invites (seller_id, status);
CREATE INDEX IF NOT EXISTS idx_business_invites_email
  ON public.business_invites (target_email, status);
CREATE INDEX IF NOT EXISTS idx_business_invites_token
  ON public.business_invites (invite_token) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_business_invites_target_user
  ON public.business_invites (target_user_id) WHERE target_user_id IS NOT NULL;

-- Trigger updated_at
CREATE OR REPLACE TRIGGER trg_business_invites_updated_at
  BEFORE UPDATE ON public.business_invites
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- RLS
ALTER TABLE public.business_invites ENABLE ROW LEVEL SECURITY;

-- Owner/manager do seller pode ver convites do seu negócio
CREATE POLICY business_invites_seller_select ON public.business_invites
  FOR SELECT USING (
    seller_id = ANY(get_my_seller_ids())
  );

-- Owner/manager pode criar convites (verificação de role feita no backend)
CREATE POLICY business_invites_seller_insert ON public.business_invites
  FOR INSERT WITH CHECK (
    seller_id = ANY(get_my_seller_ids())
  );

-- Owner/manager pode atualizar (cancelar) convites
CREATE POLICY business_invites_seller_update ON public.business_invites
  FOR UPDATE USING (
    seller_id = ANY(get_my_seller_ids())
  );

-- Convidado pode ver/aceitar seus próprios convites (por email ou user_id)
CREATE POLICY business_invites_target_select ON public.business_invites
  FOR SELECT USING (
    target_user_id = auth.uid()::text
  );

CREATE POLICY business_invites_target_update ON public.business_invites
  FOR UPDATE USING (
    target_user_id = auth.uid()::text
  );

COMMENT ON TABLE public.business_invites IS
  'Convite combinado plataforma + equipe. Porta de entrada para novos usuários (D6). invite_token é único e usado para aceitar convite.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 1d. business_trust_scores — trust score por negócio (stub, cálculo no backlog)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.business_trust_scores (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seller_id       TEXT NOT NULL UNIQUE REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  trust_score     NUMERIC(5,2),  -- NULL até cálculo real ser implementado
  trust_level     INTEGER,       -- 1-5, NULL até cálculo
  -- Breakdown scores (0-100 each, weighted)
  review_score         NUMERIC(5,2),  -- média de reviews (peso 30%)
  verification_score   NUMERIC(5,2),  -- registro profissional verificado (15%)
  google_score         NUMERIC(5,2),  -- Google Places rating (10%)
  fulfillment_score    NUMERIC(5,2),  -- taxa de fulfillment (20%)
  team_conduct_score   NUMERIC(5,2),  -- conduta da equipe (15%)
  account_age_score    NUMERIC(5,2),  -- idade da conta (10%)
  -- Metadata
  last_calculated  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_trust_seller
  ON public.business_trust_scores (seller_id);

-- Trigger updated_at
CREATE OR REPLACE TRIGGER trg_business_trust_scores_updated_at
  BEFORE UPDATE ON public.business_trust_scores
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- RLS
ALTER TABLE public.business_trust_scores ENABLE ROW LEVEL SECURITY;

-- Qualquer user autenticado pode ler trust scores (são públicos)
CREATE POLICY business_trust_scores_public_read ON public.business_trust_scores
  FOR SELECT USING (true);

-- Apenas o sistema (service role) pode inserir/atualizar
-- (calculado no backend, não pelo usuário)

COMMENT ON TABLE public.business_trust_scores IS
  'Trust score por negócio (separado do trust pessoal). Stub: cálculo real depende de GP-1~5, fulfillment consolidado, conduta equipe.';

COMMIT;
