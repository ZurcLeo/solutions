-- =====================================================
-- MIGRAÇÃO: Security Hotfix — funções pós-20260528000005
-- Data: 2026-05-31
--
-- Contexto:
--   A migration 20260528000005_security_linter_fixes.sql corrigiu os alertas
--   do Supabase Linter até 2026-05-28. Desde então, novas migrações criaram
--   ou recriaram funções sem aplicar os mesmos controles de segurança:
--
--   • 20260530000001_user_preferences.sql
--       → criou update_user_preferences_updated_at() e enforce_immutable_preference_fields()
--         sem SET search_path
--   • 20260531000005_atomic_saldo_rpc.sql
--       → criou update_caixinha_saldo() sem SET search_path
--         (já tem REVOKE ALL FROM PUBLIC + GRANT TO service_role)
--   • 20260531000006_streak_freeze.sql
--       → criou grant_streak_freeze() sem SET search_path nem REVOKE
--       → fez DROP + CREATE OR REPLACE em update_daily_streak() →
--         permissões REVOKE aplicadas em 20260528000005 foram resetadas
--
-- Além disso, update_updated_at_column() (trigger genérico, definido em
-- migrations antigas) nunca teve search_path fixado.
--
-- Protocolo adotado (consistente com 20260528000005):
--   backend-only   → REVOKE ALL FROM PUBLIC; GRANT TO service_role
--   user-callable  → REVOKE FROM anon; GRANT/mantém para authenticated
--   aceito         → documentado sem correção técnica possível
-- =====================================================


-- =====================================================
-- SEÇÃO 1: search_path fixo — previne search_path injection (lint 0011)
-- ALTER FUNCTION apenas define o parâmetro GUC; não altera corpo nem grants.
-- =====================================================

-- Funções de trigger (user_preferences — 20260530000001)
ALTER FUNCTION public.update_user_preferences_updated_at() SET search_path = public;
ALTER FUNCTION public.enforce_immutable_preference_fields() SET search_path = public;

-- Trigger genérico reutilizado em múltiplas tabelas
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;

-- RPC atômica de saldo (20260531000005) — já tem REVOKE, faltava search_path
ALTER FUNCTION public.update_caixinha_saldo(text, numeric, numeric) SET search_path = public;

-- RPCs de gamificação (20260531000006) — novas / recriadas
ALTER FUNCTION public.grant_streak_freeze(text, integer) SET search_path = public;
ALTER FUNCTION public.update_daily_streak(text)          SET search_path = public;


-- =====================================================
-- SEÇÃO 2: Permissões para novas funções backend-only
-- grant_streak_freeze: nova função sem REVOKE prévio.
-- update_daily_streak: DROP + CREATE em 20260531000006 resetou as permissões;
--   re-aplica o padrão estabelecido em 20260528000005.
-- =====================================================

-- grant_streak_freeze — chamada exclusivamente por gamificationService via service_role
REVOKE ALL ON FUNCTION public.grant_streak_freeze(text, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.grant_streak_freeze(text, integer) TO service_role;

-- update_daily_streak — chamada exclusivamente por gamificationService via service_role
REVOKE ALL ON FUNCTION public.update_daily_streak(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.update_daily_streak(text) TO service_role;


-- =====================================================
-- SEÇÃO 3: Re-confirmação de revokes críticos (idempotente)
-- Garante que futuras CREATE OR REPLACE não reabram acessos fixados em
-- 20260528000005. REVOKE é sem-efeito se o grant já não existir.
-- =====================================================

-- calculate_social_score: backend-only (KYC service via service_role)
REVOKE EXECUTE ON FUNCTION public.calculate_social_score(text)
    FROM anon, authenticated;

-- recalculate_all_social_scores: pg_cron 04:00 UTC via service_role
REVOKE EXECUTE ON FUNCTION public.recalculate_all_social_scores()
    FROM anon, authenticated;

-- spend_elo_coins: operação financeira — backend valida antes de chamar
REVOKE EXECUTE ON FUNCTION public.spend_elo_coins(text, integer, text, text, jsonb, text)
    FROM anon, authenticated;

-- send_sticker_gift: backend valida autenticidade e idempotência
REVOKE EXECUTE ON FUNCTION public.send_sticker_gift(text, text, uuid, text, text, text)
    FROM anon, authenticated;

-- products_near: requer login (usuários anônimos não têm feed de produtos próximos)
-- authenticated mantido: usuários logados podem buscar produtos próximos via PostgREST
REVOKE EXECUTE ON FUNCTION public.products_near(
    double precision, double precision, text[], double precision,
    text, text, integer, integer
) FROM anon;


-- =====================================================
-- SEÇÃO 4: Riscos aceitos e documentados (sem alteração técnica)
-- =====================================================

-- [ACEITO] spatial_ref_sys: RLS não pode ser habilitado — owned pela extensão PostGIS.
--   ALTER TABLE emitirá 42501 (permission denied). Documentado como risco aceito.
--   Mitigação: tabela é de referência (read-only), sem PII nem dados financeiros.

-- [ACEITO] postgis em public schema (lint 0014):
--   Mover exige DROP EXTENSION CASCADE + migração de todas as colunas geography/geometry.
--   Risco de migração > risco de exposição.

-- [ACEITO] st_estimatedextent (lint 0028/0029):
--   Função interna PostGIS, language=c, não pode ter search_path nem EXECUTE revogado.
--   Sem efeito colateral; é uma função de estimativa de bounding box.

-- [ACEITO] get_my_seller_id, is_caixinha_member, is_order_party (lint 0029):
--   São helpers chamados dentro de policies RLS. O role `authenticated` precisa de
--   EXECUTE para que as policies funcionem em queries de usuários logados.
--   Revogar de `authenticated` quebraria todas as queries nas tabelas dependentes.

-- [ACEITO] products_near para `authenticated` (lint 0029):
--   Feature intencional — usuários logados buscam produtos próximos via PostgREST.


-- =====================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar:
-- =====================================================

-- V1. Confirmar search_path nas 6 funções corrigidas:
-- SELECT proname, proconfig
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND proname IN (
--     'update_user_preferences_updated_at', 'enforce_immutable_preference_fields',
--     'update_updated_at_column', 'update_caixinha_saldo',
--     'grant_streak_freeze', 'update_daily_streak'
--   )
-- ORDER BY proname;
-- Esperado: 6 linhas com proconfig contendo 'search_path=public'.

-- V2. Confirmar que grant_streak_freeze e update_daily_streak são service_role-only:
-- SELECT routine_name, grantee, privilege_type
-- FROM information_schema.role_routine_grants
-- WHERE routine_schema = 'public'
--   AND routine_name IN ('grant_streak_freeze', 'update_daily_streak')
--   AND grantee IN ('anon', 'public', 'authenticated');
-- Esperado: 0 linhas.

-- V3. Confirmar revokes em spend_elo_coins e send_sticker_gift:
-- SELECT routine_name, grantee, privilege_type
-- FROM information_schema.role_routine_grants
-- WHERE routine_schema = 'public'
--   AND routine_name IN ('spend_elo_coins', 'send_sticker_gift',
--                        'calculate_social_score', 'recalculate_all_social_scores')
--   AND grantee IN ('anon', 'authenticated');
-- Esperado: 0 linhas.
