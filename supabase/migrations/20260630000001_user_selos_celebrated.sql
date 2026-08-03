-- ============================================================
-- Migration: user_selos.celebrated flag
-- Permite detectar selos concedidos enquanto o usuário estava
-- offline e exibir celebração no próximo acesso.
-- ============================================================

ALTER TABLE user_selos ADD COLUMN IF NOT EXISTS celebrated BOOLEAN DEFAULT false;

-- Backfill: selos existentes já foram "vistos"
UPDATE user_selos SET celebrated = true WHERE celebrated IS NULL OR celebrated = false;

-- Index para busca eficiente de selos não celebrados
CREATE INDEX IF NOT EXISTS idx_user_selos_uncelebrated
  ON user_selos (user_id) WHERE celebrated = false;
