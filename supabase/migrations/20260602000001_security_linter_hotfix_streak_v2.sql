-- =====================================================
-- MIGRAÇÃO: Security Hotfix — update_daily_streak SECURITY INVOKER v2
-- Data: 2026-06-02
--
-- Causa raiz:
--   A migration 20260531000011_fix_streak_ambiguous_column.sql fez
--   DROP FUNCTION + CREATE OR REPLACE com SECURITY DEFINER, resetando
--   todas as correções de segurança aplicadas em:
--     • 20260531000008_supabase_linter_security_hotfix.sql
--       → SET search_path = public; REVOKE ALL FROM PUBLIC
--     • 20260531000009_security_definer_to_invoker.sql
--       → ALTER FUNCTION ... SECURITY INVOKER
--
-- Alertas reabertos pelo reset:
--   • lint 0011 function_search_path_mutable: update_daily_streak
--   • lint 0028 anon_security_definer_function_executable: update_daily_streak
--   • lint 0029 authenticated_security_definer_function_executable: update_daily_streak
--
-- Correção:
--   Reaplicar SECURITY INVOKER + SET search_path sem alterar o corpo da função.
--   O ALTER FUNCTION não causa DROP, não há reset de perms futuras.
--
-- Riscos aceitos (mantidos das migrações anteriores, sem nova ação):
--   • spatial_ref_sys (lint 0013): tabela PostGIS owned pela extensão, ALTER TABLE
--     emite 42501 permission denied. Read-only, sem PII. Risco aceito.
--   • postgis em public (lint 0014): mover exige DROP CASCADE + reescrita de
--     todas as colunas geography/geometry. Risco de migração > risco de exposição.
--   • st_estimatedextent (lint 0028/0029): função C interna PostGIS, não alterável.
--   • get_my_seller_id, is_caixinha_member, is_order_party (lint 0029):
--     helpers de RLS — precisam de SECURITY DEFINER + EXECUTE para authenticated
--     para que as policies funcionem. Revogar quebraria todas as queries dependentes.
-- =====================================================


-- =====================================================
-- SEÇÃO 1: Converter SECURITY DEFINER → SECURITY INVOKER
-- Com INVOKER + service_role: bypassa RLS (comportamento idêntico ao anterior).
-- Com INVOKER + authenticated: UPDATE bloqueado por RLS (defesa em profundidade).
-- =====================================================

ALTER FUNCTION public.update_daily_streak(text) SECURITY INVOKER;


-- =====================================================
-- SEÇÃO 2: Fixar search_path — previne search_path injection (lint 0011)
-- ALTER FUNCTION apenas define o parâmetro GUC; não altera corpo nem grants.
-- =====================================================

ALTER FUNCTION public.update_daily_streak(text) SET search_path = public;


-- =====================================================
-- SEÇÃO 3: Revogar execute público — defense in depth
-- Mesmo com SECURITY INVOKER (que elimina os alertas lint), manter REVOKE
-- garante que o endpoint /rest/v1/rpc/update_daily_streak não é chamável
-- diretamente por clients anônimos ou autenticados via PostgREST.
-- =====================================================

REVOKE ALL ON FUNCTION public.update_daily_streak(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_daily_streak(text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.update_daily_streak(text) TO service_role;


-- =====================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar:
-- =====================================================

-- V1. Confirmar SECURITY INVOKER + search_path:
-- SELECT proname, prosecdef, proconfig
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND proname = 'update_daily_streak';
-- Esperado: prosecdef = false, proconfig contém 'search_path=public'.

-- V2. Confirmar que anon/authenticated não têm EXECUTE:
-- SELECT routine_name, grantee, privilege_type
-- FROM information_schema.role_routine_grants
-- WHERE routine_schema = 'public'
--   AND routine_name = 'update_daily_streak'
--   AND grantee IN ('anon', 'public', 'authenticated');
-- Esperado: 0 linhas.

-- V3. Confirmar que service_role ainda pode executar:
-- SELECT routine_name, grantee, privilege_type
-- FROM information_schema.role_routine_grants
-- WHERE routine_schema = 'public'
--   AND routine_name = 'update_daily_streak'
--   AND grantee = 'service_role';
-- Esperado: 1 linha com privilege_type = 'EXECUTE'.
