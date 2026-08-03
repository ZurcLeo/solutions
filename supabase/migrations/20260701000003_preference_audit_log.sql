-- PREFS-005: Preference audit log (LGPD Art. 18 — Transparência)
-- Registra todas as alterações de preferências do usuário para auditoria e transparência.

-- ─── Tabela principal ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.preference_audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category    TEXT        NOT NULL CHECK (category IN ('cookie_prefs', 'privacy_prefs', 'notification_prefs')),
  field_path  TEXT        NOT NULL,         -- ex: 'cookie_prefs.analytics', 'notification_prefs.events.payments.email'
  old_value   JSONB,                        -- valor anterior (null se primeira definição)
  new_value   JSONB       NOT NULL,         -- novo valor
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address  TEXT                          -- IP do request (LGPD: dado pessoal, mas necessário para auditoria)
);

-- ─── Índices ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pref_audit_user_id   ON public.preference_audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_pref_audit_changed   ON public.preference_audit_log (changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pref_audit_category  ON public.preference_audit_log (user_id, category);

-- ─── RLS: usuários só podem ler seus próprios logs ──────────────────────────
ALTER TABLE public.preference_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY preference_audit_log_select_own ON public.preference_audit_log
  FOR SELECT
  USING (user_id = auth.uid()::text);

-- Service role (backend) pode inserir livremente
CREATE POLICY preference_audit_log_insert_service ON public.preference_audit_log
  FOR INSERT
  WITH CHECK (true);

-- ─── Comentários ─────────────────────────────────────────────────────────────
COMMENT ON TABLE  public.preference_audit_log IS 'PREFS-005: Audit trail de alterações de preferências do usuário (LGPD Art. 18)';
COMMENT ON COLUMN public.preference_audit_log.field_path  IS 'Caminho pontilhado do campo alterado, ex: cookie_prefs.analytics';
COMMENT ON COLUMN public.preference_audit_log.old_value   IS 'Valor anterior como JSONB (null se primeira definição)';
COMMENT ON COLUMN public.preference_audit_log.new_value   IS 'Novo valor como JSONB';
COMMENT ON COLUMN public.preference_audit_log.ip_address  IS 'IP do request para fins de auditoria LGPD';
