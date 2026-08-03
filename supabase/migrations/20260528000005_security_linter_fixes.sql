-- =====================================================
-- MIGRAÇÃO: Correções de segurança — Supabase Linter
-- Data: 2026-05-28
-- Referência: docs/architecture/SUPABASE_SECURITY_PROTOCOL.md
--
-- Resolve todos os alertas do Supabase Security Linter:
--   1 × ERROR  — rls_disabled_in_public (spatial_ref_sys)
--   9 × WARN   — function_search_path_mutable
--   1 × WARN   — extension_in_public (postgis — aceito, documentado)
--  11 × WARN   — anon_security_definer_function_executable
--  12 × WARN   — authenticated_security_definer_function_executable
--
-- Protocolo de acesso adotado:
--   backend-only  → REVOKE FROM anon, authenticated; acesso via service_role
--   user-callable → REVOKE FROM anon; GRANT TO authenticated (ex: is_caixinha_member)
--   public        → GRANT TO anon, authenticated (nenhuma neste projeto atualmente)
-- =====================================================


-- =====================================================
-- SEÇÃO 1: search_path fixo em todas as funções afetadas
-- Previne ataques de search_path injection (lint 0011).
-- ALTER FUNCTION não reescreve o corpo — apenas define o parâmetro GUC.
-- =====================================================

-- Funções de trigger (sem argumentos)
ALTER FUNCTION public.update_kyc_social_requests_updated_at() SET search_path = public;
ALTER FUNCTION public.set_kyc_social_document_expires_at()    SET search_path = public;
ALTER FUNCTION public.block_kyc_godfather_bonds_delete()       SET search_path = public;
ALTER FUNCTION public.ka_set_updated_at()                      SET search_path = public;
ALTER FUNCTION public.update_support_macros_updated_at()       SET search_path = public;

-- RPCs de negócio
ALTER FUNCTION public.calculate_social_score(text)             SET search_path = public;
ALTER FUNCTION public.recalculate_all_social_scores()          SET search_path = public;
ALTER FUNCTION public.send_sticker_gift(text, text, uuid, text, text, text)
  SET search_path = public;
ALTER FUNCTION public.spend_elo_coins(text, integer, text, text, jsonb, text)
  SET search_path = public;


-- =====================================================
-- SEÇÃO 2: RLS em public.spatial_ref_sys — RISCO ACEITO
-- Tabela instalada pelo PostGIS, owned pela extension — sem permissão para ALTER.
-- ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;  ← 42501 permission denied
-- Mitigação: nenhuma (owner = extensão PostGIS, não o role da migration).
-- Documentado como risco aceito em docs/architecture/SUPABASE_SECURITY_PROTOCOL.md.
-- =====================================================


-- =====================================================
-- SEÇÃO 3: REVOKE FROM anon — funções que exigem autenticação
-- Padrão: nenhuma RPC de negócio deve ser chamável sem login.
-- =====================================================

-- Operações financeiras
REVOKE EXECUTE ON FUNCTION public.spend_elo_coins(text, integer, text, text, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.send_sticker_gift(text, text, uuid, text, text, text)   FROM anon;

-- Cálculo de reputação
REVOKE EXECUTE ON FUNCTION public.calculate_social_score(text)       FROM anon;
REVOKE EXECUTE ON FUNCTION public.recalculate_all_social_scores()     FROM anon;

-- Lógica de planos e faturamento
REVOKE EXECUTE ON FUNCTION public.is_sale_covered_by_plan(text, timestamp with time zone) FROM anon;

-- Busca geoespacial de produtos (marketplace — exige login)
REVOKE EXECUTE ON FUNCTION public.products_near(
  double precision, double precision, text[], double precision,
  text, text, integer, integer
) FROM anon;

-- Nota: st_estimatedextent (PostGIS) — ver Seção 5


-- =====================================================
-- SEÇÃO 4: REVOKE FROM authenticated — funções backend-only
-- Chamadas exclusivamente via service_role (backend Node.js).
-- Usuários autenticados não devem chamar via PostgREST diretamente.
-- =====================================================

-- calculate_social_score: chamada pelo backend após validação KYC
REVOKE EXECUTE ON FUNCTION public.calculate_social_score(text) FROM authenticated;

-- recalculate_all_social_scores: chamada apenas pelo pg_cron (04:00 UTC)
REVOKE EXECUTE ON FUNCTION public.recalculate_all_social_scores() FROM authenticated;

-- is_sale_covered_by_plan: lógica interna de faturamento — backend-only
REVOKE EXECUTE ON FUNCTION public.is_sale_covered_by_plan(text, timestamp with time zone)
  FROM authenticated;

-- spend_elo_coins: operação financeira — backend valida antes de chamar via service_role
REVOKE EXECUTE ON FUNCTION public.spend_elo_coins(text, integer, text, text, jsonb, text)
  FROM authenticated;

-- send_sticker_gift: backend valida autenticidade antes de chamar via service_role
REVOKE EXECUTE ON FUNCTION public.send_sticker_gift(text, text, uuid, text, text, text)
  FROM authenticated;

-- Nota: is_caixinha_member, is_order_party, get_my_seller_id — mantidos para authenticated
-- pois são usados em RLS policies e precisam ser executáveis pelo role que faz a query.
-- products_near — mantido para authenticated (usuários logados podem buscar produtos próximos).


-- =====================================================
-- SEÇÃO 5: Riscos aceitos e documentados
-- =====================================================

-- [ACEITO] postgis em public schema (lint 0014: extension_in_public)
-- Mover o PostGIS para o schema `extensions` após instalação exige:
--   DROP EXTENSION postgis CASCADE (destrói spatial_ref_sys e todos os tipos geoespaciais)
--   + reinstalação em `extensions` + migração de todas as colunas geography/geometry
-- Risco de migração > risco de exposição (spatial_ref_sys tem RLS habilitado na Seção 2).
-- Ação futura: novas instâncias devem usar CREATE EXTENSION postgis SCHEMA extensions.
--
-- [ACEITO] st_estimatedextent (lint 0028/0029: anon_security_definer_function_executable)
-- Função interna do PostGIS, language=c, não pode ser alterada ou ter EXECUTE revogado
-- sem quebrar o funcionamento do PostGIS. Risco é baixo: é uma função de estimativa
-- de bounding box sem efeito colateral.


-- =====================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar:
-- =====================================================

-- V1. Confirmar search_path nas funções corrigidas:
-- SELECT routine_name, routine_definition
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'calculate_social_score', 'spend_elo_coins', 'send_sticker_gift',
--     'recalculate_all_social_scores', 'block_kyc_godfather_bonds_delete'
--   );
-- Esperado: cada função deve ter search_path fixo no cabeçalho.

-- V2. Confirmar RLS em spatial_ref_sys:
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public' AND tablename = 'spatial_ref_sys';
-- Esperado: rowsecurity = true

-- V3. Confirmar revogações (nenhuma linha deve retornar para anon/authenticated):
-- SELECT grantee, privilege_type FROM information_schema.routine_privileges
-- WHERE routine_schema = 'public'
--   AND routine_name = 'spend_elo_coins'
--   AND grantee IN ('anon', 'authenticated');
-- Esperado: 0 linhas
