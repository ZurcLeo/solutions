-- =============================================================================
-- TRUST MARKETPLACE: Liquidação testemunhada no marketplace → Trust Passport
--
-- Conceitos:
--   - witnessed: pagamento confirmado via webhook Asaas (PAYMENT_CONFIRMED/RECEIVED)
--   - self_reported: confirmação manual (offline_confirmed + buyer_confirmed)
--   - vesting: evento fica 'pending' por 48h antes de virar 'vested'
--   - clawback: disputa/cancelamento reverte eventos do pedido
--   - pair decay: retorno decrescente por par comprador-vendedor (90d)
--   - invite guard: convites próximos reduzem/zeram impacto
--
-- Fixes incorporados (consultor):
--   #1: witnessed SÓ via webhook Asaas
--   #3: Idempotência via unique parcial (order_id, user_id, event_type)
--   #5: Whitelist — 1 caminho concede witnessed (webhook)
--   #6: invite_graph_distance SEM recursão — lookups por PK
--   #7: Backfill invited_by seguro
--   FK: invited_by com ON DELETE SET NULL
--
-- Depende de:
--   20260627000001_trust_external_domain.sql (último ALTER do CHECK)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1a. ALTER trust_events: 9 novos campos (defaults preservam compatibilidade)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE trust_events
  ADD COLUMN IF NOT EXISTS order_id          TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS counterparty_id   TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS role              TEXT DEFAULT NULL
    CHECK (role IS NULL OR role IN ('buyer', 'seller')),
  ADD COLUMN IF NOT EXISTS source            TEXT DEFAULT NULL
    CHECK (source IS NULL OR source IN ('witnessed', 'self_reported')),
  ADD COLUMN IF NOT EXISTS settlement_ref    TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS vesting_status    TEXT NOT NULL DEFAULT 'none'
    CHECK (vesting_status IN ('none', 'pending', 'vested', 'clawed_back')),
  ADD COLUMN IF NOT EXISTS vests_at          TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pair_sequence     INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS guard_flags       JSONB DEFAULT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1b. Índices para decaimento + vesting
-- ─────────────────────────────────────────────────────────────────────────────

-- Decaimento por par (counterparty lookups nos últimos 90 dias)
CREATE INDEX IF NOT EXISTS idx_trust_events_pair_decay
  ON trust_events(user_id, counterparty_id, created_at DESC)
  WHERE counterparty_id IS NOT NULL;

-- Vesting job: busca pendentes prontos para vest
CREATE INDEX IF NOT EXISTS idx_trust_events_vesting_pending
  ON trust_events(vesting_status, vests_at)
  WHERE vesting_status = 'pending';

-- Clawback: busca por order_id
CREATE INDEX IF NOT EXISTS idx_trust_events_order
  ON trust_events(order_id)
  WHERE order_id IS NOT NULL;

-- Cap diário: eventos do usuário nas últimas 24h no domínio marketplace
CREATE INDEX IF NOT EXISTS idx_trust_events_daily_cap
  ON trust_events(user_id, domain, created_at DESC)
  WHERE domain = 'marketplace';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1c. Unique parcial para idempotência de webhook
--     Webhooks do Asaas podem reenviar — mesmo (order, user, event_type) = noop
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_trust_events_order_idempotent
  ON trust_events(order_id, user_id, event_type)
  WHERE order_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1d. invited_by em users: backfill seguro + FK ON DELETE SET NULL
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS invited_by TEXT DEFAULT NULL;

-- Backfill: convite mais antigo, sender real, sender ≠ used_by
UPDATE users u
SET invited_by = sub.sender_id
FROM (
  SELECT DISTINCT ON (i.used_by)
    i.used_by,
    i.sender_id
  FROM invites i
  WHERE i.used_by IS NOT NULL
    AND i.sender_id IS NOT NULL
    AND i.sender_id <> i.used_by
    AND i.sender_id IN (SELECT id FROM users)
  ORDER BY i.used_by, i.created_at ASC
) sub
WHERE u.id = sub.used_by
  AND u.invited_by IS NULL;

-- FK com ON DELETE SET NULL (se convidador for removido, não quebra)
DO $$ BEGIN
  ALTER TABLE users
    ADD CONSTRAINT fk_users_invited_by
    FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Índice para lookups de invite_graph_distance
CREATE INDEX IF NOT EXISTS idx_users_invited_by
  ON users(invited_by)
  WHERE invited_by IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1e. invite_graph_distance() — SEM recursão
--     3-4 lookups por PK: O(1) constante, sem BFS
--     Retorna: 0 (mesma pessoa), 1 (direto), 2 (2 hops), 99 (>2 ou sem relação)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION invite_graph_distance(a_id TEXT, b_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql STABLE AS $$
DECLARE
  a_inv TEXT;
  b_inv TEXT;
BEGIN
  -- Mesma pessoa
  IF a_id = b_id THEN RETURN 0; END IF;

  -- Buscar invited_by de cada um (2 lookups por PK)
  SELECT invited_by INTO a_inv FROM users WHERE id = a_id;
  SELECT invited_by INTO b_inv FROM users WHERE id = b_id;

  -- Distância 1: A convidou B ou B convidou A
  IF a_inv = b_id OR b_inv = a_id THEN RETURN 1; END IF;

  -- Distância 2: mesmo convidador
  IF a_inv IS NOT NULL AND a_inv = b_inv THEN RETURN 2; END IF;

  -- Distância 2: A convidou quem convidou B (a_id → ? → b_id)
  IF b_inv IS NOT NULL THEN
    DECLARE b_inv_inv TEXT;
    BEGIN
      SELECT invited_by INTO b_inv_inv FROM users WHERE id = b_inv;
      IF b_inv_inv = a_id THEN RETURN 2; END IF;
    END;
  END IF;

  -- Distância 2: B convidou quem convidou A (b_id → ? → a_id)
  IF a_inv IS NOT NULL THEN
    DECLARE a_inv_inv TEXT;
    BEGIN
      SELECT invited_by INTO a_inv_inv FROM users WHERE id = a_inv;
      IF a_inv_inv = b_id THEN RETURN 2; END IF;
    END;
  END IF;

  -- >2 ou sem relação
  RETURN 99;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (documentação — executar manualmente se necessário)
-- ─────────────────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS invite_graph_distance(TEXT, TEXT);
-- DROP INDEX IF EXISTS idx_users_invited_by;
-- ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_invited_by;
-- ALTER TABLE users DROP COLUMN IF EXISTS invited_by;
-- DROP INDEX IF EXISTS idx_trust_events_order_idempotent;
-- DROP INDEX IF EXISTS idx_trust_events_daily_cap;
-- DROP INDEX IF EXISTS idx_trust_events_order;
-- DROP INDEX IF EXISTS idx_trust_events_vesting_pending;
-- DROP INDEX IF EXISTS idx_trust_events_pair_decay;
-- ALTER TABLE trust_events
--   DROP COLUMN IF EXISTS guard_flags,
--   DROP COLUMN IF EXISTS pair_sequence,
--   DROP COLUMN IF EXISTS vests_at,
--   DROP COLUMN IF EXISTS vesting_status,
--   DROP COLUMN IF EXISTS settlement_ref,
--   DROP COLUMN IF EXISTS source,
--   DROP COLUMN IF EXISTS role,
--   DROP COLUMN IF EXISTS counterparty_id,
--   DROP COLUMN IF EXISTS order_id;
