-- =====================================================
-- MIGRACAO: Emergency Contacts + SOS Events (CARONA-GAP-006)
-- Botao de panico e contatos de emergencia para carona
--
-- Tabelas:
--   1. user_emergency_contacts — ate 3 contatos por usuario
--   2. carona_sos_events       — log de acionamentos SOS
--
-- Agente: claudia-agent | Revisado por: Leo (PO)
-- Data: 2026-08-03
-- =====================================================


-- =====================================================
-- 1. user_emergency_contacts
--    Contatos de emergencia do usuario (max 3)
--    Usados pelo botao SOS em viagens de carona
-- =====================================================

CREATE TABLE IF NOT EXISTS public.user_emergency_contacts (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,
  relationship    TEXT,  -- ex: 'mae', 'pai', 'conjuge', 'amigo'
  is_primary      BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.user_emergency_contacts IS
    '[CARONA-GAP-006] Contatos de emergencia do usuario. '
    'Maximo de 3 por usuario (enforced no backend). '
    'Apenas um contato pode ser is_primary=true por usuario (UNIQUE parcial). '
    'Acionados pelo botao SOS durante viagens de carona.';

-- Indice principal
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user
    ON public.user_emergency_contacts (user_id);

-- Apenas um contato primario por usuario
CREATE UNIQUE INDEX IF NOT EXISTS idx_emergency_contacts_primary
    ON public.user_emergency_contacts (user_id) WHERE is_primary = true;

-- Trigger updated_at
CREATE TRIGGER trg_emergency_contacts_updated_at
    BEFORE UPDATE ON public.user_emergency_contacts
    FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- RLS
ALTER TABLE public.user_emergency_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "emergency_select_own" ON public.user_emergency_contacts;
CREATE POLICY "emergency_select_own"
    ON public.user_emergency_contacts FOR SELECT TO authenticated
    USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "emergency_insert_own" ON public.user_emergency_contacts;
CREATE POLICY "emergency_insert_own"
    ON public.user_emergency_contacts FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "emergency_update_own" ON public.user_emergency_contacts;
CREATE POLICY "emergency_update_own"
    ON public.user_emergency_contacts FOR UPDATE TO authenticated
    USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "emergency_delete_own" ON public.user_emergency_contacts;
CREATE POLICY "emergency_delete_own"
    ON public.user_emergency_contacts FOR DELETE TO authenticated
    USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "emergency_service" ON public.user_emergency_contacts;
CREATE POLICY "emergency_service"
    ON public.user_emergency_contacts FOR ALL TO service_role
    USING (true);


-- =====================================================
-- 2. carona_sos_events
--    Log imutavel de acionamentos SOS (audit trail)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.carona_sos_events (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ride_id             TEXT NOT NULL REFERENCES public.carona_rides(id) ON DELETE CASCADE,
  user_id             TEXT NOT NULL REFERENCES public.users(id),
  lat                 DOUBLE PRECISION,
  lng                 DOUBLE PRECISION,
  contacts_notified   JSONB DEFAULT '[]',  -- [{name, phone, notified_at}]
  resolved_at         TIMESTAMPTZ,
  resolution          TEXT CHECK (resolution IS NULL OR resolution IN ('false_alarm', 'resolved', 'escalated')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.carona_sos_events IS
    '[CARONA-GAP-006] Log imutavel de acionamentos SOS em viagens de carona. '
    'Append-only para compliance/auditoria. '
    'contacts_notified registra quais contatos foram alertados. '
    'resolution preenchido por admin ao resolver o incidente.';

-- Indices
CREATE INDEX IF NOT EXISTS idx_sos_events_ride
    ON public.carona_sos_events (ride_id);

CREATE INDEX IF NOT EXISTS idx_sos_events_user
    ON public.carona_sos_events (user_id);

-- RLS
ALTER TABLE public.carona_sos_events ENABLE ROW LEVEL SECURITY;

-- Usuario ve seus proprios SOS
DROP POLICY IF EXISTS "sos_select_own" ON public.carona_sos_events;
CREATE POLICY "sos_select_own"
    ON public.carona_sos_events FOR SELECT TO authenticated
    USING (user_id = auth.uid()::text);

-- Usuario pode criar SOS
DROP POLICY IF EXISTS "sos_insert_own" ON public.carona_sos_events;
CREATE POLICY "sos_insert_own"
    ON public.carona_sos_events FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid()::text);

-- Admin ve tudo + pode atualizar resolution
DROP POLICY IF EXISTS "sos_admin_all" ON public.carona_sos_events;
CREATE POLICY "sos_admin_all"
    ON public.carona_sos_events FOR ALL TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

-- Service role (backend)
DROP POLICY IF EXISTS "sos_service" ON public.carona_sos_events;
CREATE POLICY "sos_service"
    ON public.carona_sos_events FOR ALL TO service_role
    USING (true);

-- Sem update/delete para usuarios comuns (imutavel)
DROP POLICY IF EXISTS "sos_no_update" ON public.carona_sos_events;
CREATE POLICY "sos_no_update"
    ON public.carona_sos_events FOR UPDATE TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

DROP POLICY IF EXISTS "sos_no_delete" ON public.carona_sos_events;
CREATE POLICY "sos_no_delete"
    ON public.carona_sos_events FOR DELETE TO authenticated
    USING (false);

-- Revogar acesso anon
REVOKE ALL ON public.user_emergency_contacts FROM anon;
REVOKE ALL ON public.carona_sos_events FROM anon;


-- =====================================================
-- BLOCO DE VERIFICACAO POS-MIGRACAO
-- Execute no Supabase SQL Editor apos aplicar.
-- =====================================================

-- V1. Tabelas criadas:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('user_emergency_contacts', 'carona_sos_events');
-- Esperado: 2 tabelas.

-- V2. RLS habilitado:
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('user_emergency_contacts', 'carona_sos_events');
-- Esperado: rowsecurity = true para ambas.

-- V3. Indices:
-- SELECT indexname FROM pg_indexes
-- WHERE indexname LIKE 'idx_emergency%' OR indexname LIKE 'idx_sos%';
-- Esperado: 4 indices.
