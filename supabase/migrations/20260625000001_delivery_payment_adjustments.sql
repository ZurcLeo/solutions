-- ============================================================
-- Migration: delivery_payment_adjustments
-- Contexto: Sprint 3 — Integração real Stripe para ajustes de
-- frete + Admin UI para resolução de hold_manual.
-- ============================================================

-- 1. Colunas de rastreamento de pagamento em delivery_freight_adjustments
ALTER TABLE public.delivery_freight_adjustments
  ADD COLUMN IF NOT EXISTS payment_method       TEXT
    CHECK (payment_method IS NULL OR payment_method IN (
      'stripe', 'pix', 'eloscoins', 'hybrid', 'offline_confirmed'
    )),
  ADD COLUMN IF NOT EXISTS payment_action        TEXT
    CHECK (payment_action IS NULL OR payment_action IN (
      'refund', 'charge', 'ledger_credit', 'ledger_debit', 'manual'
    )),
  ADD COLUMN IF NOT EXISTS payment_status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN (
      'pending', 'processing', 'completed', 'failed', 'manual_required'
    )),
  ADD COLUMN IF NOT EXISTS payment_reference_id  TEXT,
  ADD COLUMN IF NOT EXISTS payment_amount_brl    NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS payment_processed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_error         TEXT,
  ADD COLUMN IF NOT EXISTS admin_resolved_by     TEXT,
  ADD COLUMN IF NOT EXISTS admin_resolved_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_notes           TEXT;

-- 2. Indexes para consultas admin
CREATE INDEX IF NOT EXISTS idx_freight_adj_payment_status
  ON public.delivery_freight_adjustments (payment_status)
  WHERE payment_status IN ('pending', 'failed', 'manual_required');

CREATE INDEX IF NOT EXISTS idx_delivery_requests_stuck
  ON public.delivery_requests (updated_at DESC)
  WHERE status IN ('hold_manual', 'failed_no_deliverer', 'no_deliverer_found');

-- 3. RPC: listar delivery requests travados (admin)
CREATE OR REPLACE FUNCTION public.list_stuck_delivery_requests(
  p_statuses    TEXT[]    DEFAULT ARRAY['hold_manual', 'failed_no_deliverer', 'no_deliverer_found'],
  p_limit       INTEGER  DEFAULT 50,
  p_offset      INTEGER  DEFAULT 0
)
RETURNS TABLE (
  request_id           TEXT,
  order_id             TEXT,
  status               TEXT,
  seller_id            TEXT,
  seller_name          TEXT,
  buyer_id             TEXT,
  buyer_name           TEXT,
  original_freight_brl NUMERIC,
  accepted_fee         NUMERIC,
  re_auction_count     INTEGER,
  created_at           TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ,
  payment_method       TEXT,
  adjustment_id        TEXT,
  adjustment_status    TEXT,
  delta_brl            NUMERIC,
  adj_payment_status   TEXT,
  total_count          BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dr.id                    AS request_id,
    dr.order_id,
    dr.status,
    dr.seller_id,
    sp.trading_name          AS seller_name,
    mo.buyer_id,
    u.full_name              AS buyer_name,
    dr.original_freight_brl,
    dr.accepted_fee,
    dr.re_auction_count,
    dr.created_at,
    dr.updated_at,
    mo.payment_method,
    dfa.id                   AS adjustment_id,
    dfa.status               AS adjustment_status,
    dfa.delta_brl,
    dfa.payment_status       AS adj_payment_status,
    COUNT(*) OVER()          AS total_count
  FROM public.delivery_requests dr
  LEFT JOIN public.marketplace_orders mo ON mo.id = dr.order_id
  LEFT JOIN public.seller_profiles sp   ON sp.id = dr.seller_id
  LEFT JOIN public.users u              ON u.id  = mo.buyer_id
  LEFT JOIN LATERAL (
    SELECT dfa2.*
    FROM public.delivery_freight_adjustments dfa2
    WHERE dfa2.delivery_request_id = dr.id
    ORDER BY dfa2.created_at DESC
    LIMIT 1
  ) dfa ON true
  WHERE dr.status = ANY(p_statuses)
  ORDER BY dr.updated_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- 4. RPC: admin resolve pagamento de ajuste de frete
CREATE OR REPLACE FUNCTION public.admin_resolve_freight_payment(
  p_adjustment_id     TEXT,
  p_payment_status    TEXT,
  p_payment_reference TEXT DEFAULT NULL,
  p_admin_user_id     TEXT DEFAULT NULL,
  p_admin_notes       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_adj_id TEXT;
BEGIN
  UPDATE public.delivery_freight_adjustments SET
    payment_status       = p_payment_status,
    payment_reference_id = COALESCE(p_payment_reference, payment_reference_id),
    payment_processed_at = NOW(),
    admin_resolved_by    = p_admin_user_id,
    admin_resolved_at    = NOW(),
    admin_notes          = p_admin_notes
  WHERE id = p_adjustment_id
  RETURNING id INTO v_adj_id;

  IF v_adj_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'adjustment_not_found');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'adjustment_id', v_adj_id,
    'payment_status', p_payment_status
  );
END;
$$;
