-- ============================================================================
-- GOV-001 · EloCoins Governance (DAO) — Voting, Treasury, Proposals
-- ============================================================================
-- Módulo de governança comunitária para EloCoins.
-- Propostas, votação ponderada por nível de gamificação e tesouraria.
-- ============================================================================

BEGIN;

-- ── 1. governance_proposals ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS governance_proposals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposer_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  proposal_type     TEXT NOT NULL CHECK (proposal_type IN ('policy_change', 'fund_allocation', 'burn_event', 'community_initiative')),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'voting', 'approved', 'rejected', 'executed', 'cancelled')),
  voting_starts_at  TIMESTAMPTZ,
  voting_ends_at    TIMESTAMPTZ,
  quorum_required   INT NOT NULL DEFAULT 10,
  votes_for         INT NOT NULL DEFAULT 0,
  votes_against     INT NOT NULL DEFAULT 0,
  execution_data    JSONB DEFAULT '{}'::JSONB,
  executed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger updated_at
CREATE OR REPLACE TRIGGER trg_governance_proposals_updated_at
  BEFORE UPDATE ON governance_proposals
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_governance_proposals_status ON governance_proposals (status);
CREATE INDEX IF NOT EXISTS idx_governance_proposals_proposer ON governance_proposals (proposer_id);
CREATE INDEX IF NOT EXISTS idx_governance_proposals_type ON governance_proposals (proposal_type);
CREATE INDEX IF NOT EXISTS idx_governance_proposals_voting_ends ON governance_proposals (voting_ends_at) WHERE status IN ('open', 'voting');

COMMENT ON TABLE governance_proposals IS 'Propostas de governança comunitária EloCoins DAO';

-- ── 2. governance_votes ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS governance_votes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id   UUID NOT NULL REFERENCES governance_proposals(id) ON DELETE CASCADE,
  voter_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote          TEXT NOT NULL CHECK (vote IN ('for', 'against', 'abstain')),
  voting_power  INT NOT NULL DEFAULT 1,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (proposal_id, voter_id)
);

CREATE INDEX IF NOT EXISTS idx_governance_votes_proposal ON governance_votes (proposal_id);
CREATE INDEX IF NOT EXISTS idx_governance_votes_voter ON governance_votes (voter_id);

COMMENT ON TABLE governance_votes IS 'Votos individuais em propostas de governança';

-- ── 3. treasury_transactions ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS treasury_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type  TEXT NOT NULL CHECK (transaction_type IN ('social_fund_deposit', 'burn', 'community_grant', 'proposal_execution')),
  amount            INT NOT NULL,
  description       TEXT NOT NULL,
  reference_id      TEXT,
  metadata          JSONB DEFAULT '{}'::JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_treasury_transactions_type ON treasury_transactions (transaction_type);
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_created ON treasury_transactions (created_at DESC);

COMMENT ON TABLE treasury_transactions IS 'Ledger append-only de transações do tesouro comunitário';

-- ── 4. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE governance_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_transactions ENABLE ROW LEVEL SECURITY;

-- Proposals: any authenticated user can read, only proposer can write
CREATE POLICY governance_proposals_select ON governance_proposals
  FOR SELECT TO authenticated USING (true);

CREATE POLICY governance_proposals_insert ON governance_proposals
  FOR INSERT TO authenticated WITH CHECK (proposer_id = auth.uid()::text);

CREATE POLICY governance_proposals_update ON governance_proposals
  FOR UPDATE TO authenticated USING (proposer_id = auth.uid()::text);

-- Votes: any authenticated user can read, only voter can write
CREATE POLICY governance_votes_select ON governance_votes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY governance_votes_insert ON governance_votes
  FOR INSERT TO authenticated WITH CHECK (voter_id = auth.uid()::text);

CREATE POLICY governance_votes_update ON governance_votes
  FOR UPDATE TO authenticated USING (voter_id = auth.uid()::text);

-- Treasury: read-only for all authenticated
CREATE POLICY treasury_transactions_select ON treasury_transactions
  FOR SELECT TO authenticated USING (true);

-- Service role bypass for backend
CREATE POLICY governance_proposals_service ON governance_proposals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY governance_votes_service ON governance_votes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY treasury_transactions_service ON treasury_transactions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
