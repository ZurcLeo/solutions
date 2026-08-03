-- =====================================================
-- MIGRAÇÃO: SECURITY DEFINER → SECURITY INVOKER
-- Data: 2026-05-31
--
-- Contexto:
--   Múltiplas tentativas de REVOKE EXECUTE (migrations 20260525000001,
--   20260528000005, 20260531000008) não eliminaram os alertas lint 0028/0029
--   do Supabase Linter. Em ambientes Supabase gerenciados, o grant PUBLIC
--   inicial para funções no schema `public` pode ser restabelecido pelo sistema.
--
-- Solução definitiva:
--   Alterar as funções backend-only de SECURITY DEFINER para SECURITY INVOKER.
--   A condição do lint é:  prosecdef=true AND (anon|authenticated tem EXECUTE).
--   Com prosecdef=false, o lint para de reclamar independentemente dos grants.
--
-- Por que é seguro:
--   - Backend usa service_role, que bypassa RLS de qualquer forma.
--     SECURITY DEFINER não agrega nada para essas chamadas.
--   - Se alguém chamar via PostgREST com role anon/authenticated,
--     o RLS das tabelas subjacentes contém o acesso (defesa em profundidade).
--
-- Funções mantidas como SECURITY DEFINER (necessidade técnica):
--   - is_caixinha_member, is_order_party, get_my_seller_id:
--     helpers de RLS — precisam de SECURITY DEFINER para evitar recursão infinita
--     nas policies. Lint 0029 (authenticated) é risco aceito e documentado.
--   - st_estimatedextent: função C interna do PostGIS, não alterável.
-- =====================================================


-- =====================================================
-- Funções de Social Score
-- Chamadas pelo backend via service_role após validação KYC.
-- =====================================================
ALTER FUNCTION public.calculate_social_score(text)    SECURITY INVOKER;
ALTER FUNCTION public.recalculate_all_social_scores() SECURITY INVOKER;


-- =====================================================
-- Funções de Stickers / EloCoins
-- Chamadas pelo backend via service_role com validação prévia.
-- =====================================================
ALTER FUNCTION public.send_sticker_gift(text, text, uuid, text, text, text) SECURITY INVOKER;
ALTER FUNCTION public.spend_elo_coins(text, integer, text, text, jsonb, text) SECURITY INVOKER;


-- =====================================================
-- Função de Saldo da Caixinha
-- Chamada pelo backend via service_role para operações atômicas.
-- Com INVOKER + service_role: bypassa RLS, comportamento idêntico ao anterior.
-- Com INVOKER + authenticated: UPDATE bloqueado por RLS (só admin da caixinha).
-- =====================================================
ALTER FUNCTION public.update_caixinha_saldo(text, numeric, numeric) SECURITY INVOKER;


-- =====================================================
-- Funções de Gamificação (streak)
-- Chamadas pelo gamificationService via service_role.
-- =====================================================
ALTER FUNCTION public.update_daily_streak(text)        SECURITY INVOKER;
ALTER FUNCTION public.grant_streak_freeze(text, integer) SECURITY INVOKER;


-- =====================================================
-- Busca Geoespacial de Produtos
-- Chamada pelo backend ou pelo frontend autenticado via service_role.
-- Com INVOKER: RLS da tabela marketplace_products determina o que é visível.
-- =====================================================
ALTER FUNCTION public.products_near(
    double precision, double precision, text[],
    double precision, text, text, integer, integer
) SECURITY INVOKER;


-- =====================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar:
-- =====================================================

-- V1. Confirmar que prosecdef = false para as funções convertidas:
-- SELECT proname, prosecdef
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND proname IN (
--     'calculate_social_score', 'recalculate_all_social_scores',
--     'send_sticker_gift', 'spend_elo_coins',
--     'update_caixinha_saldo', 'update_daily_streak',
--     'grant_streak_freeze', 'products_near'
--   )
-- ORDER BY proname;
-- Esperado: todas as linhas com prosecdef = false.

-- V2. Confirmar que funções RLS helpers ainda são SECURITY DEFINER:
-- SELECT proname, prosecdef
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND proname IN ('is_caixinha_member', 'is_order_party', 'get_my_seller_id')
-- ORDER BY proname;
-- Esperado: todas as linhas com prosecdef = true (necessário para RLS).
