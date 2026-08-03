-- ============================================================
-- Migration: 20260624000007_collaborative_contests
-- Concursos Colaborativos — Group mechanics for games module
-- Tabelas: contest_teams, contest_team_members,
--          contest_challenges, contest_submissions,
--          contest_leaderboard
-- RLS: 5 tabelas — 15 policies
--
-- Decisões arquiteturais:
--   DA-CONTEST-001: contest_id referencia games.id (CHALLENGE game_type)
--   DA-CONTEST-002: PKs de usuário são TEXT (Firebase UID), não UUID
--   DA-CONTEST-003: service_role bypassa RLS para operações de backend
--   DA-CONTEST-004: leaderboard é tabela regular (refresh via backend)
--   DA-CONTEST-005: submissions suportam 3 tipos de prova (text, photo, link)
--   DA-CONTEST-006: challenges suportam 3 escopos (individual, team, community)
--   DA-CONTEST-007: captain_id em contest_teams é TEXT (Firebase UID)
--
-- Depende de:
--   20260615000001_games_module.sql (games)
--
-- Agente: game-agent | Revisado por: ClaudIA
-- Data: 2026-06-24
-- ============================================================


-- ============================================================
-- 0. Extensões necessárias
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1. contest_teams — times dentro de um concurso
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contest_teams (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id   UUID        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  team_name    TEXT        NOT NULL,
  captain_id   TEXT        NOT NULL,
  max_members  INTEGER     NOT NULL DEFAULT 5
    CHECK (max_members >= 1 AND max_members <= 50),
  score        INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (contest_id, team_name)
);

DROP TRIGGER IF EXISTS trg_contest_teams_updated_at ON public.contest_teams;
CREATE TRIGGER trg_contest_teams_updated_at
  BEFORE UPDATE ON public.contest_teams
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_contest_teams_contest_id  ON public.contest_teams (contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_teams_captain_id  ON public.contest_teams (captain_id);


-- ============================================================
-- 2. contest_team_members — membros de cada time
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contest_team_members (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id   UUID        NOT NULL REFERENCES public.contest_teams(id) ON DELETE CASCADE,
  user_id   TEXT        NOT NULL,
  role      TEXT        NOT NULL DEFAULT 'member'
    CHECK (role IN ('captain', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_contest_team_members_team_id ON public.contest_team_members (team_id);
CREATE INDEX IF NOT EXISTS idx_contest_team_members_user_id ON public.contest_team_members (user_id);


-- ============================================================
-- 3. contest_challenges — desafios dentro de um concurso
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contest_challenges (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id        UUID        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  title             TEXT        NOT NULL,
  description       TEXT,
  challenge_type    TEXT        NOT NULL DEFAULT 'individual'
    CHECK (challenge_type IN ('individual', 'team', 'community')),
  points            INTEGER     NOT NULL DEFAULT 10
    CHECK (points > 0),
  deadline          TIMESTAMPTZ,
  verification_type TEXT        NOT NULL DEFAULT 'self_report'
    CHECK (verification_type IN ('self_report', 'photo_proof', 'admin_verify', 'automatic')),
  status            TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contest_challenges_contest_id ON public.contest_challenges (contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_challenges_status     ON public.contest_challenges (status);


-- ============================================================
-- 4. contest_submissions — submissões de prova
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contest_submissions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id    UUID        NOT NULL REFERENCES public.contest_challenges(id) ON DELETE CASCADE,
  user_id         TEXT        NOT NULL,
  team_id         UUID        REFERENCES public.contest_teams(id) ON DELETE SET NULL,
  proof_url       TEXT,
  proof_type      TEXT        NOT NULL DEFAULT 'text'
    CHECK (proof_type IN ('text', 'photo', 'link')),
  status          TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  points_awarded  INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Um usuário submete no máximo 1 vez por desafio
  UNIQUE (challenge_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_contest_submissions_challenge_id ON public.contest_submissions (challenge_id);
CREATE INDEX IF NOT EXISTS idx_contest_submissions_user_id      ON public.contest_submissions (user_id);
CREATE INDEX IF NOT EXISTS idx_contest_submissions_team_id      ON public.contest_submissions (team_id);
CREATE INDEX IF NOT EXISTS idx_contest_submissions_status       ON public.contest_submissions (status);


-- ============================================================
-- 5. contest_leaderboard — ranking materializado
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contest_leaderboard (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id   UUID        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  entity_type  TEXT        NOT NULL
    CHECK (entity_type IN ('user', 'team')),
  entity_id    TEXT        NOT NULL,
  total_points INTEGER     NOT NULL DEFAULT 0,
  rank         INTEGER     NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (contest_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_contest_leaderboard_contest_id  ON public.contest_leaderboard (contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_leaderboard_rank        ON public.contest_leaderboard (contest_id, entity_type, rank);


-- ============================================================
-- 6. Gamification — tasks para concursos colaborativos
-- ============================================================

INSERT INTO public.gamification_tasks (slug, name, description, category, xp_reward, coin_reward, is_repeatable, max_completions, target_count, is_active)
VALUES
  ('contest_team_created',        'Capitão de Time',      'Crie um time em um concurso colaborativo',                'jogos', 30, 10, false, 1, 1, true),
  ('contest_challenge_completed', 'Desafio Cumprido',     'Complete um desafio em um concurso colaborativo',         'jogos', 50, 15, true, NULL, 1, true),
  ('contest_5_challenges',        'Desafiante Dedicado',  'Complete 5 desafios em concursos colaborativos',          'jogos', 80, 25, true, NULL, 5, true),
  ('contest_won',                 'Campeão do Concurso',  'Vença um concurso colaborativo (1o lugar no ranking)',    'jogos', 200, 50, false, 1, 1, true)
ON CONFLICT (slug) DO NOTHING;


-- ============================================================
-- 7. RLS — Row Level Security
-- ============================================================


-- ── 7.1 contest_teams ───────────────────────────────────────

ALTER TABLE public.contest_teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contest_teams_select_participant_or_owner" ON public.contest_teams;
CREATE POLICY "contest_teams_select_participant_or_owner"
  ON public.contest_teams FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.game_participants gp
      WHERE gp.game_id = contest_teams.contest_id
        AND gp.user_id = auth.uid()::text
        AND gp.status  = 'confirmed'
    )
    OR EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id       = contest_teams.contest_id
        AND g.owner_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "contest_teams_insert_participant" ON public.contest_teams;
CREATE POLICY "contest_teams_insert_participant"
  ON public.contest_teams FOR INSERT
  WITH CHECK (
    captain_id = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.game_participants gp
      WHERE gp.game_id = contest_teams.contest_id
        AND gp.user_id = auth.uid()::text
        AND gp.status  = 'confirmed'
    )
  );

DROP POLICY IF EXISTS "contest_teams_update_captain_or_owner" ON public.contest_teams;
CREATE POLICY "contest_teams_update_captain_or_owner"
  ON public.contest_teams FOR UPDATE
  USING (
    captain_id = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id       = contest_teams.contest_id
        AND g.owner_id = auth.uid()::text
    )
  );


-- ── 7.2 contest_team_members ────────────────────────────────

ALTER TABLE public.contest_team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contest_team_members_select_team_or_owner" ON public.contest_team_members;
CREATE POLICY "contest_team_members_select_team_or_owner"
  ON public.contest_team_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.contest_teams ct
      JOIN public.game_participants gp ON gp.game_id = ct.contest_id
      WHERE ct.id      = contest_team_members.team_id
        AND gp.user_id = auth.uid()::text
        AND gp.status  = 'confirmed'
    )
    OR EXISTS (
      SELECT 1 FROM public.contest_teams ct
      JOIN public.games g ON g.id = ct.contest_id
      WHERE ct.id      = contest_team_members.team_id
        AND g.owner_id = auth.uid()::text
    )
  );

-- INSERT/DELETE: service_role apenas (gerenciado pelo backend)


-- ── 7.3 contest_challenges ──────────────────────────────────

ALTER TABLE public.contest_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contest_challenges_select_participant_or_owner" ON public.contest_challenges;
CREATE POLICY "contest_challenges_select_participant_or_owner"
  ON public.contest_challenges FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.game_participants gp
      WHERE gp.game_id = contest_challenges.contest_id
        AND gp.user_id = auth.uid()::text
        AND gp.status  = 'confirmed'
    )
    OR EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id       = contest_challenges.contest_id
        AND g.owner_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "contest_challenges_insert_owner" ON public.contest_challenges;
CREATE POLICY "contest_challenges_insert_owner"
  ON public.contest_challenges FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id       = contest_challenges.contest_id
        AND g.owner_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "contest_challenges_update_owner" ON public.contest_challenges;
CREATE POLICY "contest_challenges_update_owner"
  ON public.contest_challenges FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id       = contest_challenges.contest_id
        AND g.owner_id = auth.uid()::text
    )
  );


-- ── 7.4 contest_submissions ─────────────────────────────────

ALTER TABLE public.contest_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contest_submissions_select_own_or_owner" ON public.contest_submissions;
CREATE POLICY "contest_submissions_select_own_or_owner"
  ON public.contest_submissions FOR SELECT
  USING (
    user_id = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.contest_challenges cc
      JOIN public.games g ON g.id = cc.contest_id
      WHERE cc.id      = contest_submissions.challenge_id
        AND g.owner_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "contest_submissions_insert_own" ON public.contest_submissions;
CREATE POLICY "contest_submissions_insert_own"
  ON public.contest_submissions FOR INSERT
  WITH CHECK (
    user_id = auth.uid()::text
  );

-- UPDATE: service_role apenas (review feito pelo backend)


-- ── 7.5 contest_leaderboard ─────────────────────────────────

ALTER TABLE public.contest_leaderboard ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contest_leaderboard_select_participant_or_owner" ON public.contest_leaderboard;
CREATE POLICY "contest_leaderboard_select_participant_or_owner"
  ON public.contest_leaderboard FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.game_participants gp
      WHERE gp.game_id = contest_leaderboard.contest_id
        AND gp.user_id = auth.uid()::text
        AND gp.status  = 'confirmed'
    )
    OR EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id       = contest_leaderboard.contest_id
        AND g.owner_id = auth.uid()::text
    )
  );

-- INSERT/UPDATE/DELETE: service_role apenas (gerenciado pelo backend refresh)
