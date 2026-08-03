-- =============================================================
-- Migration: Modulo Bolao de Previsoes (game_type: BOLAO)
-- Spec: ElosCloud_Spec_Bolao_Previsoes.docx v1.0
--
-- Cria:
--   - Extensao da tabela games (prize_type + service_intent)
--   - prediction_events (eventos/jogos do bolao)
--   - prediction_entries (palpites dos participantes)
--   - RLS policies
--   - Indices
--   - Gamification tasks (4 eventos)
--
-- game_type 'BOLAO' ja existe no CHECK original (20260615000001)
-- =============================================================

-- -------------------------------------------------------
-- 1. Extensao da tabela games
-- -------------------------------------------------------

-- Adicionar coluna prize_type (nao existia na tabela original)
ALTER TABLE games ADD COLUMN IF NOT EXISTS prize_type TEXT;

-- Adicionar CHECK para prize_type (inclui service_intent)
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_prize_type_check;
ALTER TABLE games ADD CONSTRAINT games_prize_type_check
  CHECK (prize_type IN (
    'description', 'product_snapshot',
    'stay_property', 'stay_intent', 'service_intent'
  ));

-- Campos para service_intent (consultoria/assinatura como premio)
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS prize_service_category  TEXT,
  ADD COLUMN IF NOT EXISTS prize_service_sessions   INTEGER,
  ADD COLUMN IF NOT EXISTS prize_service_max_value   NUMERIC(10,2);

-- -------------------------------------------------------
-- 2. prediction_events
-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS prediction_events (
  id    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,

  -- Tipo do evento
  event_type TEXT DEFAULT 'match'
    CHECK (event_type IN ('match', 'winner', 'custom')),

  -- Times
  team_home       TEXT NOT NULL,
  team_home_flag  TEXT,            -- nullable (knockout TBD)
  team_away       TEXT NOT NULL,
  team_away_flag  TEXT,

  -- Quando acontece (horario local do venue)
  event_date      DATE NOT NULL,
  event_time      TIME,
  event_timezone  TEXT DEFAULT 'America/Sao_Paulo',
  event_stage     TEXT,

  -- Horario convertido para exibicao (Brasilia)
  brasilia_date   DATE,
  brasilia_time   TIME,

  -- Local
  venue           TEXT,
  city            TEXT,

  -- Identificacao no bracket (FIFA match number)
  match_number    INTEGER,

  -- Resolucao de knockout (de qual jogo vem cada time)
  source_match_home  INTEGER,
  source_type_home   TEXT CHECK (source_type_home IN ('winner', 'loser')),
  source_match_away  INTEGER,
  source_type_away   TEXT CHECK (source_type_away IN ('winner', 'loser')),

  -- Controle de ativacao (knockout comeca inativo)
  is_active       BOOLEAN DEFAULT true,
  is_placeholder  BOOLEAN DEFAULT false,

  -- Resultado real (preenchido pelo criador apos o jogo)
  result_home_score   INTEGER,
  result_away_score   INTEGER,
  result_scorers      JSONB DEFAULT '[]',
  result_confirmed_at TIMESTAMPTZ,
  result_confirmed_by TEXT REFERENCES users(id),

  -- Contestacao
  contested_at    TIMESTAMPTZ,
  contested_by    TEXT REFERENCES users(id),
  contest_status  TEXT DEFAULT 'none'
    CHECK (contest_status IN ('none', 'open', 'resolved')),

  -- Configuracao de pontuacao (personalizavel por evento)
  points_exact_score            INTEGER DEFAULT 10,
  points_winner                 INTEGER DEFAULT 5,
  points_draw                   INTEGER DEFAULT 3,
  eloscoin_base                 NUMERIC DEFAULT 20,
  eloscoin_multiplier_per_scorer NUMERIC DEFAULT 1.0,

  display_order   INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- match_number unique dentro do mesmo bolao
CREATE UNIQUE INDEX IF NOT EXISTS idx_prediction_events_match_num_game
  ON prediction_events(game_id, match_number)
  WHERE match_number IS NOT NULL;

-- -------------------------------------------------------
-- 3. prediction_entries (palpites — append-only)
-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS prediction_entries (
  id        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_id  TEXT REFERENCES prediction_events(id) ON DELETE CASCADE NOT NULL,
  user_id   TEXT REFERENCES users(id) NOT NULL,
  game_id   UUID REFERENCES games(id) NOT NULL,  -- denormalizado para queries

  -- Palpite obrigatorio
  predicted_home_score INTEGER NOT NULL CHECK (predicted_home_score >= 0),
  predicted_away_score INTEGER NOT NULL CHECK (predicted_away_score >= 0),

  -- Palpite opcional de artilheiros
  predicted_scorers    JSONB DEFAULT '[]',

  -- Resultado da apuracao (calculado pelo backend)
  points_earned    INTEGER DEFAULT 0,
  eloscoin_bonus   NUMERIC DEFAULT 0,
  scorers_correct  INTEGER DEFAULT 0,
  is_exact_score   BOOLEAN DEFAULT false,
  apurated_at      TIMESTAMPTZ,

  submitted_at     TIMESTAMPTZ DEFAULT now(),

  UNIQUE(event_id, user_id)
);

-- -------------------------------------------------------
-- 4. Indices
-- -------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_prediction_events_game
  ON prediction_events(game_id);

CREATE INDEX IF NOT EXISTS idx_prediction_events_date
  ON prediction_events(event_date)
  WHERE result_confirmed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_prediction_events_display
  ON prediction_events(game_id, display_order);

CREATE INDEX IF NOT EXISTS idx_prediction_events_active
  ON prediction_events(game_id, is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_prediction_entries_event
  ON prediction_entries(event_id);

CREATE INDEX IF NOT EXISTS idx_prediction_entries_game_user
  ON prediction_entries(game_id, user_id);

-- -------------------------------------------------------
-- 5. RLS
-- -------------------------------------------------------

ALTER TABLE prediction_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_entries ENABLE ROW LEVEL SECURITY;

-- prediction_events: leitura por participantes ou dono do bolao
DROP POLICY IF EXISTS prediction_events_select ON prediction_events;
CREATE POLICY prediction_events_select ON prediction_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM game_participants gp
      WHERE gp.game_id = prediction_events.game_id
        AND gp.user_id = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = prediction_events.game_id
        AND g.owner_id = auth.uid()::text
    )
  );

-- prediction_events: criacao apenas pelo dono do bolao
DROP POLICY IF EXISTS prediction_events_insert ON prediction_events;
CREATE POLICY prediction_events_insert ON prediction_events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = prediction_events.game_id
        AND g.owner_id = auth.uid()::text
    )
  );

-- prediction_events: edicao apenas pelo dono do bolao
DROP POLICY IF EXISTS prediction_events_update ON prediction_events;
CREATE POLICY prediction_events_update ON prediction_events
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = prediction_events.game_id
        AND g.owner_id = auth.uid()::text
    )
  );

-- prediction_events: delecao pelo dono, so antes de ter palpites
DROP POLICY IF EXISTS prediction_events_delete ON prediction_events;
CREATE POLICY prediction_events_delete ON prediction_events
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = prediction_events.game_id
        AND g.owner_id = auth.uid()::text
    )
    AND NOT EXISTS (
      SELECT 1 FROM prediction_entries pe
      WHERE pe.event_id = prediction_events.id
    )
  );

-- prediction_entries: leitura do proprio + outros apos apuracao
DROP POLICY IF EXISTS prediction_entries_select ON prediction_entries;
CREATE POLICY prediction_entries_select ON prediction_entries
  FOR SELECT USING (
    user_id = auth.uid()::text
    OR (
      apurated_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM game_participants gp
        WHERE gp.game_id = prediction_entries.game_id
          AND gp.user_id = auth.uid()::text
      )
    )
  );

-- prediction_entries: insercao pelo proprio usuario (participante)
DROP POLICY IF EXISTS prediction_entries_insert ON prediction_entries;
CREATE POLICY prediction_entries_insert ON prediction_entries
  FOR INSERT WITH CHECK (
    user_id = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM game_participants gp
      WHERE gp.game_id = prediction_entries.game_id
        AND gp.user_id = auth.uid()::text
    )
  );

-- prediction_entries: IMUTAVEL — sem update/delete pelo client
-- (apuracao feita via service_role no backend, bypassa RLS)
DROP POLICY IF EXISTS prediction_entries_no_update ON prediction_entries;
CREATE POLICY prediction_entries_no_update ON prediction_entries
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS prediction_entries_no_delete ON prediction_entries;
CREATE POLICY prediction_entries_no_delete ON prediction_entries
  FOR DELETE USING (false);

-- -------------------------------------------------------
-- 6. Gamification tasks
-- -------------------------------------------------------

INSERT INTO gamification_tasks (
  slug, name, description,
  category, xp_reward, coin_reward,
  is_repeatable, max_completions, target_count,
  sort_order
) VALUES
  ('prediction_entry_submitted', 'Palpite registrado',
   'Submeter um palpite em um bolao de previsoes',
   'jogos', 10, 0, true, NULL, 1, 3070),

  ('prediction_bonus_earned', 'Bonus de previsao',
   'Ganhar ElosCoins por acerto em bolao',
   'jogos', 0, 0, true, NULL, 1, 3080),

  ('prediction_exact_score', 'Placar exato!',
   'Acertar o placar exato de uma partida no bolao',
   'jogos', 50, 0, true, NULL, 1, 3090),

  ('bolao_won', 'Campeao do Bolao',
   'Ficar em 1o lugar no ranking final de um bolao',
   'jogos', 200, 0, false, 1, 1, 3100)
ON CONFLICT (slug) DO NOTHING;
