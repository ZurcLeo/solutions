-- Migration: JOGOS-001 — Infraestrutura de tipos de concurso
-- Sprint 1 — 2026-06-09
-- Adiciona contest_type + contest_config à tabela rifas existente (sem renomear)
-- Cria tabelas auxiliares contest_votes e contest_pairs com RLS

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Estender tabela rifas
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE rifas
  ADD COLUMN IF NOT EXISTS contest_type   TEXT    NOT NULL DEFAULT 'SORTEIO',
  ADD COLUMN IF NOT EXISTS contest_config JSONB   NOT NULL DEFAULT '{}';

-- CHECK constraint — tipos válidos (extensível nos próximos sprints)
ALTER TABLE rifas
  DROP CONSTRAINT IF EXISTS rifas_contest_type_check;

ALTER TABLE rifas
  ADD CONSTRAINT rifas_contest_type_check
  CHECK (contest_type IN ('SORTEIO', 'ELEICAO', 'SOLIDARIA', 'AMIGO_SECRETO', 'BOLAO', 'DESAFIO'));

-- Retrocompatibilidade: todos os registros existentes já têm DEFAULT 'SORTEIO'
-- Nenhum UPDATE necessário — o DEFAULT é aplicado na criação da coluna.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tabela de votos (ELEICAO e SOLIDARIA)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contest_votes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id  TEXT        NOT NULL REFERENCES rifas(id) ON DELETE CASCADE,
  voter_id    TEXT        NOT NULL,
  candidate   TEXT        NOT NULL,   -- userId (ELEICAO) | causa livre (SOLIDARIA)
  voted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contest_id, voter_id)       -- 1 voto por membro por concurso
);

CREATE INDEX IF NOT EXISTS idx_contest_votes_contest_id
  ON contest_votes (contest_id);

-- Índice composto para GROUP BY candidate no cálculo de resultado
CREATE INDEX IF NOT EXISTS idx_contest_votes_candidate
  ON contest_votes (contest_id, candidate);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Tabela de pares (AMIGO_SECRETO)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contest_pairs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id  TEXT        NOT NULL REFERENCES rifas(id) ON DELETE CASCADE,
  giver_id    TEXT        NOT NULL,
  receiver_id TEXT        NOT NULL,
  revealed_at TIMESTAMPTZ,            -- NULL até a data de revelação
  UNIQUE (contest_id, giver_id)       -- cada membro tem exatamente um par
);

CREATE INDEX IF NOT EXISTS idx_contest_pairs_contest_id
  ON contest_pairs (contest_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS — contest_votes
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE contest_votes ENABLE ROW LEVEL SECURITY;

-- Inserir: apenas o próprio voto
DROP POLICY IF EXISTS "contest_votes_insert_own" ON contest_votes;
CREATE POLICY "contest_votes_insert_own"
  ON contest_votes FOR INSERT
  WITH CHECK (voter_id = auth.uid()::text);

-- Ler: membros da caixinha veem todos os votos do concurso
DROP POLICY IF EXISTS "contest_votes_select_member" ON contest_votes;
CREATE POLICY "contest_votes_select_member"
  ON contest_votes FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   rifas r
      JOIN   caixinha_members cm ON cm.caixinha_id = r.caixinha_id
      WHERE  r.id            = contest_votes.contest_id
        AND  cm.user_id      = auth.uid()::text
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS — contest_pairs
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE contest_pairs ENABLE ROW LEVEL SECURITY;

-- Ler: membro vê apenas o par onde é giver; admin/owner da caixinha vê todos
DROP POLICY IF EXISTS "contest_pairs_select_own" ON contest_pairs;
CREATE POLICY "contest_pairs_select_own"
  ON contest_pairs FOR SELECT
  USING (
    giver_id = auth.uid()::text
    OR EXISTS (
      SELECT 1
      FROM   rifas r
      JOIN   caixinha_members cm ON cm.caixinha_id = r.caixinha_id
      WHERE  r.id       = contest_pairs.contest_id
        AND  cm.user_id = auth.uid()::text
        AND  cm.role    IN ('admin', 'owner')
    )
  );

-- Inserir: apenas o sistema (via service_role key no backend)
DROP POLICY IF EXISTS "contest_pairs_insert_system" ON contest_pairs;
CREATE POLICY "contest_pairs_insert_system"
  ON contest_pairs FOR INSERT
  WITH CHECK (true);
