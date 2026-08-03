-- ============================================================================
-- ADM-070: Persistent IP Blacklist
-- Substitui blacklist.json (in-memory/file) por tabela Supabase.
-- Sobrevive a restarts do Fly.io (deploy, scale, health check).
-- ============================================================================

-- ── Tabela: ip_blacklist ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ip_blacklist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address  TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL DEFAULT 'ip'
              CHECK (type IN ('ip', 'ja3', 'user', 'token')),
  reason      TEXT,
  blocked_by  TEXT NOT NULL DEFAULT 'system',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ  -- NULL = permanente
);

COMMENT ON TABLE public.ip_blacklist IS
  'Blacklist persistente de IPs, JA3 hashes, users e tokens. Substitui blacklist.json in-memory.';

COMMENT ON COLUMN public.ip_blacklist.expires_at IS
  'NULL = bloqueio permanente. Se definido, bloqueio expira automaticamente.';

-- ── Índices ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ip_blacklist_ip_address
  ON public.ip_blacklist(ip_address);

CREATE INDEX IF NOT EXISTS idx_ip_blacklist_expires
  ON public.ip_blacklist(expires_at)
  WHERE expires_at IS NOT NULL;

-- ── RLS: admin-only (mesma pattern de user_suspensions) ──────────────────────
ALTER TABLE public.ip_blacklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_access_ip_blacklist"
  ON public.ip_blacklist
  FOR ALL
  USING (public.check_global_role(auth.uid()::text, 'admin'))
  WITH CHECK (public.check_global_role(auth.uid()::text, 'admin'));

-- ── Migrar dados existentes do blacklist.json (se houver) ────────────────────
-- Nota: a migração de dados será feita pelo backend no primeiro boot.
-- O backend lê blacklist.json (se existir) e insere no Supabase, depois pode deletar o arquivo.
