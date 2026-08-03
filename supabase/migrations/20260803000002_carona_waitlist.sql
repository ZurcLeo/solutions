-- =====================================================
-- MIGRACAO: Carona Waitlist (CARONA-GAP-005)
-- Notifica passageiros quando vaga abrir em carona lotada
--
-- Tabela:
--   carona_waitlist — fila de espera por viagem
--
-- Agente: claudia-agent | Revisado por: Leo (PO)
-- Data: 2026-08-03
-- =====================================================

CREATE TABLE IF NOT EXISTS public.carona_waitlist (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ride_id     TEXT NOT NULL REFERENCES public.carona_rides(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ,
  UNIQUE(ride_id, user_id)
);

COMMENT ON TABLE public.carona_waitlist IS
    '[CARONA-GAP-005] Fila de espera para caronas lotadas. '
    'Passageiro entra na lista quando ride.status=full. '
    'Quando vaga abre (cancelSeat), notified_at e preenchido e usuario recebe push/socket.';

-- Indices
CREATE INDEX IF NOT EXISTS idx_carona_waitlist_ride
    ON public.carona_waitlist (ride_id);

CREATE INDEX IF NOT EXISTS idx_carona_waitlist_user
    ON public.carona_waitlist (user_id);

-- RLS
ALTER TABLE public.carona_waitlist ENABLE ROW LEVEL SECURITY;

-- Usuarios veem suas proprias entradas
DROP POLICY IF EXISTS "carona_waitlist_select_own" ON public.carona_waitlist;
CREATE POLICY "carona_waitlist_select_own"
    ON public.carona_waitlist FOR SELECT TO authenticated
    USING (user_id = auth.uid()::text);

-- Usuarios inserem suas proprias entradas
DROP POLICY IF EXISTS "carona_waitlist_insert_own" ON public.carona_waitlist;
CREATE POLICY "carona_waitlist_insert_own"
    ON public.carona_waitlist FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid()::text);

-- Usuarios removem suas proprias entradas
DROP POLICY IF EXISTS "carona_waitlist_delete_own" ON public.carona_waitlist;
CREATE POLICY "carona_waitlist_delete_own"
    ON public.carona_waitlist FOR DELETE TO authenticated
    USING (user_id = auth.uid()::text);

-- Admin ve tudo
DROP POLICY IF EXISTS "carona_waitlist_admin_all" ON public.carona_waitlist;
CREATE POLICY "carona_waitlist_admin_all"
    ON public.carona_waitlist FOR ALL TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

-- Revogar acesso anon
REVOKE ALL ON public.carona_waitlist FROM anon;


-- =====================================================
-- BLOCO DE VERIFICACAO POS-MIGRACAO
-- Execute no Supabase SQL Editor apos aplicar.
-- =====================================================

-- V1. Tabela criada:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name = 'carona_waitlist';

-- V2. RLS habilitado:
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public' AND tablename = 'carona_waitlist';

-- V3. Indices:
-- SELECT indexname FROM pg_indexes
-- WHERE indexname LIKE 'idx_carona_waitlist%';
-- Esperado: 2 indices.
