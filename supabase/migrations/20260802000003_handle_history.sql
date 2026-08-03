-- [HANDLE-005] Historico de handles + quarentena 90 dias

CREATE TABLE IF NOT EXISTS handle_history (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  handle       TEXT NOT NULL,
  owner_type   TEXT NOT NULL CHECK (owner_type IN ('user', 'seller')),
  owner_id     TEXT NOT NULL,
  released_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quarantine_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by handle
CREATE INDEX IF NOT EXISTS idx_handle_history_handle ON handle_history (handle);

-- Index for quarantine lookups (sem filtro parcial — NOW() nao e IMMUTABLE)
CREATE INDEX IF NOT EXISTS idx_handle_history_quarantine ON handle_history (quarantine_until);

-- RLS: admin read-all, users can read own history
ALTER TABLE handle_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY handle_history_admin_all ON handle_history
  FOR ALL TO authenticated
  USING (
    check_global_role(auth.uid()::text, 'admin')
    OR check_global_role(auth.uid()::text, 'adm-master')
  );

CREATE POLICY handle_history_user_read_own ON handle_history
  FOR SELECT TO authenticated
  USING (owner_type = 'user' AND owner_id = auth.uid()::text);
