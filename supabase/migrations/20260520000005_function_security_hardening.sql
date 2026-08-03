-- =====================================================
-- MIGRAÇÃO: Security Hardening — Funções PostgreSQL
-- Descrição: Corrige duas classes de vulnerabilidades em
--            todas as funções do schema public:
--
--  [A] search_path mutable (27 funções)
--      Sem SET search_path, uma função SECURITY DEFINER
--      pode ser explorada via search_path injection:
--      um atacante cria objetos em schemas que ficam na
--      frente de 'public' no search_path da sessão,
--      fazendo a função chamar tabelas maliciosas.
--      Fix: ALTER FUNCTION ... SET search_path = public
--
--  [B] SECURITY DEFINER callable by anon/authenticated (11 funções)
--      Funções financeiras e de RBAC estão acessíveis
--      via PostgREST sem autenticação (/rest/v1/rpc/*).
--      Ex: credit_wallet pode creditar qualquer carteira
--      sem nenhum token. Isso é crítico.
--      Fix: REVOKE EXECUTE FROM anon, authenticated
--      O backend usa service_role (bypass RLS/grants) →
--      nenhum impacto nas operações do servidor.
--
-- Autor: infra-agent (delegado por ClaudIA)
-- Data: 2026-05-20
-- Refs: WARN lint=0011 (search_path), lint=0028/0029 (anon exec)
-- =====================================================


-- =====================================================
-- BLOCO A: SET search_path = public em todas as funções
-- =====================================================
-- Protege contra search_path injection em funções SECURITY
-- DEFINER. Sem impacto funcional — apenas pin no schema.

-- Trigger functions (sem argumentos)
ALTER FUNCTION public.update_users_updated_at()             SET search_path = public;
ALTER FUNCTION public.update_gamification_updated_at()      SET search_path = public;
ALTER FUNCTION public.update_bank_accounts_updated_at()     SET search_path = public;
ALTER FUNCTION public.update_wallets_updated_at()           SET search_path = public;
ALTER FUNCTION public.update_kyc_updated_at()               SET search_path = public;
ALTER FUNCTION public.update_contracts_updated_at()         SET search_path = public;
ALTER FUNCTION public.update_support_tickets_updated_at()   SET search_path = public;
ALTER FUNCTION public.prevent_system_role_deletion()        SET search_path = public;
ALTER FUNCTION public.ensure_admin_is_member()              SET search_path = public;
ALTER FUNCTION public.block_transaction_updates()           SET search_path = public;
ALTER FUNCTION public.block_paid_contribuicao_updates()     SET search_path = public;

-- RBAC check functions
ALTER FUNCTION public.check_global_role(text, text)         SET search_path = public;
ALTER FUNCTION public.check_caixinha_role(text, text, text) SET search_path = public;
ALTER FUNCTION public.check_caixinha_access(text, text)     SET search_path = public;
ALTER FUNCTION public.check_caixinha_pending(text, text)    SET search_path = public;
ALTER FUNCTION public.check_permission(text, text)          SET search_path = public;

-- RBAC sync functions
ALTER FUNCTION public.sync_user_role(text, text, text, text, text)   SET search_path = public;
ALTER FUNCTION public.sync_caixinha_member(text, text, text, text)   SET search_path = public;

-- Gamificação RPCs
ALTER FUNCTION public.init_user_gamification(text)                      SET search_path = public;
ALTER FUNCTION public.grant_xp(text, integer, integer, text, text, text) SET search_path = public;
ALTER FUNCTION public.complete_task(text, text)                         SET search_path = public;
ALTER FUNCTION public.grant_selo(text, text, text, text)                SET search_path = public;
ALTER FUNCTION public.update_daily_streak(text)                         SET search_path = public;

-- Economia EloCoins
ALTER FUNCTION public.spend_elo_coins(text, integer, text, text, jsonb)           SET search_path = public;
ALTER FUNCTION public.activate_content_boost(text, text, text, integer, integer)  SET search_path = public;
ALTER FUNCTION public.credit_wallet(text, numeric)  SET search_path = public;
ALTER FUNCTION public.debit_wallet(text, numeric)   SET search_path = public;


-- =====================================================
-- BLOCO B: REVOKE EXECUTE das funções críticas
-- =====================================================
-- Risco por categoria:
--
--  CRÍTICO — Financeiro:
--    credit_wallet, debit_wallet  → manipulam saldo direto
--    spend_elo_coins              → debita + transfere coins
--    activate_content_boost       → gasta coins + ativa boost
--
--  CRÍTICO — Escalada de privilégio:
--    sync_user_role               → cria/altera roles de qualquer user
--    sync_caixinha_member         → insere qualquer user como admin de caixinha
--
--  ALTO — Enumeração de RBAC / vazamento de estrutura:
--    check_global_role, check_caixinha_role, check_caixinha_access,
--    check_caixinha_pending, check_permission
--    → revelam se um user_id tem determinada permissão;
--      podem ser usados para confirmar existência de usuários e roles

-- ─────────────────────────────────────────────────────────────────
-- NOTA SOBRE PUBLIC vs anon/authenticated:
--   No PostgreSQL, `PUBLIC` é um pseudo-role que todos herdam.
--   Supabase concede EXECUTE ON FUNCTIONS TO PUBLIC por default.
--   REVOKE FROM anon, authenticated não é suficiente porque os roles
--   herdam o grant de PUBLIC. É obrigatório revogar também de PUBLIC.
--   Após REVOKE FROM PUBLIC, service_role (superuser) continua tendo
--   acesso — superusers ignoram privilege checks por definição.
-- ─────────────────────────────────────────────────────────────────

-- Funções financeiras — NENHUM acesso via PostgREST
REVOKE EXECUTE ON FUNCTION public.credit_wallet(text, numeric)
    FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.debit_wallet(text, numeric)
    FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.spend_elo_coins(text, integer, text, text, jsonb)
    FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.activate_content_boost(text, text, text, integer, integer)
    FROM PUBLIC, anon, authenticated;

-- Funções de sincronização RBAC — apenas backend (service_role)
REVOKE EXECUTE ON FUNCTION public.sync_user_role(text, text, text, text, text)
    FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.sync_caixinha_member(text, text, text, text)
    FROM PUBLIC, anon, authenticated;

-- Funções de verificação RBAC — apenas backend (middleware rbac.js)
-- O middleware já usa service_role; não há uso legítimo via PostgREST direto
REVOKE EXECUTE ON FUNCTION public.check_global_role(text, text)
    FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.check_caixinha_role(text, text, text)
    FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.check_caixinha_access(text, text)
    FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.check_caixinha_pending(text, text)
    FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.check_permission(text, text)
    FROM PUBLIC, anon, authenticated;


-- =====================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO
-- =====================================================
-- 1. Confirmar search_path fixo em todas as funções:
-- SELECT proname, proconfig
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND proconfig IS NOT NULL
--   AND proconfig::text LIKE '%search_path=public%'
-- ORDER BY proname;
-- Resultado esperado: todas as 27 funções listadas.

-- 2. Confirmar ausência de EXECUTE para anon/authenticated
--    nas funções financeiras e de RBAC:
-- SELECT routine_name, grantee, privilege_type
-- FROM information_schema.role_routine_grants
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--       'credit_wallet','debit_wallet','spend_elo_coins',
--       'activate_content_boost','sync_user_role',
--       'sync_caixinha_member','check_global_role',
--       'check_caixinha_role','check_caixinha_access',
--       'check_caixinha_pending','check_permission'
--   )
--   AND grantee IN ('anon','authenticated');
-- Resultado esperado: 0 linhas.
