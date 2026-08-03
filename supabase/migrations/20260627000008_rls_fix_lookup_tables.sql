-- =============================================================================
-- FIX: Habilitar RLS em trust_levels (lookup exposta ao PostgREST)
--
-- trust_levels: 5 níveis de confiança do Trust Passport — somente leitura.
-- Escrita permanece possível via service_role / migrations.
--
-- NOTA: spatial_ref_sys (PostGIS) requer owner supabase_admin —
--       aplicar manualmente via Dashboard SQL Editor (ver comentário no final).
-- =============================================================================

-- ── trust_levels ─────────────────────────────────────────────────────────────
ALTER TABLE public.trust_levels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trust_levels_select ON public.trust_levels;
CREATE POLICY trust_levels_select
  ON public.trust_levels
  FOR SELECT
  USING (true);

-- ── spatial_ref_sys (PostGIS) ────────────────────────────────────────────────
-- Executar MANUALMENTE no Supabase Dashboard → SQL Editor (roda como postgres):
--
--   ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY spatial_ref_sys_select
--     ON public.spatial_ref_sys FOR SELECT USING (true);
