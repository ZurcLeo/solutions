-- ============================================================
-- Migration: 20260613000004_property_stays
-- Sistema de Temporada (Airbnb-style) para imóveis ElosCloud
-- Tabelas: property_stay_reviews, property_stays, property_blocked_dates
-- Triggers: updated_at, reveal_stay_reviews
-- RPC: get_property_busy_dates
-- RLS: todas as tabelas protegidas
-- ============================================================

-- Extensão necessária para EXCLUDE USING GIST com daterange
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. property_stay_reviews
--    Criada ANTES de property_stays para resolver FK circular.
--    A FK stay_id → property_stays é adicionada em ALTER TABLE posterior.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_stay_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stay_id       UUID NOT NULL,  -- FK circular — adicionada via ALTER TABLE abaixo
  reviewer_id   TEXT NOT NULL,
  reviewer_type TEXT NOT NULL CHECK (reviewer_type IN ('guest','host')),
  rating        INT  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT CHECK (char_length(comment) <= 600),
  is_visible    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stay_id, reviewer_id)
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. property_stays
--    Reservas de imóvel por temporada.
--    EXCLUDE garante que não existam duas reservas ativas sobrepostas.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_stays (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         TEXT NOT NULL REFERENCES marketplace_products(id),
  seller_id           TEXT NOT NULL REFERENCES seller_profiles(id),
  guest_id            TEXT NOT NULL,
  check_in_date       DATE NOT NULL,
  check_out_date      DATE NOT NULL,
  nights              INT  GENERATED ALWAYS AS (check_out_date - check_in_date) STORED,
  guests_count        INT  NOT NULL DEFAULT 1 CHECK (guests_count >= 1),
  price_per_night_brl NUMERIC(10,2) NOT NULL CHECK (price_per_night_brl > 0),
  total_brl           NUMERIC(10,2) NOT NULL CHECK (total_brl > 0),
  status              TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN (
      'pending_payment','confirmed','active',
      'completed','cancelled_guest','cancelled_host','disputed'
    )),
  payment_intent_id   TEXT,
  payment_status      TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','authorized','captured','refunded','voided')),
  special_requests    TEXT,
  cancellation_reason TEXT,
  guest_review_id     UUID REFERENCES property_stay_reviews(id),
  host_review_id      UUID REFERENCES property_stay_reviews(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_stay_dates CHECK (check_out_date > check_in_date),
  CONSTRAINT no_stay_overlap EXCLUDE USING gist (
    property_id WITH =,
    daterange(check_in_date, check_out_date) WITH &&
  ) WHERE (status NOT IN ('cancelled_guest','cancelled_host'))
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. FK circular: property_stay_reviews.stay_id → property_stays
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE property_stay_reviews
  ADD CONSTRAINT fk_stay_reviews_stay
  FOREIGN KEY (stay_id) REFERENCES property_stays(id) ON DELETE CASCADE;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. property_blocked_dates
--    Proprietário bloqueia manualmente faixas de datas.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_blocked_dates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  TEXT NOT NULL REFERENCES marketplace_products(id),
  seller_id    TEXT NOT NULL REFERENCES seller_profiles(id),
  blocked_from DATE NOT NULL,
  blocked_to   DATE NOT NULL,
  reason       TEXT NOT NULL DEFAULT 'outro'
    CHECK (reason IN ('manutencao','uso_proprio','outro')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_block_dates CHECK (blocked_to > blocked_from)
);

CREATE INDEX IF NOT EXISTS idx_property_blocked_dates_property
  ON property_blocked_dates (property_id, blocked_from, blocked_to);

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. Trigger: updated_at em property_stays
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_property_stays_updated_at ON property_stays;
CREATE TRIGGER trg_property_stays_updated_at
  BEFORE UPDATE ON property_stays
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. Trigger: revela reviews quando ambos os lados submetem
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reveal_stay_reviews()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM property_stay_reviews
  WHERE stay_id = NEW.stay_id;

  IF v_count >= 2 THEN
    UPDATE property_stay_reviews
    SET is_visible = true
    WHERE stay_id = NEW.stay_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reveal_stay_reviews ON property_stay_reviews;
CREATE TRIGGER trg_reveal_stay_reviews
  AFTER INSERT ON property_stay_reviews
  FOR EACH ROW EXECUTE FUNCTION reveal_stay_reviews();

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. RPC: get_property_busy_dates
--    Retorna todas as datas ocupadas (stays ativas + bloqueios manuais)
--    para um imóvel em um intervalo.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_property_busy_dates(
  p_property_id TEXT,
  p_from        DATE,
  p_to          DATE
)
RETURNS TABLE(busy_date DATE, reason TEXT)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  -- Dias de stays confirmadas/ativas/pendentes de pagamento
  SELECT d::DATE AS busy_date, 'stay' AS reason
  FROM property_stays ps
  CROSS JOIN LATERAL generate_series(
    ps.check_in_date,
    ps.check_out_date - INTERVAL '1 day',
    INTERVAL '1 day'
  ) AS d
  WHERE ps.property_id = p_property_id
    AND ps.status NOT IN ('cancelled_guest', 'cancelled_host')
    AND ps.check_in_date  <= p_to
    AND ps.check_out_date  > p_from

  UNION ALL

  -- Dias de bloqueios manuais
  SELECT d::DATE AS busy_date, 'blocked' AS reason
  FROM property_blocked_dates pb
  CROSS JOIN LATERAL generate_series(
    pb.blocked_from,
    pb.blocked_to - INTERVAL '1 day',
    INTERVAL '1 day'
  ) AS d
  WHERE pb.property_id = p_property_id
    AND pb.blocked_from <= p_to
    AND pb.blocked_to    > p_from;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. Índices de performance
-- ──────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_property_stays_property_dates
  ON property_stays (property_id, check_in_date, check_out_date)
  WHERE status NOT IN ('cancelled_guest', 'cancelled_host');

CREATE INDEX IF NOT EXISTS idx_property_stays_guest
  ON property_stays (guest_id, status);

CREATE INDEX IF NOT EXISTS idx_property_stays_seller
  ON property_stays (seller_id, status);

CREATE INDEX IF NOT EXISTS idx_property_stay_reviews_stay
  ON property_stay_reviews (stay_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. RLS — Row Level Security
-- ──────────────────────────────────────────────────────────────────────────────

-- property_stays
ALTER TABLE property_stays ENABLE ROW LEVEL SECURITY;

-- Hóspede: vê e opera suas próprias estadias
CREATE POLICY "ps_guest_all" ON property_stays
  FOR ALL
  USING (guest_id = auth.uid()::text);

-- Host: vê estadias do seu imóvel (somente leitura via RLS; escrita via backend service)
CREATE POLICY "ps_host_select" ON property_stays
  FOR SELECT
  USING (seller_id = auth.uid()::text);

-- property_stay_reviews
ALTER TABLE property_stay_reviews ENABLE ROW LEVEL SECURITY;

-- Leitura: visíveis quando is_visible=true OU o próprio reviewer vê a sua
CREATE POLICY "psr_select_visible" ON property_stay_reviews
  FOR SELECT
  USING (is_visible = true OR reviewer_id = auth.uid()::text);

-- Inserção: reviewer_id deve ser o usuário autenticado
CREATE POLICY "psr_insert_own" ON property_stay_reviews
  FOR INSERT
  WITH CHECK (reviewer_id = auth.uid()::text);

-- property_blocked_dates
ALTER TABLE property_blocked_dates ENABLE ROW LEVEL SECURITY;

-- Somente o seller opera seus bloqueios
CREATE POLICY "pbd_seller_all" ON property_blocked_dates
  FOR ALL
  USING (seller_id = auth.uid()::text);

-- Leitura pública: hóspedes precisam ver os bloqueios para o calendário
CREATE POLICY "pbd_select_public" ON property_blocked_dates
  FOR SELECT
  USING (true);
