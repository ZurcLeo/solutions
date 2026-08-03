-- =============================================================================
-- Migration: Proposta B — outcome-aware dedup para icon_action_log
-- Data: 2026-07-20
-- Contexto: O _wrapAction gravava toda resposta (approved/denied/requires_human)
--   e deduplicava por UNIQUE(conversation_id, action_type, resource_id).
--   Negações ficavam cacheadas eternamente — se o motivo do bloqueio desaparecia,
--   o cliente não conseguia retried na mesma conversa.
--
-- Fix: Coluna `outcome` (pending/denied/success). Apenas `success` e `pending`
--   participam do UNIQUE index. `denied` permite retry futuro. `pending` protege
--   contra retry durante janela de execução (o caso ETIMEDOUT + retry do bot).
--
-- Mapeamento status → outcome:
--   approved / requires_human → success (ação tomada, não repetir)
--   denied                   → denied  (pode retried)
--   pending / error          → estados transitórios do novo fluxo
-- =============================================================================

BEGIN;

-- ── 1. Adicionar coluna outcome ─────────────────────────────────────────────
ALTER TABLE public.icon_action_log
  ADD COLUMN IF NOT EXISTS outcome TEXT;

-- Constraint separado (IF NOT EXISTS não funciona com ADD COLUMN + CHECK inline)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_icon_action_outcome'
  ) THEN
    ALTER TABLE public.icon_action_log
      ADD CONSTRAINT chk_icon_action_outcome
      CHECK (outcome IN ('pending', 'denied', 'success'));
  END IF;
END $$;

-- ── 2. Backfill: classificar entries existentes pelo status ─────────────────
UPDATE public.icon_action_log
SET outcome = CASE
  WHEN status IN ('approved', 'requires_human') THEN 'success'
  WHEN status = 'denied' THEN 'denied'
  ELSE 'success'  -- fallback conservador para entries sem status conhecido
END
WHERE outcome IS NULL;

-- Agora que está preenchido, tornar NOT NULL
ALTER TABLE public.icon_action_log
  ALTER COLUMN outcome SET NOT NULL,
  ALTER COLUMN outcome SET DEFAULT 'pending';

-- ── 3. Trocar UNIQUE constraint por partial unique index ────────────────────
-- Apenas success e pending participam do dedup.
-- denied pode existir múltiplas vezes (retries após negação).
ALTER TABLE public.icon_action_log
  DROP CONSTRAINT IF EXISTS uq_icon_action_dedup;

CREATE UNIQUE INDEX uq_icon_action_dedup_v2
  ON public.icon_action_log (conversation_id, action_type, resource_id)
  WHERE outcome IN ('pending', 'success');

-- ── 4. Index para cleanup de pending stale (futuro cron/manual) ─────────────
CREATE INDEX idx_icon_action_pending
  ON public.icon_action_log (created_at)
  WHERE outcome = 'pending';

COMMIT;
