-- ============================================================================
-- ADMIN-3: Sistema de Suspensão de Usuários e Negócios
-- Bloqueio real com auditoria, duração configurável e auto-expiração.
-- ============================================================================

-- ── Tabela principal: suspensões de usuários ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_suspensions (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id       TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL CHECK (char_length(reason) >= 5),
  category      TEXT NOT NULL DEFAULT 'other'
                CHECK (category IN (
                  'fake_news', 'hate_speech', 'spam', 'fraud',
                  'harassment', 'terms_violation', 'other'
                )),
  suspended_by  TEXT NOT NULL REFERENCES public.users(id),
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'lifted', 'expired')),
  -- Duração: NULL = permanente
  duration_days INTEGER CHECK (duration_days IS NULL OR duration_days > 0),
  expires_at    TIMESTAMPTZ,
  lifted_at     TIMESTAMPTZ,
  lifted_by     TEXT REFERENCES public.users(id),
  lift_reason   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para queries frequentes
CREATE INDEX IF NOT EXISTS idx_user_suspensions_user_active
  ON public.user_suspensions(user_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_user_suspensions_expires
  ON public.user_suspensions(expires_at) WHERE status = 'active' AND expires_at IS NOT NULL;

-- Trigger updated_at
CREATE OR REPLACE TRIGGER trg_user_suspensions_updated_at
  BEFORE UPDATE ON public.user_suspensions
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- ── RPC: Verificar se um usuário está suspenso ──────────────────────────────
CREATE OR REPLACE FUNCTION public.is_user_suspended(p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_suspensions
    WHERE user_id = p_user_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;

COMMENT ON FUNCTION public.is_user_suspended IS
  'Retorna TRUE se o usuário possui ao menos uma suspensão ativa (não expirada).';

-- ── RPC: Buscar suspensão ativa de um usuário ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_active_suspension(p_user_id TEXT)
RETURNS TABLE (
  id TEXT,
  reason TEXT,
  category TEXT,
  suspended_by TEXT,
  duration_days INTEGER,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT s.id, s.reason, s.category, s.suspended_by,
         s.duration_days, s.expires_at, s.created_at
  FROM public.user_suspensions s
  WHERE s.user_id = p_user_id
    AND s.status = 'active'
    AND (s.expires_at IS NULL OR s.expires_at > now())
  ORDER BY s.created_at DESC
  LIMIT 1;
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_suspensions ENABLE ROW LEVEL SECURITY;

-- Admin vê tudo
CREATE POLICY "admin_full_access_suspensions"
  ON public.user_suspensions
  FOR ALL
  USING (public.check_global_role(auth.uid()::text, 'admin'))
  WITH CHECK (public.check_global_role(auth.uid()::text, 'admin'));

-- Usuário vê suas próprias suspensões (somente leitura)
CREATE POLICY "user_read_own_suspensions"
  ON public.user_suspensions
  FOR SELECT
  USING (user_id = auth.uid()::text);

-- ── Coluna is_suspended em users (cache para queries rápidas) ───────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.is_suspended IS
  'Cache de suspensão ativa. Atualizado por trigger ao criar/levantar/expirar suspensão.';

CREATE INDEX IF NOT EXISTS idx_users_is_suspended
  ON public.users(id) WHERE is_suspended = true;

-- ── Trigger: sincronizar is_suspended no users ──────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_user_suspension_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.users
  SET is_suspended = public.is_user_suspended(
    COALESCE(NEW.user_id, OLD.user_id)
  )
  WHERE id = COALESCE(NEW.user_id, OLD.user_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE TRIGGER trg_sync_suspension_flag
  AFTER INSERT OR UPDATE OF status ON public.user_suspensions
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_suspension_flag();

-- ── Tabela de log de suspensões de sellers ───────────────────────────────────
-- seller_profiles já tem status com valor 'suspended'. Vamos criar log.
CREATE TABLE IF NOT EXISTS public.seller_suspension_log (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seller_id     TEXT NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  action        TEXT NOT NULL CHECK (action IN ('suspended', 'reactivated')),
  reason        TEXT NOT NULL CHECK (char_length(reason) >= 5),
  performed_by  TEXT NOT NULL REFERENCES public.users(id),
  previous_status TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seller_suspension_log_seller
  ON public.seller_suspension_log(seller_id);

ALTER TABLE public.seller_suspension_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_access_seller_suspension_log"
  ON public.seller_suspension_log
  FOR ALL
  USING (public.check_global_role(auth.uid()::text, 'admin'))
  WITH CHECK (public.check_global_role(auth.uid()::text, 'admin'));

-- ── Audit: registrar suspensões na tabela de audit_log ──────────────────────
COMMENT ON TABLE public.user_suspensions IS
  'Registro de suspensões de conta de usuário. Permanentes ou temporárias com auto-expiração.';

COMMENT ON TABLE public.seller_suspension_log IS
  'Log de auditoria de suspensões/reativações de sellers por admin.';
