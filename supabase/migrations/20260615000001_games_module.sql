-- ============================================================
-- Migration: 20260615000001_games_module
-- Módulo de Jogos ElosCloud — JOGOS-DB-001
-- Tabelas: games, game_participants, game_invites,
--          selection_list_items, raffle_tickets,
--          secret_friend_pairs, game_results
-- Trigger: updated_at em games
-- RLS: 7 tabelas — 16 policies
--
-- Decisões arquiteturais:
--   DA-GAMES-001: games é independente de rifas/caixinhas
--   DA-GAMES-002: caixinha_id é OPTIONAL (NULL default) — associação posterior
--   DA-GAMES-003: sorteios reutilizam sorteioService.js (sem FK para caixinha)
--   DA-GAMES-004: PKs de usuário são TEXT (Firebase UID), não UUID
--   DA-GAMES-005: service_role bypassa RLS para operações de backend
--   DA-GAMES-006: trg_fn_set_updated_at com CREATE OR REPLACE (idempotente)
--   DA-GAMES-007: game_participants INSERT sem policy = deny para authenticated
--   DA-GAMES-008: lock otimista de selection_list_items enforced no backend
--   DA-GAMES-009: caixinhas.id é TEXT — FK compatível
--   DA-GAMES-010: idx_game_invites_token explícito mesmo com UNIQUE constraint
--
-- Depende de:
--   20260513000001_caixinha_core_schema.sql  (caixinhas)
--
-- Agente: rifa-agent | Revisado por: ClaudIA
-- Data: 2026-06-15
-- ============================================================


-- ============================================================
-- 0. Extensões necessárias
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1. Função updated_at — idempotente via CREATE OR REPLACE
-- ============================================================

CREATE OR REPLACE FUNCTION trg_fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ============================================================
-- 2. games — tabela raiz do módulo
-- ============================================================

CREATE TABLE IF NOT EXISTS public.games (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              TEXT        NOT NULL,
  caixinha_id           TEXT        REFERENCES public.caixinhas(id)
                                      ON DELETE SET NULL,
  game_type             TEXT        NOT NULL
    CHECK (game_type IN (
      'SELECTION_LIST',
      'RAFFLE',
      'SECRET_FRIEND',
      'BOLAO',
      'QUIZ',
      'CHALLENGE'
    )),
  title                 TEXT        NOT NULL,
  description           TEXT,
  status                TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'closed', 'cancelled')),
  config                JSONB       NOT NULL DEFAULT '{}',

  -- Campos específicos de rifa
  ticket_price          NUMERIC(10,2),
  ticket_count          INTEGER,
  prize_description     TEXT,

  -- Campos específicos de amigo oculto
  suggested_gift_value  NUMERIC(10,2),
  gift_value_mode       TEXT        DEFAULT 'suggested'
    CHECK (gift_value_mode IN ('fixed', 'suggested', 'free')),

  -- Datas de controle
  registration_deadline TIMESTAMPTZ,
  draw_at               TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_games_updated_at ON public.games;
CREATE TRIGGER trg_games_updated_at
  BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_games_owner_id    ON public.games (owner_id);
CREATE INDEX IF NOT EXISTS idx_games_caixinha_id ON public.games (caixinha_id);
CREATE INDEX IF NOT EXISTS idx_games_status      ON public.games (status);
CREATE INDEX IF NOT EXISTS idx_games_game_type   ON public.games (game_type);


-- ============================================================
-- 3. game_participants
-- ============================================================

CREATE TABLE IF NOT EXISTS public.game_participants (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id             UUID        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  user_id             TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'declined')),

  -- Negociação de valor do presente (Amigo Oculto)
  gift_value_proposal NUMERIC(10,2),
  gift_value_accepted BOOLEAN,

  joined_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at        TIMESTAMPTZ,

  UNIQUE (game_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_game_participants_game_id ON public.game_participants (game_id);
CREATE INDEX IF NOT EXISTS idx_game_participants_user_id ON public.game_participants (user_id);


-- ============================================================
-- 4. game_invites
-- ============================================================

CREATE TABLE IF NOT EXISTS public.game_invites (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id           UUID        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  invited_by        TEXT        NOT NULL,
  invitee_email     TEXT,                       -- novo usuário (não cadastrado)
  invitee_user_id   TEXT,                       -- usuário existente (amigo)
  status            TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  token             TEXT        NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',

  -- Exatamente um dos dois deve ser preenchido
  CONSTRAINT game_invites_invitee_check CHECK (
    (invitee_email IS NOT NULL AND invitee_user_id IS NULL)
    OR (invitee_email IS NULL AND invitee_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_game_invites_game_id        ON public.game_invites (game_id);
CREATE INDEX IF NOT EXISTS idx_game_invites_token          ON public.game_invites (token);
CREATE INDEX IF NOT EXISTS idx_game_invites_invitee_user_id ON public.game_invites (invitee_user_id);


-- ============================================================
-- 5. selection_list_items
-- ============================================================

CREATE TABLE IF NOT EXISTS public.selection_list_items (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       UUID        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  label         TEXT        NOT NULL,
  description   TEXT,
  display_order INTEGER     NOT NULL DEFAULT 0,
  claimed_by    TEXT,                           -- NULL = disponível
  claimed_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_selection_list_items_game_id    ON public.selection_list_items (game_id);
CREATE INDEX IF NOT EXISTS idx_selection_list_items_claimed_by ON public.selection_list_items (claimed_by);


-- ============================================================
-- 6. raffle_tickets
-- ============================================================

CREATE TABLE IF NOT EXISTS public.raffle_tickets (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  ticket_number   INTEGER     NOT NULL,
  owner_id        TEXT,                         -- NULL = disponível
  payment_status  TEXT        NOT NULL DEFAULT 'available'
    CHECK (payment_status IN ('available', 'reserved', 'paid', 'cancelled')),
  payment_id      TEXT,                         -- referência Asaas
  reserved_at     TIMESTAMPTZ,                  -- expiração de reserva: 30min
  purchased_at    TIMESTAMPTZ,

  UNIQUE (game_id, ticket_number)
);

CREATE INDEX IF NOT EXISTS idx_raffle_tickets_game_id        ON public.raffle_tickets (game_id);
CREATE INDEX IF NOT EXISTS idx_raffle_tickets_owner_id       ON public.raffle_tickets (owner_id);
CREATE INDEX IF NOT EXISTS idx_raffle_tickets_payment_status ON public.raffle_tickets (payment_status);


-- ============================================================
-- 7. secret_friend_pairs
-- ============================================================

CREATE TABLE IF NOT EXISTS public.secret_friend_pairs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       UUID        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  giver_id      TEXT        NOT NULL,
  receiver_id   TEXT        NOT NULL,
  revealed_at   TIMESTAMPTZ,                    -- NULL até o participante consultar

  UNIQUE (game_id, giver_id)
);

CREATE INDEX IF NOT EXISTS idx_secret_friend_pairs_game_id  ON public.secret_friend_pairs (game_id);
CREATE INDEX IF NOT EXISTS idx_secret_friend_pairs_giver_id ON public.secret_friend_pairs (giver_id);


-- ============================================================
-- 8. game_results
-- ============================================================

CREATE TABLE IF NOT EXISTS public.game_results (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       UUID        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  result_data   JSONB       NOT NULL,
  result_hash   TEXT        NOT NULL,
  algorithm     TEXT        NOT NULL,
  drawn_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_results_game_id ON public.game_results (game_id);


-- ============================================================
-- 9. RLS — Row Level Security
-- ============================================================


-- ── 9.1 games ───────────────────────────────────────────────

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "games_select_owner_or_participant" ON public.games;
CREATE POLICY "games_select_owner_or_participant"
  ON public.games FOR SELECT
  USING (
    owner_id = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.game_participants gp
      WHERE gp.game_id = games.id
        AND gp.user_id = auth.uid()::text
        AND gp.status  = 'confirmed'
    )
  );

DROP POLICY IF EXISTS "games_insert_authenticated" ON public.games;
CREATE POLICY "games_insert_authenticated"
  ON public.games FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "games_update_owner" ON public.games;
CREATE POLICY "games_update_owner"
  ON public.games FOR UPDATE
  USING (
    owner_id = auth.uid()::text
    AND status NOT IN ('closed', 'cancelled')
  );

DROP POLICY IF EXISTS "games_delete_owner_draft" ON public.games;
CREATE POLICY "games_delete_owner_draft"
  ON public.games FOR DELETE
  USING (
    owner_id = auth.uid()::text
    AND status = 'draft'
  );


-- ── 9.2 game_participants ────────────────────────────────────

ALTER TABLE public.game_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "game_participants_select_own_or_owner" ON public.game_participants;
CREATE POLICY "game_participants_select_own_or_owner"
  ON public.game_participants FOR SELECT
  USING (
    user_id = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id       = game_participants.game_id
        AND g.owner_id = auth.uid()::text
    )
  );

-- INSERT: service_role apenas (sem policy = deny-by-default para authenticated)

DROP POLICY IF EXISTS "game_participants_update_own" ON public.game_participants;
CREATE POLICY "game_participants_update_own"
  ON public.game_participants FOR UPDATE
  USING (user_id = auth.uid()::text);


-- ── 9.3 game_invites ─────────────────────────────────────────

ALTER TABLE public.game_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "game_invites_select_parties" ON public.game_invites;
CREATE POLICY "game_invites_select_parties"
  ON public.game_invites FOR SELECT
  USING (
    invited_by         = auth.uid()::text
    OR invitee_user_id = auth.uid()::text
  );

DROP POLICY IF EXISTS "game_invites_insert_invited_by" ON public.game_invites;
CREATE POLICY "game_invites_insert_invited_by"
  ON public.game_invites FOR INSERT
  WITH CHECK (invited_by = auth.uid()::text);

DROP POLICY IF EXISTS "game_invites_update_invitee" ON public.game_invites;
CREATE POLICY "game_invites_update_invitee"
  ON public.game_invites FOR UPDATE
  USING (invitee_user_id = auth.uid()::text);


-- ── 9.4 selection_list_items ─────────────────────────────────

ALTER TABLE public.selection_list_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "selection_list_items_select_participant" ON public.selection_list_items;
CREATE POLICY "selection_list_items_select_participant"
  ON public.selection_list_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.game_participants gp
      WHERE gp.game_id = selection_list_items.game_id
        AND gp.user_id = auth.uid()::text
        AND gp.status  = 'confirmed'
    )
  );

DROP POLICY IF EXISTS "selection_list_items_insert_owner" ON public.selection_list_items;
CREATE POLICY "selection_list_items_insert_owner"
  ON public.selection_list_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id       = selection_list_items.game_id
        AND g.owner_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "selection_list_items_update_claim" ON public.selection_list_items;
CREATE POLICY "selection_list_items_update_claim"
  ON public.selection_list_items FOR UPDATE
  USING (
    -- Owner pode editar qualquer campo
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id       = selection_list_items.game_id
        AND g.owner_id = auth.uid()::text
    )
    OR (
      -- Participante confirmado pode fazer claim (lock otimista: coluna enforced no backend)
      (claimed_by IS NULL OR claimed_by = auth.uid()::text)
      AND EXISTS (
        SELECT 1 FROM public.game_participants gp
        WHERE gp.game_id = selection_list_items.game_id
          AND gp.user_id = auth.uid()::text
          AND gp.status  = 'confirmed'
      )
    )
  );

DROP POLICY IF EXISTS "selection_list_items_delete_owner" ON public.selection_list_items;
CREATE POLICY "selection_list_items_delete_owner"
  ON public.selection_list_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id       = selection_list_items.game_id
        AND g.owner_id = auth.uid()::text
    )
  );


-- ── 9.5 raffle_tickets ───────────────────────────────────────

ALTER TABLE public.raffle_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "raffle_tickets_select_participant_or_owner" ON public.raffle_tickets;
CREATE POLICY "raffle_tickets_select_participant_or_owner"
  ON public.raffle_tickets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.game_participants gp
      WHERE gp.game_id = raffle_tickets.game_id
        AND gp.user_id = auth.uid()::text
        AND gp.status  = 'confirmed'
    )
    OR EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id       = raffle_tickets.game_id
        AND g.owner_id = auth.uid()::text
    )
  );

-- INSERT/UPDATE: service_role apenas (sem policies = deny-by-default para authenticated)


-- ── 9.6 secret_friend_pairs ──────────────────────────────────

ALTER TABLE public.secret_friend_pairs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "secret_friend_pairs_select_giver_or_owner" ON public.secret_friend_pairs;
CREATE POLICY "secret_friend_pairs_select_giver_or_owner"
  ON public.secret_friend_pairs FOR SELECT
  USING (
    giver_id = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id       = secret_friend_pairs.game_id
        AND g.owner_id = auth.uid()::text
    )
  );

-- INSERT: service_role apenas


-- ── 9.7 game_results ─────────────────────────────────────────

ALTER TABLE public.game_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "game_results_select_participant_or_owner" ON public.game_results;
CREATE POLICY "game_results_select_participant_or_owner"
  ON public.game_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.game_participants gp
      WHERE gp.game_id = game_results.game_id
        AND gp.user_id = auth.uid()::text
        AND gp.status  = 'confirmed'
    )
    OR EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id       = game_results.game_id
        AND g.owner_id = auth.uid()::text
    )
  );

-- INSERT: service_role apenas
