-- =====================================================================
-- Cleanup: deduplicar sessões + índice parcial único para prevenir
-- explosão de sessões duplicadas (mesmo user+browser+os+device_type)
-- =====================================================================

-- 1) Revogar sessões duplicadas: para cada combinação (user_id, browser, os, device_type)
--    manter apenas a mais recente (MAX last_active_at) e revogar as demais
UPDATE user_sessions s
SET revoked_at = NOW()
WHERE revoked_at IS NULL
  AND browser IS NOT NULL
  AND os IS NOT NULL
  AND id NOT IN (
    -- Sub-select: pega o id da sessão mais recente de cada grupo
    SELECT DISTINCT ON (user_id, browser, os, device_type) id
    FROM user_sessions
    WHERE revoked_at IS NULL
      AND browser IS NOT NULL
      AND os IS NOT NULL
    ORDER BY user_id, browser, os, device_type, last_active_at DESC
  );

-- 2) Revogar sessões expiradas que nunca foram revogadas
UPDATE user_sessions
SET revoked_at = NOW()
WHERE revoked_at IS NULL
  AND expires_at < NOW();

-- 3) Índice parcial para acelerar lookup de deduplicação no backend
CREATE INDEX IF NOT EXISTS idx_user_sessions_dedup
  ON user_sessions(user_id, browser, os, device_type)
  WHERE revoked_at IS NULL AND browser IS NOT NULL AND os IS NOT NULL;
